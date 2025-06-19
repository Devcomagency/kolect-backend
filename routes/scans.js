const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Fonction utilitaire pour vérifier si une table existe
const tableExists = async (tableName) => {
  try {
    const result = await pool.query(
      `SELECT EXISTS (
        SELECT FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = $1
      )`,
      [tableName]
    );
    return result.rows[0].exists;
  } catch (error) {
    console.error(`❌ Erreur vérification table ${tableName}:`, error);
    return false;
  }
};

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token requis' });
  }

  try {
    const jwtSecret = process.env.JWT_SECRET;
    console.log('🔑 JWT Secret défini:', !!jwtSecret);
    
    const decoded = jwt.verify(token, jwtSecret);
    console.log('✅ Token décodé, userId:', decoded.userId);
    
    const userQuery = `SELECT id, first_name, last_name, email, phone, status FROM collaborators WHERE id = $1`;
    const userResult = await pool.query(userQuery, [decoded.userId]);
    
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Utilisateur non trouvé' });
    }
    
    const user = userResult.rows[0];
    req.user = {
      userId: user.id,
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      phone: user.phone,
      status: user.status
    };
    
    console.log('✅ Auth réussie pour:', user.email);
    next();
    
  } catch (error) {
    console.error('❌ Erreur auth:', error.name, error.message);
    return res.status(403).json({
      error: 'Token invalide',
      type: error.name,
      details: error.message
    });
  }
};

