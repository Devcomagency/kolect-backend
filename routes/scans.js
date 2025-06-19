cconst express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

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
    
    const query = `
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

    // 1. Créer table initiatives si elle n'existe pas
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

    // 2. Créer table scans si elle n'existe pas
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

    // Exécuter la création des tables
    await pool.query(createInitiativesTable);
    await pool.query(createScansTable);

    // 3. Créer des index pour optimiser les performances
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_scans_user_id ON scans(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_scans_initiative_id ON scans(initiative_id)',
      'CREATE INDEX IF NOT EXISTS idx_scans_created_at ON scans(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_initiatives_status ON initiatives(status)'
    ];

    for (const indexQuery of indexes) {
      await pool.query(indexQuery);
    }

    // 4. Vérifier et insérer les initiatives par défaut
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
    }

    // 5. Ajouter des scans de test si la table est vide
    const existingScans = await pool.query('SELECT COUNT(*) FROM scans');
    
    if (parseInt(existingScans.rows[0].count) === 0) {
      // Récupérer les IDs des initiatives et utilisateurs
      const initiativesIds = await pool.query('SELECT id FROM initiatives ORDER BY id ASC');
      const userIds = await pool.query('SELECT id FROM collaborators ORDER BY id DESC LIMIT 5');
      
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
    }

    // 6. Statistiques finales
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
        indexed: ["user_id", "initiative_id", "created_at"]
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

// GET /api/scans/debug/tables - Interface de debug simplifiée
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

    // Récupérer des données spécifiques
    const queries = await Promise.allSettled([
      pool.query('SELECT id, first_name, last_name, email, status, created_at FROM collaborators ORDER BY id DESC LIMIT 10'),
      pool.query('SELECT * FROM initiatives ORDER BY id ASC'),
      pool.query(`
        SELECT s.*, i.name as initiative_name, c.first_name, c.last_name 
        FROM scans s 
        LEFT JOIN initiatives i ON s.initiative_id = i.id 
        LEFT JOIN collaborators c ON s.user_id = c.id 
        ORDER BY s.created_at DESC 
        LIMIT 20
      `)
    ]);

    const collaborators = queries[0].status === 'fulfilled' ? queries[0].value.rows : [];
    const initiatives = queries[1].status === 'fulfilled' ? queries[1].value.rows : [];
    const scans = queries[2].status === 'fulfilled' ? queries[2].value.rows : [];

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
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔍 KOLECT Debug Interface</h1>
            <p>Base de données - ${new Date().toLocaleString('fr-FR')}</p>
        </div>

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
                    <tr><th>Table</th><th>Entrées</th><th>Propriétaire</th></tr>
                </thead>
                <tbody>
                    ${tablesList.map(table => `
                        <tr>
                            <td><strong>${table.name}</strong></td>
                            <td>${table.count}</td>
                            <td>${table.owner}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        ${initiatives.length > 0 ? `
        <div class="section">
            <h2>🎯 Initiatives</h2>
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
                            <td style="background: ${init.color}; color: white;">${init.color}</td>
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
            <h2>🔗 Liens Utiles</h2>
            <p><a href="/api/scans/admin">🎯 Interface Admin</a></p>
            <p><a href="/api/scans/force-setup">🔧 Reconfigurer</a></p>
            <p><a href="/api/health">💚 Health Check</a></p>
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

// GET /api/scans/admin - Interface d'administration simplifiée
router.get('/admin', async (req, res) => {
  try {
    console.log('🎨 === INTERFACE ADMIN ===');

    // Récupérer toutes les données
    const [collaboratorsResult, initiativesResult, scansResult] = await Promise.all([
      pool.query('SELECT * FROM collaborators ORDER BY id DESC LIMIT 20'),
      pool.query('SELECT * FROM initiatives ORDER BY id ASC'),
      pool.query(`
        SELECT s.*, i.name as initiative_name, c.first_name, c.last_name 
        FROM scans s 
        LEFT JOIN initiatives i ON s.initiative_id = i.id 
        LEFT JOIN collaborators c ON s.user_id = c.id 
        ORDER BY s.created_at DESC 
        LIMIT 30
      `)
    ]);

    const collaborators = collaboratorsResult.rows;
    const initiatives = initiativesResult.rows;
    const scans = scansResult.rows;

    // Interface HTML simplifiée
    const adminHTML = `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🎯 KOLECT Admin</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1400px; margin: 0 auto; }
        .header { background: linear-gradient(135deg, #4ECDC4, #35A085); color: white; padding: 30px; border-radius: 15px; text-align: center; margin-bottom: 30px; }
        .tabs { display: flex; background: white; border-radius: 10px; margin-bottom: 20px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .tab { flex: 1; padding: 15px; background: #f8f9fa; cursor: pointer; text-align: center; border: none; font-weight: bold; }
        .tab.active { background: #4ECDC4; color: white; }
        .tab-content { display: none; background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .tab-content.active { display: block; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; }
        th, td { padding: 12px; border: 1px solid #ddd; text-align: left; }
        th { background: #35A085; color: white; }
        tr:nth-child(even) { background: #f9f9f9; }
        .editable { width: 100%; padding: 5px; border: 1px solid #ddd; border-radius: 3px; }
        .btn { padding: 8px 15px; margin: 2px; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; }
        .btn-danger { background: #e74c3c; color: white; }
        .btn-primary { background: #4ECDC4; color: white; }
        .stats { display: flex; gap: 15px; margin-bottom: 20px; }
        .stat-card { background: white; padding: 20px; border-radius: 10px; text-align: center; flex: 1; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .stat-number { font-size: 2rem; font-weight: bold; color: #4ECDC4; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎯 KOLECT Admin Pro</h1>
            <p>Interface de gestion - ${new Date().toLocaleString('fr-FR')}</p>
        </div>

        <div class="stats">
            <div class="stat-card">
                <div class="stat-number">${collaborators.length}</div>
                <div>Collaborateurs</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${initiatives.length}</div>
                <div>Initiatives</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${scans.length}</div>
                <div>Scans</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${scans.reduce((sum, scan) => sum + (scan.signatures || 0), 0)}</div>
                <div>Signatures</div>
            </div>
        </div>

        <div class="tabs">
            <button class="tab active" onclick="showTab('collaborators')">👥 Collaborateurs</button>
            <button class="tab" onclick="showTab('initiatives')">🎯 Initiatives</button>
            <button class="tab" onclick="showTab('scans')">📸 Scans</button>
        </div>

        <div id="collaborators" class="tab-content active">
            <h2>👥 Collaborateurs</h2>
            <table>
                <thead>
                    <tr><th>ID</th><th>Prénom</th><th>Nom</th><th>Email</th><th>Statut</th><th>Actions</th></tr>
                </thead>
                <tbody>
                    ${collaborators.map(collab => `
                        <tr>
                            <td><strong>${collab.id}</strong></td>
                            <td><input class="editable" value="${collab.first_name || ''}" onchange="updateField('collaborators', ${collab.id}, 'first_name', this.value)"></td>
                            <td><input class="editable" value="${collab.last_name || ''}" onchange="updateField('collaborators', ${collab.id}, 'last_name', this.value)"></td>
                            <td><input class="editable" value="${collab.email || ''}" onchange="updateField('collaborators', ${collab.id}, 'email', this.value)"></td>
                            <td>
                                <select class="editable" onchange="updateField('collaborators', ${collab.id}, 'status', this.value)">
                                    <option value="active" ${collab.status === 'active' ? 'selected' : ''}>Actif</option>
                                    <option value="inactive" ${collab.status === 'inactive' ? 'selected' : ''}>Inactif</option>
                                </select>
                            </td>
                            <td><button class="btn btn-danger" onclick="deleteRecord('collaborators', ${collab.id})">🗑️</button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <div id="initiatives" class="tab-content">
            <h2>🎯 Initiatives</h2>
            <table>
                <thead>
                    <tr><th>ID</th><th>Nom</th><th>Description</th><th>Objectif</th><th>Couleur</th><th>Actions</th></tr>
                </thead>
                <tbody>
                    ${initiatives.map(init => `
                        <tr>
                            <td><strong>${init.id}</strong></td>
                            <td><input class="editable" value="${init.name || ''}" onchange="updateField('initiatives', ${init.id}, 'name', this.value)"></td>
                            <td><input class="editable" value="${init.description || ''}" onchange="updateField('initiatives', ${init.id}, 'description', this.value)"></td>
                            <td><input class="editable" type="number" value="${init.objective || 0}" onchange="updateField('initiatives', ${init.id}, 'objective', this.value)"></td>
                            <td><input class="editable" type="color" value="${init.color || '#4ECDC4'}" onchange="updateField('initiatives', ${init.id}, 'color', this.value)"></td>
                            <td><button class="btn btn-danger" onclick="deleteRecord('initiatives', ${init.id})">🗑️</button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <div id="scans" class="tab-content">
            <h2>📸 Scans</h2>
            <table>
                <thead>
                    <tr><th>ID</th><th>Collecteur</th><th>Initiative</th><th>Signatures</th><th>Qualité</th><th>Date</th><th>Actions</th></tr>
                </thead>
                <tbody>
                    ${scans.map(scan => `
                        <tr>
                            <td><strong>${scan.id}</strong></td>
                            <td>${scan.first_name} ${scan.last_name}</td>
                            <td><strong>${scan.initiative_name}</strong></td>
                            <td><input class="editable" type="number" value="${scan.signatures || 0}" onchange="updateField('scans', ${scan.id}, 'signatures', this.value)"></td>
                            <td><input class="editable" type="number" value="${scan.quality || 85}" onchange="updateField('scans', ${scan.id}, 'quality', this.value)">%</td>
                            <td>${new Date(scan.created_at).toLocaleDateString('fr-FR')}</td>
                            <td><button class="btn btn-danger" onclick="deleteRecord('scans', ${scan.id})">🗑️</button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    </div>

    <script>
        function showTab(tabName) {
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
            document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
            document.getElementById(tabName).classList.add('active');
            event.target.classList.add('active');
        }

        async function updateField(table, id, field, value) {
            try {
                const response = await fetch(\`/api/scans/admin/update/\${table}/\${id}\`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ field, value })
                });
                const result = await response.json();
                if (result.success) {
                    alert('✅ Modifié avec succès');
                } else {
                    alert('❌ Erreur: ' + result.error);
                }
            } catch (error) {
                alert('❌ Erreur de connexion');
            }
        }

        async function deleteRecord(table, id) {
            if (!confirm('Supprimer cet élément ?')) return;
            try {
                const response = await fetch(\`/api/scans/admin/delete/\${table}/\${id}\`, {
                    method: 'DELETE'
                });
                const result = await response.json();
                if (result.success) {
                    alert('✅ Supprimé avec succès');
                    event.target.closest('tr').remove();
                } else {
                    alert('❌ Erreur: ' + result.error);
                }
            } catch (error) {
                alert('❌ Erreur de connexion');
            }
        }
    </script>
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

// Endpoints pour les actions admin
router.put('/admin/update/:table/:id', async (req, res) => {
  try {
    const { table, id } = req.params;
    const { field, value } = req.body;

    const allowedTables = ['collaborators', 'initiatives', 'scans'];
    if (!allowedTables.includes(table)) {
      return res.status(400).json({ success: false, error: 'Table non autorisée' });
    }

    const query = `UPDATE ${table} SET ${field} = $1, updated_at = NOW() WHERE id = $2`;
    await pool.query(query, [value, id]);

    res.json({ success: true, message: 'Champ mis à jour' });
  } catch (error) {
    console.error('❌ Erreur update:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/admin/delete/:table/:id', async (req, res) => {
  try {
    const { table, id } = req.params;

    const allowedTables = ['collaborators', 'initiatives', 'scans'];
    if (!allowedTables.includes(table)) {
      return res.status(400).json({ success: false, error: 'Table non autorisée' });
    }

    const query = `DELETE FROM ${table} WHERE id = $1`;
    await pool.query(query, [id]);

    res.json({ success: true, message: 'Enregistrement supprimé' });
  } catch (error) {
    console.error('❌ Erreur suppression:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