// GET /api/scans/initiatives - Récupérer toutes les initiatives
router.get('/initiatives', authenticateToken, async (req, res) => {
  try {
    console.log('📊 === RÉCUPÉRATION INITIATIVES ===');
    
    // Vérifier si les tables existent
    const initiativesTableExists = await tableExists('initiatives');
    const scansTableExists = await tableExists('scans');
    
    if (!initiativesTableExists) {
      return res.status(404).json({
        success: false,
        error: 'Table initiatives non trouvée',
        hint: 'Exécutez /api/scans/force-setup pour créer les tables'
      });
    }
    
    let query;
    if (scansTableExists) {
      // Requête complète avec les stats de scans
      query = `
        SELECT 
          i.*,
          COUNT(s.id) as total_scans,
          COALESCE(SUM(s.signatures), 0) as total_signatures,
          MAX(s.created_at) as last_scan_date
        FROM initiatives i
        LEFT JOIN scans s ON i.id = s.initiative_id
        GROUP BY i.id
        ORDER BY i.id ASC
      `;
    } else {
      // Requête simple sans les scans
      query = `
        SELECT 
          *,
          0 as total_scans,
          0 as total_signatures,
          NULL as last_scan_date
        FROM initiatives
        ORDER BY id ASC
      `;
    }
    
    const result = await pool.query(query);
    const initiatives = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      objective: row.objective,
      color: row.color,
      status: row.status,
      totalScans: parseInt(row.total_scans) || 0,
      totalSignatures: parseInt(row.total_signatures) || 0,
      lastScanDate: row.last_scan_date
    }));
    
    console.log(`✅ ${initiatives.length} initiatives récupérées`);
    res.json({ success: true, initiatives });
    
  } catch (error) {
    console.error('❌ Erreur récupération initiatives:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/scans/history - Récupérer l'historique des scans
router.get('/history', authenticateToken, async (req, res) => {
  try {
    console.log('📈 === RÉCUPÉRATION HISTORIQUE ===');
    
    // Vérifier si la table scans existe
    const scansTableExists = await tableExists('scans');
    
    if (!scansTableExists) {
      return res.status(404).json({
        success: false,
        error: 'Table scans non trouvée',
        hint: 'Exécutez /api/scans/force-setup pour créer les tables'
      });
    }
    
    const userId = req.user.userId;
    const days = parseInt(req.query.days) || 30;
    
    const query = `
      SELECT 
        DATE(created_at) as scan_date,
        COUNT(*) as scan_count,
        SUM(signatures) as daily_signatures
      FROM scans 
      WHERE user_id = $1 
        AND created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY DATE(created_at)
      ORDER BY scan_date DESC
    `;
    
    const result = await pool.query(query, [userId]);
    const history = result.rows.map(row => ({
      date: row.scan_date,
      scans: parseInt(row.scan_count),
      signatures: parseInt(row.daily_signatures) || 0
    }));
    
    console.log(`✅ Historique récupéré: ${history.length} jours`);
    res.json({ success: true, history });
    
  } catch (error) {
    console.error('❌ Erreur récupération historique:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/scans/submit - Soumettre un nouveau scan
router.post('/submit', authenticateToken, async (req, res) => {
  try {
    console.log('📸 === SOUMISSION SCAN ===');
    const { initiative_id, signatures, quality, confidence, notes } = req.body;
    const userId = req.user.userId;

    if (!initiative_id || signatures === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Initiative et signatures requis'
      });
    }

    // Vérifier si les tables existent
    const initiativesTableExists = await tableExists('initiatives');
    const scansTableExists = await tableExists('scans');
    
    if (!initiativesTableExists || !scansTableExists) {
      return res.status(404).json({
        success: false,
        error: 'Tables manquantes',
        hint: 'Exécutez /api/scans/force-setup pour créer les tables'
      });
    }

    // Vérifier que l'initiative existe
    const initiativeCheck = await pool.query('SELECT name FROM initiatives WHERE id = $1', [initiative_id]);
    if (initiativeCheck.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Initiative non trouvée'
      });
    }

    // Insérer le scan
    const insertQuery = `
      INSERT INTO scans (user_id, initiative_id, signatures, quality, confidence, notes, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *
    `;
    
    const result = await pool.query(insertQuery, [
      userId,
      initiative_id,
      signatures,
      quality || 85,
      confidence || 85,
      notes || ''
    ]);

    const scan = result.rows[0];
    const initiativeName = initiativeCheck.rows[0].name;

    console.log(`✅ Scan créé: ID ${scan.id}, ${signatures} signatures pour ${initiativeName}`);

    res.json({
      success: true,
      message: `✅ Scan enregistré avec succès!`,
      scan: {
        id: scan.id,
        initiative: initiativeName,
        signatures: scan.signatures,
        quality: scan.quality,
        confidence: scan.confidence,
        timestamp: scan.created_at
      },
      user: {
        userId: req.user.userId,
        firstName: req.user.firstName,
        email: req.user.email
      }
    });

  } catch (error) {
    console.error('❌ Erreur soumission scan:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/scans/force-setup - Configuration automatique de la base de données
router.get('/force-setup', async (req, res) => {
  try {
    console.log('🔧 === CONFIGURATION BASE DE DONNÉES ===');

    // 1. Créer table initiatives AVANT tout le reste
    console.log('🔧 Étape 1: Création table initiatives...');
    const createInitiativesTable = `
      CREATE TABLE IF NOT EXISTS initiatives (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        objective INTEGER DEFAULT 0,
        color VARCHAR(7) DEFAULT '#4ECDC4',
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await pool.query(createInitiativesTable);
    console.log('✅ Table initiatives créée/vérifiée');

    // 2. Insérer les initiatives par défaut IMMÉDIATEMENT
    console.log('🔧 Étape 2: Insertion initiatives par défaut...');
    const existingInitiatives = await pool.query('SELECT COUNT(*) FROM initiatives');
    
    if (parseInt(existingInitiatives.rows[0].count) === 0) {
      const initiatives = [
        { name: 'Forêt', description: 'Protection des forêts', objective: 10000, color: '#2ECC71' },
        { name: 'Commune', description: 'Amélioration communale', objective: 5000, color: '#3498DB' },
        { name: 'Frontière', description: 'Gestion des frontières', objective: 7500, color: '#E74C3C' },
        { name: 'Santé', description: 'Système de santé', objective: 8000, color: '#F39C12' },
        { name: 'Éducation', description: 'Réforme éducation', objective: 6000, color: '#9B59B6' }
      ];

      for (const initiative of initiatives) {
        await pool.query(
          'INSERT INTO initiatives (name, description, objective, color) VALUES ($1, $2, $3, $4)',
          [initiative.name, initiative.description, initiative.objective, initiative.color]
        );
      }
      console.log(`✅ ${initiatives.length} initiatives créées`);
    } else {
      console.log('✅ Initiatives déjà existantes');
    }

    // 3. Maintenant créer table scans (qui référence initiatives)
    console.log('🔧 Étape 3: Création table scans...');
    const createScansTable = `
      CREATE TABLE IF NOT EXISTS scans (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES collaborators(id),
        initiative_id INTEGER REFERENCES initiatives(id),
        signatures INTEGER NOT NULL DEFAULT 0,
        quality INTEGER DEFAULT 85,
        confidence INTEGER DEFAULT 85,
        notes TEXT,
        file_path VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await pool.query(createScansTable);
    console.log('✅ Table scans créée/vérifiée');

    // 4. Créer des index pour optimiser les performances
    console.log('🔧 Étape 4: Création des index...');
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_scans_user_id ON scans(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_scans_initiative_id ON scans(initiative_id)',
      'CREATE INDEX IF NOT EXISTS idx_scans_created_at ON scans(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_initiatives_status ON initiatives(status)'
    ];

    for (const indexQuery of indexes) {
      await pool.query(indexQuery);
    }
    console.log('✅ Index créés/vérifiés');

    // 5. Maintenant on peut créer les scans de test en toute sécurité
    console.log('🔧 Étape 5: Insertion scans de test...');
    const existingScans = await pool.query('SELECT COUNT(*) FROM scans');
    
    if (parseInt(existingScans.rows[0].count) === 0) {
      // Récupérer les IDs des initiatives et utilisateurs APRÈS les avoir créées
      const initiativesIds = await pool.query('SELECT id FROM initiatives ORDER BY id ASC');
      const userIds = await pool.query('SELECT id FROM collaborators ORDER BY id DESC LIMIT 5');
      
      console.log(`🔍 Trouvé ${initiativesIds.rows.length} initiatives et ${userIds.rows.length} utilisateurs`);
      
      if (initiativesIds.rows.length > 0 && userIds.rows.length > 0) {
        console.log('🔧 Création de 30 scans de test...');
        // Créer 30 scans de test répartis sur 30 jours
        for (let i = 0; i < 30; i++) {
          const randomInitiative = initiativesIds.rows[Math.floor(Math.random() * initiativesIds.rows.length)];
          const randomUser = userIds.rows[Math.floor(Math.random() * userIds.rows.length)];
          const randomSignatures = Math.floor(Math.random() * 25) + 5; // Entre 5 et 30 signatures
          const randomQuality = Math.floor(Math.random() * 20) + 80; // Entre 80 et 100
          const daysAgo = Math.floor(Math.random() * 30); // Sur les 30 derniers jours
          
          await pool.query(`
            INSERT INTO scans (user_id, initiative_id, signatures, quality, confidence, created_at)
            VALUES ($1, $2, $3, $4, $5, NOW() - INTERVAL '${daysAgo} days')
          `, [randomUser.id, randomInitiative.id, randomSignatures, randomQuality, randomQuality - 5]);
        }
        console.log('✅ 30 scans de test créés');
      } else {
        console.log('⚠️ Pas d\'utilisateurs ou d\'initiatives pour créer des scans de test');
      }
    } else {
      console.log('✅ Scans déjà existants');
    }

    // 6. Statistiques finales
    console.log('🔧 Étape 6: Calcul des statistiques finales...');
    const stats = await Promise.all([
      pool.query('SELECT COUNT(*) FROM collaborators'),
      pool.query('SELECT COUNT(*) FROM initiatives'),
      pool.query('SELECT COUNT(*) FROM scans')
    ]);

    const collaboratorsCount = parseInt(stats[0].rows[0].count);
    const initiativesCount = parseInt(stats[1].rows[0].count);
    const scansCount = parseInt(stats[2].rows[0].count);

    console.log(`✅ Configuration terminée: ${collaboratorsCount} utilisateurs, ${initiativesCount} initiatives, ${scansCount} scans`);

    res.json({
      success: true,
      message: "🎉 Base de données KOLECT configurée avec succès!",
      tables: {
        created: ["initiatives", "scans"],
        indexed: ["user_id", "initiative_id", "created_at"],
        order: "1. initiatives → 2. données → 3. scans → 4. index"
      },
      data: {
        collaborators: collaboratorsCount,
        initiatives: initiativesCount,
        scans: scansCount
      },
      initiatives: [
        "🌲 Forêt - Protection des forêts (10,000 signatures)",
        "🏘️ Commune - Amélioration communale (5,000 signatures)",
        "🚧 Frontière - Gestion des frontières (7,500 signatures)",
        "🏥 Santé - Système de santé (8,000 signatures)",
        "🎓 Éducation - Réforme éducation (6,000 signatures)"
      ],
      storage: {
        location: "/uploads/scans/",
        maxFileSize: "10MB",
        allowedTypes: ["JPG", "PNG", "WebP"],
        maxFiles: 5
      },
      endpoints: {
        debug: "/api/scans/debug/tables",
        admin: "/api/scans/admin",
        initiatives: "/api/scans/initiatives",
        history: "/api/scans/history",
        submit: "POST /api/scans/submit"
      },
      nextSteps: [
        "1. Tester l'interface debug: /api/scans/debug/tables",
        "2. Accéder à l'admin: /api/scans/admin",
        "3. Tester les endpoints API",
        "4. Vérifier les données dans l'app mobile"
      ],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur setup:', error);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la configuration de la base de données",
      details: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/scans/debug/tables - Interface de debug sécurisée
router.get('/debug/tables', async (req, res) => {
  try {
    console.log('🔍 === DEBUG TABLES ===');

    // Récupérer les informations sur toutes les tables
    const tablesQuery = `
      SELECT 
        schemaname,
        tablename,
        tableowner
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename
    `;

    const tablesResult = await pool.query(tablesQuery);
    const tablesList = [];

    // Pour chaque table, compter les entrées
    for (const table of tablesResult.rows) {
      try {
        const countResult = await pool.query(`SELECT COUNT(*) FROM ${table.tablename}`);
        tablesList.push({
          name: table.tablename,
          count: parseInt(countResult.rows[0].count),
          owner: table.tableowner
        });
      } catch (err) {
        tablesList.push({
          name: table.tablename,
          count: 'Erreur',
          owner: table.tableowner
        });
      }
    }

    // Récupérer des données spécifiques en vérifiant l'existence des tables
    const collaborators = [];
    const initiatives = [];
    const scans = [];

    try {
      const collabResult = await pool.query('SELECT id, first_name, last_name, email, status, created_at FROM collaborators ORDER BY id DESC LIMIT 10');
      collaborators.push(...collabResult.rows);
    } catch (err) {
      console.log('⚠️ Table collaborators non accessible');
    }

    // Vérifier si les tables existent avant les requêtes
    const initiativesExists = await tableExists('initiatives');
    const scansExists = await tableExists('scans');

    if (initiativesExists) {
      try {
        const initResult = await pool.query('SELECT * FROM initiatives ORDER BY id ASC');
        initiatives.push(...initResult.rows);
      } catch (err) {
        console.log('⚠️ Erreur lecture table initiatives:', err.message);
      }
    }

    if (scansExists && initiativesExists) {
      try {
        const scansResult = await pool.query(`
          SELECT s.*, i.name as initiative_name, c.first_name, c.last_name 
          FROM scans s 
          LEFT JOIN initiatives i ON s.initiative_id = i.id 
          LEFT JOIN collaborators c ON s.user_id = c.id 
          ORDER BY s.created_at DESC 
          LIMIT 20
        `);
        scans.push(...scansResult.rows);
      } catch (err) {
        console.log('⚠️ Erreur lecture table scans:', err.message);
      }
    }

    // Créer une page HTML simple
    const debugHTML = `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🔍 KOLECT Debug</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { background: #4ECDC4; color: white; padding: 20px; border-radius: 10px; text-align: center; margin-bottom: 20px; }
        .section { background: white; padding: 20px; margin-bottom: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 10px; border: 1px solid #ddd; text-align: left; }
        th { background: #35A085; color: white; }
        tr:nth-child(even) { background: #f9f9f9; }
        .stat { display: inline-block; background: #4ECDC4; color: white; padding: 10px 20px; margin: 5px; border-radius: 5px; font-weight: bold; }
        .alert { padding: 15px; margin: 10px 0; border-radius: 5px; }
        .alert-warning { background: #fff3cd; border: 1px solid #ffeeba; color: #856404; }
        .alert-success { background: #d4edda; border: 1px solid #c3e6cb; color: #155724; }
        .btn { padding: 10px 20px; margin: 5px; background: #4ECDC4; color: white; text-decoration: none; border-radius: 5px; display: inline-block; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔍 KOLECT Debug Interface</h1>
            <p>Base de données - ${new Date().toLocaleString('fr-FR')}</p>
        </div>

        ${!initiativesExists || !scansExists ? `
        <div class="alert alert-warning">
            <strong>⚠️ Tables manquantes détectées !</strong><br>
            ${!initiativesExists ? '❌ Table "initiatives" manquante<br>' : ''}
            ${!scansExists ? '❌ Table "scans" manquante<br>' : ''}
            <a href="/api/scans/force-setup" class="btn">🔧 Créer les tables manquantes</a>
        </div>
        ` : `
        <div class="alert alert-success">
            <strong>✅ Toutes les tables principales sont présentes !</strong>
        </div>
        `}

        <div class="section">
            <h2>📊 Statistiques</h2>
            <div class="stat">👥 ${tablesList.find(t => t.name === 'collaborators')?.count || 0} Collaborateurs</div>
            <div class="stat">🎯 ${tablesList.find(t => t.name === 'initiatives')?.count || 0} Initiatives</div>
            <div class="stat">📸 ${tablesList.find(t => t.name === 'scans')?.count || 0} Scans</div>
            <div class="stat">📋 ${tablesList.length} Tables</div>
        </div>

        <div class="section">
            <h2>📋 Tables de la Base</h2>
            <table>
                <thead>
                    <tr><th>Table</th><th>Entrées</th><th>Propriétaire</th><th>Status</th></tr>
                </thead>
                <tbody>
                    ${tablesList.map(table => `
                        <tr>
                            <td><strong>${table.name}</strong></td>
                            <td>${table.count}</td>
                            <td>${table.owner}</td>
                            <td>${['initiatives', 'scans'].includes(table.name) && table.count > 0 ? '✅ OK' : table.count === 0 ? '⚠️ Vide' : '📊 Données'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        ${initiatives.length > 0 ? `
        <div class="section">
            <h2>🎯 Initiatives Configurées</h2>
            <table>
                <thead>
                    <tr><th>ID</th><th>Nom</th><th>Description</th><th>Objectif</th><th>Couleur</th></tr>
                </thead>
                <tbody>
                    ${initiatives.map(init => `
                        <tr>
                            <td>${init.id}</td>
                            <td><strong>${init.name}</strong></td>
                            <td>${init.description || 'N/A'}</td>
                            <td>${init.objective || 0}</td>
                            <td style="background: ${init.color}; color: white; text-align: center;">${init.color}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        ` : ''}

        ${scans.length > 0 ? `
        <div class="section">
            <h2>📸 Scans Récents</h2>
            <table>
                <thead>
                    <tr><th>ID</th><th>Collecteur</th><th>Initiative</th><th>Signatures</th><th>Qualité</th><th>Date</th></tr>
                </thead>
                <tbody>
                    ${scans.map(scan => `
                        <tr>
                            <td>${scan.id}</td>
                            <td>${scan.first_name} ${scan.last_name}</td>
                            <td><strong>${scan.initiative_name}</strong></td>
                            <td><strong>${scan.signatures}</strong></td>
                            <td>${scan.quality}%</td>
                            <td>${new Date(scan.created_at).toLocaleDateString('fr-FR')}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        ` : ''}

        <div class="section">
            <h2>🔗 Actions Disponibles</h2>
            <div>
                <a href="/api/scans/force-setup" class="btn">🔧 Setup/Reconfigurer</a>
                <a href="/api/scans/admin" class="btn">🎯 Interface Admin</a>
                <a href="/api/health" class="btn">💚 Health Check</a>
            </div>
        </div>
    </div>
</body>
</html>
    `;

    res.send(debugHTML);

  } catch (error) {
    console.error('❌ Erreur debug:', error);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la récupération des données de debug",
      details: error.message
    });
  }
});

// GET /api/scans/admin - Interface d'administration sécurisée
router.get('/admin', async (req, res) => {
  try {
    console.log('🎨 === INTERFACE ADMIN ===');

    // Vérifier les tables avant de faire les requêtes
    const initiativesExists = await tableExists('initiatives');
    const scansExists = await tableExists('scans');

    const adminHTML = `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🎯 KOLECT Admin</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1000px; margin: 0 auto; }
        .header { background: linear-gradient(135deg, #4ECDC4, #35A085); color: white; padding: 30px; border-radius: 15px; text-align: center; margin-bottom: 30px; }
        .section { background: white; padding: 20px; margin-bottom: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .btn { padding: 10px 20px; margin: 10px; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; text-decoration: none; display: inline-block; }
        .btn-primary { background: #4ECDC4; color: white; }
        .btn-success { background: #27ae60; color: white; }
        .btn-danger { background: #e74c3c; color: white; }
        .actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
        .action-card { background: #f8f9fa; padding: 20px; border-radius: 10px; text-align: center; }
        .alert { padding: 15px; margin: 10px 0; border-radius: 5px; }
        .alert-warning { background: #fff3cd; border: 1px solid #ffeeba; color: #856404; }
        .alert-success { background: #d4edda; border: 1px solid #c3e6cb; color: #155724; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎯 KOLECT Admin</h1>
            <p>Interface d'administration</p>
            <p style="font-size: 0.9rem;">Dernière mise à jour: ${new Date().toLocaleString('fr-FR')}</p>
        </div>

        ${!initiativesExists || !scansExists ? `
        <div class="alert alert-warning">
            <h3>⚠️ Configuration Requise</h3>
            <p>Certaines tables sont manquantes :</p>
            <ul>
                ${!initiativesExists ? '<li>❌ Table "initiatives" non trouvée</li>' : ''}
                ${!scansExists ? '<li>❌ Table "scans" non trouvée</li>' : ''}
            </ul>
            <p><strong>Action requise :</strong> Cliquez sur "Setup Database" pour créer les tables manquantes.</p>
        </div>
        ` : `
        <div class="alert alert-success">
            <h3>✅ Configuration OK</h3>
            <p>Toutes les tables sont présentes et fonctionnelles !</p>
        </div>
        `}

        <div class="section">
            <h2>🔗 Interface de Gestion</h2>
            <div class="actions">
                <div class="action-card">
                    <h3>🔍 Debug Interface</h3>
                    <p>Voir toutes les données en lecture seule</p>
                    <a href="/api/scans/debug/tables" class="btn btn-primary">📊 Voir Données</a>
                </div>
                
                <div class="action-card">
                    <h3>🔧 Setup Database</h3>
                    <p>Créer/reconfigurer les tables</p>
                    <a href="/api/scans/force-setup" class="btn btn-success">⚙️ Configurer</a>
                </div>
                
                <div class="action-card">
                    <h3>💚 Health Check</h3>
                    <p>Vérifier le statut du serveur</p>
                    <a href="/api/health" class="btn btn-primary">🩺 Diagnostiquer</a>
                </div>
                
                <div class="action-card">
                    <h3>📱 App Mobile</h3>
                    <p>Tester les endpoints API</p>
                    <a href="/api/scans/initiatives" class="btn btn-primary">🔗 Test API</a>
                    <small style="display: block; margin-top: 5px; color: #666;">
                        (Nécessite un token d'authentification)
                    </small>
                </div>
            </div>
        </div>

        <div class="section">
            <h2>📚 Guide d'Utilisation</h2>
            <div style="text-align: left;">
                <h4>🔧 Pour configurer la base de données :</h4>
                <ol>
                    <li>Cliquez sur <strong>"Setup Database"</strong></li>
                    <li>Attendez la confirmation de création des tables</li>
                    <li>Vérifiez avec <strong>"Debug Interface"</strong></li>
                </ol>

                <h4>👀 Pour voir vos données :</h4>
                <ol>
                    <li>Utilisez <strong>"Debug Interface"</strong> pour voir toutes les données</li>
                    <li>Vérifiez les statistiques et tables</li>
                    <li>Consultez les initiatives et scans créés</li>
                </ol>

                <h4>📱 Pour tester l'app mobile :</h4>
                <ol>
                    <li>Vérifiez que les endpoints répondent avec <strong>"Test API"</strong></li>
                    <li>Connectez-vous dans l'app mobile</li>
                    <li>Le dashboard devrait afficher les vraies données</li>
                </ol>
            </div>
        </div>
    </div>
</body>
</html>
    `;

    res.send(adminHTML);

  } catch (error) {
    console.error('❌ Erreur interface admin:', error);
    res.status(500).json({
      success: false,
      error: "Erreur lors du chargement de l'interface admin",
      details: error.message
    });
  }
});

module.exports = router;
