const express = require('express');
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

// GET /api/scans/debug/tables - Interface de debug avancée
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

    // Statistiques par initiative
    const statsQuery = `
      SELECT 
        i.name,
        i.objective,
        COUNT(s.id) as total_scans,
        COALESCE(SUM(s.signatures), 0) as total_signatures,
        ROUND(AVG(s.signatures), 1) as avg_signatures,
        ROUND(AVG(s.quality), 1) as avg_quality
      FROM initiatives i
      LEFT JOIN scans s ON i.id = s.initiative_id
      GROUP BY i.id, i.name, i.objective
      ORDER BY total_signatures DESC
    `;

    const statsResult = await pool.query(statsQuery);
    const initiativeStats = statsResult.rows;

    // Top collecteurs
    const topCollectorsQuery = `
      SELECT 
        c.first_name,
        c.last_name,
        COUNT(s.id) as total_scans,
        SUM(s.signatures) as total_signatures
      FROM collaborators c
      LEFT JOIN scans s ON c.id = s.user_id
      GROUP BY c.id, c.first_name, c.last_name
      HAVING COUNT(s.id) > 0
      ORDER BY total_signatures DESC
      LIMIT 10
    `;

    const topCollectorsResult = await pool.query(topCollectorsQuery);
    const topCollectors = topCollectorsResult.rows;

    // Générer la page HTML
    const debugHTML = `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🔍 KOLECT Debug - Monitoring Système</title>
    <style>
        :root {
            --kolect-primary: #4ECDC4;
            --kolect-secondary: #35A085;
            --kolect-accent: #44B9A6;
            --kolect-dark: #2C3E50;
            --shadow: 0 4px 20px rgba(78, 205, 196, 0.15);
            --gradient: linear-gradient(135deg, var(--kolect-primary), var(--kolect-secondary));
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: var(--kolect-dark);
        }

        .debug-container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px;
        }

        .header {
            background: white;
            border-radius: 20px;
            padding: 30px;
            margin-bottom: 30px;
            box-shadow: var(--shadow);
            text-align: center;
        }

        .header h1 {
            background: var(--gradient);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            font-size: 2.5rem;
            margin-bottom: 10px;
        }

        .header p {
            color: #666;
            font-size: 1.1rem;
        }

        .timestamp {
            background: #f8f9fa;
            border-radius: 10px;
            padding: 10px;
            margin-top: 15px;
            font-family: monospace;
            color: #666;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .stat-card {
            background: white;
            border-radius: 15px;
            padding: 25px;
            text-align: center;
            box-shadow: var(--shadow);
            transition: transform 0.3s ease;
        }

        .stat-card:hover {
            transform: translateY(-5px);
        }

        .stat-number {
            font-size: 2.5rem;
            font-weight: bold;
            background: var(--gradient);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .stat-label {
            color: #666;
            font-size: 0.9rem;
            margin-top: 5px;
        }

        .section {
            background: white;
            border-radius: 20px;
            padding: 30px;
            margin-bottom: 30px;
            box-shadow: var(--shadow);
        }

        .section h2 {
            color: var(--kolect-dark);
            margin-bottom: 20px;
            font-size: 1.5rem;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .table-container {
            overflow-x: auto;
            border-radius: 15px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
        }

        table {
            width: 100%;
            border-collapse: collapse;
            background: white;
        }

        th {
            background: var(--gradient);
            color: white;
            padding: 15px;
            text-align: left;
            font-weight: 600;
        }

        td {
            padding: 12px 15px;
            border-bottom: 1px solid #eee;
        }

        tr:hover {
            background: #f8f9fa;
        }

        .badge {
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 600;
        }

        .badge.active {
            background: #d4edda;
            color: #155724;
        }

        .badge.inactive {
            background: #f8d7da;
            color: #721c24;
        }

        .progress-bar {
            background: #e9ecef;
            border-radius: 10px;
            height: 20px;
            overflow: hidden;
            margin: 5px 0;
        }

        .progress-fill {
            height: 100%;
            background: var(--gradient);
            transition: width 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 0.8rem;
            font-weight: 600;
        }

        .refresh-btn {
            position: fixed;
            bottom: 30px;
            right: 30px;
            background: var(--gradient);
            color: white;
            border: none;
            border-radius: 50%;
            width: 60px;
            height: 60px;
            font-size: 1.5rem;
            cursor: pointer;
            box-shadow: var(--shadow);
            transition: transform 0.3s ease;
        }

        .refresh-btn:hover {
            transform: scale(1.1);
        }

        .metric {
            display: flex;
            justify-content: space-between;
            padding: 10px 0;
            border-bottom: 1px solid #eee;
        }

        .metric:last-child {
            border-bottom: none;
        }

        .metric-label {
            color: #666;
        }

        .metric-value {
            font-weight: 600;
            color: var(--kolect-dark);
        }

        .alert {
            background: #fff3cd;
            border: 1px solid #ffeeba;
            color: #856404;
            padding: 15px;
            border-radius: 10px;
            margin-bottom: 20px;
        }

        .success {
            background: #d4edda;
            border-color: #c3e6cb;
            color: #155724;
        }
    </style>
</head>
<body>
    <div class="debug-container">
        <div class="header">
            <h1>🔍 KOLECT Debug</h1>
            <p>Monitoring système et base de données</p>
            <div class="timestamp">
                Dernière mise à jour: ${new Date().toLocaleString('fr-FR')}
            </div>
        </div>

        <div class="alert success">
            ✅ <strong>Système opérationnel</strong> - Toutes les connexions database fonctionnent correctement
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-number">${tablesList.find(t => t.name === 'collaborators')?.count || 0}</div>
                <div class="stat-label">Collaborateurs</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${tablesList.find(t => t.name === 'initiatives')?.count || 0}</div>
                <div class="stat-label">Initiatives</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${tablesList.find(t => t.name === 'scans')?.count || 0}</div>
                <div class="stat-label">Scans Total</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${tablesList.length}</div>
                <div class="stat-label">Tables DB</div>
            </div>
        </div>

        <div class="section">
            <h2>📊 Tables de la Base de Données</h2>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Nom de la Table</th>
                            <th>Nombre d'Entrées</th>
                            <th>Propriétaire</th>
                            <th>Statut</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tablesList.map(table => `
                            <tr>
                                <td><strong>${table.name}</strong></td>
                                <td>${table.count}</td>
                                <td>${table.owner}</td>
                                <td>
                                    <span class="badge ${table.count > 0 ? 'active' : 'inactive'}">
                                        ${table.count > 0 ? 'Active' : 'Vide'}
                                    </span>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        ${initiatives.length > 0 ? `
        <div class="section">
            <h2>🎯 Initiatives Configurées</h2>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Initiative</th>
                            <th>Description</th>
                            <th>Objectif</th>
                            <th>Couleur</th>
                            <th>Statut</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${initiatives.map(initiative => `
                            <tr>
                                <td><strong>${initiative.name}</strong></td>
                                <td>${initiative.description || 'N/A'}</td>
                                <td>${initiative.objective ? initiative.objective.toLocaleString() : 'N/A'} signatures</td>
                                <td>
                                    <div style="width: 20px; height: 20px; background: ${initiative.color || '#4ECDC4'}; border-radius: 50%; display: inline-block;"></div>
                                    ${initiative.color || '#4ECDC4'}
                                </td>
                                <td>
                                    <span class="badge ${initiative.status === 'active' ? 'active' : 'inactive'}">
                                        ${initiative.status || 'active'}
                                    </span>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        ` : ''}

        ${initiativeStats.length > 0 ? `
        <div class="section">
            <h2>📈 Statistiques par Initiative</h2>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Initiative</th>
                            <th>Objectif</th>
                            <th>Scans</th>
                            <th>Signatures</th>
                            <th>Moyenne/Scan</th>
                            <th>Qualité Moy.</th>
                            <th>Progression</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${initiativeStats.map(stat => {
                            const progress = stat.objective > 0 ? Math.min((stat.total_signatures / stat.objective) * 100, 100) : 0;
                            return `
                                <tr>
                                    <td><strong>${stat.name}</strong></td>
                                    <td>${stat.objective ? stat.objective.toLocaleString() : 'N/A'}</td>
                                    <td>${stat.total_scans}</td>
                                    <td><strong>${parseInt(stat.total_signatures).toLocaleString()}</strong></td>
                                    <td>${stat.avg_signatures || 0}</td>
                                    <td>${stat.avg_quality || 0}%</td>
                                    <td>
                                        <div class="progress-bar">
                                            <div class="progress-fill" style="width: ${progress}%">
                                                ${progress.toFixed(1)}%
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        ` : ''}

        ${topCollectors.length > 0 ? `
        <div class="section">
            <h2>🏆 Top Collecteurs</h2>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Rang</th>
                            <th>Collecteur</th>
                            <th>Scans</th>
                            <th>Signatures</th>
                            <th>Moyenne/Scan</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${topCollectors.map((collector, index) => `
                            <tr>
                                <td><strong>#${index + 1}</strong></td>
                                <td>${collector.first_name} ${collector.last_name}</td>
                                <td>${collector.total_scans}</td>
                                <td><strong>${parseInt(collector.total_signatures).toLocaleString()}</strong></td>
                                <td>${(collector.total_signatures / collector.total_scans).toFixed(1)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        ` : ''}

        ${collaborators.length > 0 ? `
        <div class="section">
            <h2>👥 Collaborateurs Récents</h2>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Nom</th>
                            <th>Email</th>
                            <th>Statut</th>
                            <th>Inscription</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${collaborators.map(collab => `
                            <tr>
                                <td><strong>${collab.id}</strong></td>
                                <td>${collab.first_name} ${collab.last_name}</td>
                                <td>${collab.email}</td>
                                <td>
                                    <span class="badge ${collab.status === 'active' ? 'active' : 'inactive'}">
                                        ${collab.status || 'active'}
                                    </span>
                                </td>
                                <td>${new Date(collab.created_at).toLocaleDateString('fr-FR')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        ` : ''}

        ${scans.length > 0 ? `
        <div class="section">
            <h2>📸 Scans Récents</h2>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Collecteur</th>
                            <th>Initiative</th>
                            <th>Signatures</th>
                            <th>Qualité</th>
                            <th>Confiance</th>
                            <th>Date</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${scans.map(scan => `
                            <tr>
                                <td><strong>${scan.id}</strong></td>
                                <td>${scan.first_name} ${scan.last_name}</td>
                                <td><strong>${scan.initiative_name}</strong></td>
                                <td><strong>${scan.signatures}</strong></td>
                                <td>
                                    <span style="color: ${scan.quality >= 90 ? '#28a745' : scan.quality >= 70 ? '#ffc107' : '#dc3545'}">
                                        ${scan.quality}%
                                    </span>
                                </td>
                                <td>${scan.confidence}%</td>
                                <td>${new Date(scan.created_at).toLocaleDateString('fr-FR')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        ` : ''}

        <div class="section">
            <h2>⚙️ Actions Disponibles</h2>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px;">
                <div class="metric">
                    <span class="metric-label">🔧 Interface Admin</span>
                    <span class="metric-value">
                        <a href="/api/scans/admin" style="color: var(--kolect-primary); text-decoration: none;">
                            Accéder →
                        </a>
                    </span>
                </div>
                <div class="metric">
                    <span class="metric-label">📊 API Initiatives</span>
                    <span class="metric-value">
                        <a href="/api/scans/initiatives" style="color: var(--kolect-primary); text-decoration: none;">
                            Tester →
                        </a>
                    </span>
                </div>
                <div class="metric">
                    <span class="metric-label">🔄 Reconfigurer</span>
                    <span class="metric-value">
                        <a href="/api/scans/force-setup" style="color: var(--kolect-primary); text-decoration: none;">
                            Setup →
                        </a>
                    </span>
                </div>
                <div class="metric">
                    <span class="metric-label">💡 Health Check</span>
                    <span class="metric-value">
                        <a href="/api/health" style="color: var(--kolect-primary); text-decoration: none;">
                            Status →
                        </a>
                    </span>
                </div>
            </div>
        </div>
    </div>

    <button class="refresh-btn" onclick="window.location.reload()">
        🔄
    </button>
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

// GET /api/scans/admin - Interface d'administration HTML complète
router.get('/admin', async (req, res) => {
  try {
    console.log('🎨 === INTERFACE ADMIN HTML ===');

    // Récupérer toutes les données
    const [collaboratorsResult, initiativesResult, scansResult] = await Promise.all([
      pool.query('SELECT * FROM collaborators ORDER BY id DESC'),
      pool.query('SELECT * FROM initiatives ORDER BY id ASC'),
      pool.query(`
        SELECT s.*, i.name as initiative_name, c.first_name, c.last_name 
        FROM scans s 
        LEFT JOIN initiatives i ON s.initiative_id = i.id 
        LEFT JOIN collaborators c ON s.user_id = c.id 
        ORDER BY s.created_at DESC 
        LIMIT 50
      `)
    ]);

    const collaborators = collaboratorsResult.rows;
    const initiatives = initiativesResult.rows;
    const scans = scansResult.rows;

    // Interface HTML complète
    const adminHTML = `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🎯 KOLECT Admin Pro - Interface de Gestion</title>
    <style>
        :root {
            --kolect-primary: #4ECDC4;
            --kolect-secondary: #35A085;
            --kolect-accent: #44B9A6;
            --kolect-dark: #2C3E50;
            --kolect-light: #ECF0F1;
            --shadow: 0 4px 20px rgba(78, 205, 196, 0.15);
            --gradient: linear-gradient(135deg, var(--kolect-primary), var(--kolect-secondary));
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: var(--kolect-dark);
        }

        .admin-container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px;
        }

        .header {
            background: white;
            border-radius: 20px;
            padding: 30px;
            margin-bottom: 30px;
            box-shadow: var(--shadow);
            text-align: center;
        }

        .header h1 {
            background: var(--gradient);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            font-size: 2.5rem;
            margin-bottom: 10px;
        }

        .header p {
            color: #666;
            font-size: 1.1rem;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .stat-card {
            background: white;
            border-radius: 15px;
            padding: 25px;
            text-align: center;
            box-shadow: var(--shadow);
            transition: transform 0.3s ease;
        }

        .stat-card:hover {
            transform: translateY(-5px);
        }

        .stat-number {
            font-size: 2.5rem;
            font-weight: bold;
            background: var(--gradient);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .stat-label {
            color: #666;
            font-size: 0.9rem;
            margin-top: 5px;
        }

        .tabs {
            display: flex;
            background: white;
            border-radius: 15px;
            padding: 10px;
            margin-bottom: 20px;
            box-shadow: var(--shadow);
        }

        .tab-button {
            flex: 1;
            padding: 15px 20px;
            border: none;
            background: transparent;
            border-radius: 10px;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.3s ease;
            color: #666;
        }

        .tab-button.active {
            background: var(--gradient);
            color: white;
            box-shadow: 0 4px 15px rgba(78, 205, 196, 0.3);
        }

        .tab-content {
            display: none;
            background: white;
            border-radius: 20px;
            padding: 30px;
            box-shadow: var(--shadow);
        }

        .tab-content.active {
            display: block;
        }

        .table-container {
            overflow-x: auto;
            border-radius: 15px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
        }

        table {
            width: 100%;
            border-collapse: collapse;
            background: white;
        }

        th {
            background: var(--gradient);
            color: white;
            padding: 15px;
            text-align: left;
            font-weight: 600;
        }

        td {
            padding: 12px 15px;
            border-bottom: 1px solid #eee;
        }

        tr:hover {
            background: #f8f9fa;
        }

        .editable {
            background: transparent;
            border: 1px solid transparent;
            padding: 5px;
            border-radius: 4px;
            width: 100%;
        }

        .editable:focus {
            border-color: var(--kolect-primary);
            outline: none;
            background: #f0f9ff;
        }

        .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.3s ease;
            text-decoration: none;
            display: inline-block;
        }

        .btn-primary {
            background: var(--gradient);
            color: white;
        }

        .btn-danger {
            background: #e74c3c;
            color: white;
        }

        .btn-success {
            background: #27ae60;
            color: white;
        }

        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        }

        .actions-bar {
            margin-bottom: 20px;
            display: flex;
            gap: 15px;
            flex-wrap: wrap;
        }

        .search-box {
            padding: 10px 15px;
            border: 2px solid #ddd;
            border-radius: 10px;
            flex: 1;
            min-width: 200px;
        }

        .search-box:focus {
            border-color: var(--kolect-primary);
            outline: none;
        }

        .badge {
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 600;
        }

        .badge.active {
            background: #d4edda;
            color: #155724;
        }

        .badge.inactive {
            background: #f8d7da;
            color: #721c24;
        }

        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 1000;
        }

        .modal-content {
            background: white;
            margin: 10% auto;
            padding: 30px;
            border-radius: 20px;
            width: 90%;
            max-width: 500px;
            box-shadow: var(--shadow);
        }

        .close {
            color: #aaa;
            float: right;
            font-size: 28px;
            font-weight: bold;
            cursor: pointer;
        }

        .close:hover {
            color: #000;
        }

        .form-group {
            margin-bottom: 20px;
        }

        .form-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: 600;
            color: var(--kolect-dark);
        }

        .form-group input,
        .form-group select,
        .form-group textarea {
            width: 100%;
            padding: 10px;
            border: 2px solid #ddd;
            border-radius: 8px;
            font-size: 14px;
        }

        .form-group input:focus,
        .form-group select:focus,
        .form-group textarea:focus {
            border-color: var(--kolect-primary);
            outline: none;
        }

        .notification {
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            border-radius: 10px;
            color: white;
            font-weight: 600;
            z-index: 1001;
            transform: translateX(100%);
            transition: transform 0.3s ease;
        }

        .notification.show {
            transform: translateX(0);
        }

        .notification.success {
            background: #27ae60;
        }

        .notification.error {
            background: #e74c3c;
        }

        .export-section {
            margin-top: 30px;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 15px;
        }

        .floating-actions {
            position: fixed;
            bottom: 30px;
            right: 30px;
            display: flex;
            flex-direction: column;
            gap: 15px;
        }

        .fab {
            width: 60px;
            height: 60px;
            border-radius: 50%;
            border: none;
            background: var(--gradient);
            color: white;
            font-size: 1.5rem;
            cursor: pointer;
            box-shadow: var(--shadow);
            transition: all 0.3s ease;
        }

        .fab:hover {
            transform: scale(1.1);
        }
    </style>
</head>
<body>
    <div class="admin-container">
        <div class="header">
            <h1>🎯 KOLECT Admin Pro</h1>
            <p>Interface de gestion avancée - Base de données</p>
            <div style="margin-top: 15px; font-size: 0.9rem; color: #666;">
                Dernière mise à jour: ${new Date().toLocaleString('fr-FR')}
            </div>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-number">${collaborators.length}</div>
                <div class="stat-label">Collaborateurs</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${initiatives.length}</div>
                <div class="stat-label">Initiatives</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${scans.length}</div>
                <div class="stat-label">Scans Récents</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${scans.reduce((sum, scan) => sum + (scan.signatures || 0), 0)}</div>
                <div class="stat-label">Signatures Total</div>
            </div>
        </div>

        <div class="tabs">
            <button class="fab" onclick="showTab('actions')" title="Actions">⚡</button>
        <button class="fab" onclick="window.open('/api/scans/debug/tables', '_blank')" title="Debug">🔍</button>
    </div>

    <script>
        // Gestion des onglets
        function showTab(tabName) {
            // Masquer tous les contenus d'onglets
            const tabContents = document.querySelectorAll('.tab-content');
            tabContents.forEach(content => content.classList.remove('active'));

            // Désactiver tous les boutons d'onglets
            const tabButtons = document.querySelectorAll('.tab-button');
            tabButtons.forEach(button => button.classList.remove('active'));

            // Afficher le contenu sélectionné
            document.getElementById(tabName).classList.add('active');

            // Activer le bouton sélectionné
            event.target.classList.add('active');
        }

        // Filtrage des tableaux
        function filterTable(tableId, searchValue) {
            const table = document.getElementById(tableId);
            const rows = table.getElementsByTagName('tr');

            for (let i = 1; i < rows.length; i++) { // Commencer à 1 pour ignorer l'en-tête
                const cells = rows[i].getElementsByTagName('td');
                let found = false;

                for (let j = 0; j < cells.length; j++) {
                    if (cells[j].textContent.toLowerCase().includes(searchValue.toLowerCase())) {
                        found = true;
                        break;
                    }
                }

                rows[i].style.display = found ? '' : 'none';
            }
        }

        // Mise à jour des champs
        async function updateField(table, id, field, value) {
            try {
                const response = await fetch(\`/api/scans/admin/update/\${table}/\${id}\`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ field, value })
                });

                const result = await response.json();

                if (result.success) {
                    showNotification('✅ Modification sauvegardée', 'success');
                } else {
                    showNotification('❌ Erreur: ' + result.error, 'error');
                }
            } catch (error) {
                showNotification('❌ Erreur de connexion', 'error');
                console.error('Erreur:', error);
            }
        }

        // Suppression d'enregistrements
        async function deleteRecord(table, id) {
            if (!confirm('Êtes-vous sûr de vouloir supprimer cet élément ?')) {
                return;
            }

            try {
                const response = await fetch(\`/api/scans/admin/delete/\${table}/\${id}\`, {
                    method: 'DELETE'
                });

                const result = await response.json();

                if (result.success) {
                    showNotification('✅ Élément supprimé', 'success');
                    // Supprimer la ligne du tableau
                    event.target.closest('tr').remove();
                } else {
                    showNotification('❌ Erreur: ' + result.error, 'error');
                }
            } catch (error) {
                showNotification('❌ Erreur de connexion', 'error');
                console.error('Erreur:', error);
            }
        }

        // Afficher les notifications
        function showNotification(message, type) {
            const notification = document.getElementById('notification');
            notification.textContent = message;
            notification.className = \`notification \${type} show\`;

            setTimeout(() => {
                notification.classList.remove('show');
            }, 3000);
        }

        // Modal d'ajout
        function showAddModal(type) {
            const modal = document.getElementById('addModal');
            const formFields = document.getElementById('formFields');
            
            let fieldsHTML = '';
            
            if (type === 'collaborator') {
                fieldsHTML = \`
                    <div class="form-group">
                        <label>Prénom</label>
                        <input type="text" name="first_name" required>
                    </div>
                    <div class="form-group">
                        <label>Nom</label>
                        <input type="text" name="last_name" required>
                    </div>
                    <div class="form-group">
                        <label>Email</label>
                        <input type="email" name="email" required>
                    </div>
                    <div class="form-group">
                        <label>Téléphone</label>
                        <input type="tel" name="phone">
                    </div>
                    <div class="form-group">
                        <label>Mot de passe</label>
                        <input type="password" name="password" required>
                    </div>
                \`;
            } else if (type === 'initiative') {
                fieldsHTML = \`
                    <div class="form-group">
                        <label>Nom</label>
                        <input type="text" name="name" required>
                    </div>
                    <div class="form-group">
                        <label>Description</label>
                        <textarea name="description"></textarea>
                    </div>
                    <div class="form-group">
                        <label>Objectif (signatures)</label>
                        <input type="number" name="objective" value="1000">
                    </div>
                    <div class="form-group">
                        <label>Couleur</label>
                        <input type="color" name="color" value="#4ECDC4">
                    </div>
                \`;
            } else if (type === 'scan') {
                fieldsHTML = \`
                    <div class="form-group">
                        <label>Utilisateur ID</label>
                        <input type="number" name="user_id" required>
                    </div>
                    <div class="form-group">
                        <label>Initiative ID</label>
                        <input type="number" name="initiative_id" required>
                    </div>
                    <div class="form-group">
                        <label>Signatures</label>
                        <input type="number" name="signatures" required>
                    </div>
                    <div class="form-group">
                        <label>Qualité (%)</label>
                        <input type="number" name="quality" value="85" min="0" max="100">
                    </div>
                    <div class="form-group">
                        <label>Confiance (%)</label>
                        <input type="number" name="confidence" value="85" min="0" max="100">
                    </div>
                    <div class="form-group">
                        <label>Notes</label>
                        <textarea name="notes"></textarea>
                    </div>
                \`;
            }
            
            formFields.innerHTML = fieldsHTML;
            modal.style.display = 'block';
            
            // Gérer la soumission du formulaire
            document.getElementById('addForm').onsubmit = async function(e) {
                e.preventDefault();
                await addRecord(type, new FormData(this));
            };
        }

        function closeModal() {
            document.getElementById('addModal').style.display = 'none';
        }

        // Ajouter un nouvel enregistrement
        async function addRecord(type, formData) {
            const data = {};
            for (let [key, value] of formData.entries()) {
                data[key] = value;
            }

            try {
                const response = await fetch(\`/api/scans/admin/add/\${type}\`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });

                const result = await response.json();

                if (result.success) {
                    showNotification('✅ Élément ajouté avec succès', 'success');
                    closeModal();
                    // Recharger la page pour voir le nouvel élément
                    setTimeout(() => window.location.reload(), 1000);
                } else {
                    showNotification('❌ Erreur: ' + result.error, 'error');
                }
            } catch (error) {
                showNotification('❌ Erreur de connexion', 'error');
                console.error('Erreur:', error);
            }
        }

        // Export de tableaux
        function exportTable(tableName) {
            const table = document.getElementById(tableName + '-table');
            const rows = table.querySelectorAll('tr');
            let csv = '';

            rows.forEach(row => {
                const cells = row.querySelectorAll('th, td');
                const rowData = [];
                
                cells.forEach(cell => {
                    // Prendre le texte visible, pas les inputs
                    const input = cell.querySelector('input, select');
                    const text = input ? input.value : cell.textContent.trim();
                    rowData.push('"' + text.replace(/"/g, '""') + '"');
                });
                
                csv += rowData.join(',') + '\\n';
            });

            // Télécharger le fichier CSV
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = \`kolect_\${tableName}_\${new Date().toISOString().split('T')[0]}.csv\`;
            a.click();
            window.URL.revokeObjectURL(url);

            showNotification('📊 Export CSV généré', 'success');
        }

        // Export de toutes les données
        async function exportAll(format) {
            try {
                const response = await fetch(\`/api/scans/admin/export?format=\${format}\`);
                const blob = await response.blob();
                
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = \`kolect_full_export_\${new Date().toISOString().split('T')[0]}.\${format}\`;
                a.click();
                window.URL.revokeObjectURL(url);

                showNotification(\`📊 Export \${format.toUpperCase()} généré\`, 'success');
            } catch (error) {
                showNotification('❌ Erreur d\\'export', 'error');
                console.error('Erreur:', error);
            }
        }

        // Actions d'administration
        async function performAction(action) {
            const confirmMessages = {
                'cleanup': 'Nettoyer les données temporaires ?',
                'backup': 'Créer une sauvegarde de la base ?',
                'reset-setup': 'Reconfigurer la base de données ?',
                'reset-all': 'ATTENTION: Supprimer TOUTES les données ?'
            };

            if (confirmMessages[action] && !confirm(confirmMessages[action])) {
                return;
            }

            try {
                const response = await fetch(\`/api/scans/admin/action/\${action}\`, {
                    method: 'POST'
                });

                const result = await response.json();

                if (result.success) {
                    showNotification(\`✅ \${result.message}\`, 'success');
                    if (action.includes('reset')) {
                        setTimeout(() => window.location.reload(), 2000);
                    }
                } else {
                    showNotification('❌ Erreur: ' + result.error, 'error');
                }
            } catch (error) {
                showNotification('❌ Erreur de connexion', 'error');
                console.error('Erreur:', error);
            }
        }

        // Génération de rapports
        async function generateReport(type) {
            try {
                const response = await fetch(\`/api/scans/admin/report/\${type}\`);
                const blob = await response.blob();
                
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = \`kolect_rapport_\${type}_\${new Date().toISOString().split('T')[0]}.pdf\`;
                a.click();
                window.URL.revokeObjectURL(url);

                showNotification(\`📊 Rapport \${type} généré\`, 'success');
            } catch (error) {
                showNotification('❌ Erreur de génération', 'error');
                console.error('Erreur:', error);
            }
        }

        // Fermer la modal en cliquant à l'extérieur
        window.onclick = function(event) {
            const modal = document.getElementById('addModal');
            if (event.target === modal) {
                closeModal();
            }
        }

        // Auto-refresh toutes les 5 minutes
        setInterval(() => {
            const lastRefresh = document.querySelector('.header .timestamp');
            if (lastRefresh) {
                lastRefresh.textContent = 'Dernière mise à jour: ' + new Date().toLocaleString('fr-FR');
            }
        }, 300000);
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

// Endpoints pour les actions admin (à implémenter selon tes besoins)
router.put('/admin/update/:table/:id', async (req, res) => {
  try {
    const { table, id } = req.params;
    const { field, value } = req.body;

    // Validation basique
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

module.exports = router;="tab-button active" onclick="showTab('collaborators')">👥 Collaborateurs</button>
            <button class="tab-button" onclick="showTab('initiatives')">🎯 Initiatives</button>
            <button class="tab-button" onclick="showTab('scans')">📸 Scans</button>
            <button class="tab-button" onclick="showTab('actions')">⚡ Actions</button>
        </div>

        <!-- Onglet Collaborateurs -->
        <div id="collaborators" class="tab-content active">
            <div class="actions-bar">
                <input type="text" class="search-box" placeholder="Rechercher un collaborateur..." onkeyup="filterTable('collaborators-table', this.value)">
                <button class="btn btn-primary" onclick="showAddModal('collaborator')">➕ Nouveau Collaborateur</button>
                <button class="btn btn-success" onclick="exportTable('collaborators')">📊 Exporter CSV</button>
            </div>
            
            <div class="table-container">
                <table id="collaborators-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Prénom</th>
                            <th>Nom</th>
                            <th>Email</th>
                            <th>Téléphone</th>
                            <th>Statut</th>
                            <th>Date Création</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${collaborators.map(collab => `
                            <tr>
                                <td><strong>${collab.id}</strong></td>
                                <td><input class="editable" value="${collab.first_name || ''}" onchange="updateField('collaborators', ${collab.id}, 'first_name', this.value)"></td>
                                <td><input class="editable" value="${collab.last_name || ''}" onchange="updateField('collaborators', ${collab.id}, 'last_name', this.value)"></td>
                                <td><input class="editable" value="${collab.email || ''}" onchange="updateField('collaborators', ${collab.id}, 'email', this.value)"></td>
                                <td><input class="editable" value="${collab.phone || ''}" onchange="updateField('collaborators', ${collab.id}, 'phone', this.value)"></td>
                                <td>
                                    <select class="editable" onchange="updateField('collaborators', ${collab.id}, 'status', this.value)">
                                        <option value="active" ${collab.status === 'active' ? 'selected' : ''}>Actif</option>
                                        <option value="inactive" ${collab.status === 'inactive' ? 'selected' : ''}>Inactif</option>
                                        <option value="suspended" ${collab.status === 'suspended' ? 'selected' : ''}>Suspendu</option>
                                    </select>
                                </td>
                                <td>${new Date(collab.created_at).toLocaleDateString('fr-FR')}</td>
                                <td>
                                    <button class="btn btn-danger" onclick="deleteRecord('collaborators', ${collab.id})">🗑️</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Onglet Initiatives -->
        <div id="initiatives" class="tab-content">
            <div class="actions-bar">
                <input type="text" class="search-box" placeholder="Rechercher une initiative..." onkeyup="filterTable('initiatives-table', this.value)">
                <button class="btn btn-primary" onclick="showAddModal('initiative')">➕ Nouvelle Initiative</button>
                <button class="btn btn-success" onclick="exportTable('initiatives')">📊 Exporter CSV</button>
            </div>
            
            <div class="table-container">
                <table id="initiatives-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Nom</th>
                            <th>Description</th>
                            <th>Objectif</th>
                            <th>Couleur</th>
                            <th>Statut</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${initiatives.map(initiative => `
                            <tr>
                                <td><strong>${initiative.id}</strong></td>
                                <td><input class="editable" value="${initiative.name || ''}" onchange="updateField('initiatives', ${initiative.id}, 'name', this.value)"></td>
                                <td><input class="editable" value="${initiative.description || ''}" onchange="updateField('initiatives', ${initiative.id}, 'description', this.value)"></td>
                                <td><input class="editable" type="number" value="${initiative.objective || 0}" onchange="updateField('initiatives', ${initiative.id}, 'objective', this.value)"></td>
                                <td>
                                    <input class="editable" type="color" value="${initiative.color || '#4ECDC4'}" onchange="updateField('initiatives', ${initiative.id}, 'color', this.value)" style="width: 50px;">
                                    <span style="margin-left: 10px;">${initiative.color || '#4ECDC4'}</span>
                                </td>
                                <td>
                                    <select class="editable" onchange="updateField('initiatives', ${initiative.id}, 'status', this.value)">
                                        <option value="active" ${initiative.status === 'active' ? 'selected' : ''}>Active</option>
                                        <option value="paused" ${initiative.status === 'paused' ? 'selected' : ''}>En pause</option>
                                        <option value="completed" ${initiative.status === 'completed' ? 'selected' : ''}>Terminée</option>
                                    </select>
                                </td>
                                <td>
                                    <button class="btn btn-danger" onclick="deleteRecord('initiatives', ${initiative.id})">🗑️</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Onglet Scans -->
        <div id="scans" class="tab-content">
            <div class="actions-bar">
                <input type="text" class="search-box" placeholder="Rechercher un scan..." onkeyup="filterTable('scans-table', this.value)">
                <button class="btn btn-primary" onclick="showAddModal('scan')">➕ Nouveau Scan</button>
                <button class="btn btn-success" onclick="exportTable('scans')">📊 Exporter CSV</button>
            </div>
            
            <div class="table-container">
                <table id="scans-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Collecteur</th>
                            <th>Initiative</th>
                            <th>Signatures</th>
                            <th>Qualité</th>
                            <th>Confiance</th>
                            <th>Notes</th>
                            <th>Date</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${scans.map(scan => `
                            <tr>
                                <td><strong>${scan.id}</strong></td>
                                <td>${scan.first_name} ${scan.last_name}</td>
                                <td><strong>${scan.initiative_name}</strong></td>
                                <td><input class="editable" type="number" value="${scan.signatures || 0}" onchange="updateField('scans', ${scan.id}, 'signatures', this.value)"></td>
                                <td><input class="editable" type="number" min="0" max="100" value="${scan.quality || 85}" onchange="updateField('scans', ${scan.id}, 'quality', this.value)">%</td>
                                <td><input class="editable" type="number" min="0" max="100" value="${scan.confidence || 85}" onchange="updateField('scans', ${scan.id}, 'confidence', this.value)">%</td>
                                <td><input class="editable" value="${scan.notes || ''}" onchange="updateField('scans', ${scan.id}, 'notes', this.value)"></td>
                                <td>${new Date(scan.created_at).toLocaleDateString('fr-FR')}</td>
                                <td>
                                    <button class="btn btn-danger" onclick="deleteRecord('scans', ${scan.id})">🗑️</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Onglet Actions -->
        <div id="actions" class="tab-content">
            <h2>⚡ Actions d'Administration</h2>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-top: 20px;">
                <div style="background: #f8f9fa; padding: 20px; border-radius: 15px;">
                    <h3>🔧 Maintenance Base</h3>
                    <p>Opérations de maintenance et nettoyage</p>
                    <div style="margin-top: 15px;">
                        <button class="btn btn-primary" onclick="performAction('cleanup')">🧹 Nettoyer Données</button>
                        <button class="btn btn-primary" onclick="performAction('backup')">💾 Backup DB</button>
                    </div>
                </div>

                <div style="background: #f8f9fa; padding: 20px; border-radius: 15px;">
                    <h3>📊 Export Données</h3>
                    <p>Exporter toutes les données en différents formats</p>
                    <div style="margin-top: 15px;">
                        <button class="btn btn-success" onclick="exportAll('csv')">📄 Export CSV</button>
                        <button class="btn btn-success" onclick="exportAll('json')">📋 Export JSON</button>
                    </div>
                </div>

                <div style="background: #f8f9fa; padding: 20px; border-radius: 15px;">
                    <h3>🔄 Reconfiguration</h3>
                    <p>Réinitialiser ou reconfigurer la base</p>
                    <div style="margin-top: 15px;">
                        <button class="btn btn-primary" onclick="performAction('reset-setup')">🔄 Re-setup</button>
                        <button class="btn btn-danger" onclick="performAction('reset-all')">⚠️ Reset Total</button>
                    </div>
                </div>

                <div style="background: #f8f9fa; padding: 20px; border-radius: 15px;">
                    <h3>📈 Statistiques</h3>
                    <p>Générer des rapports et statistiques</p>
                    <div style="margin-top: 15px;">
                        <button class="btn btn-primary" onclick="generateReport('monthly')">📊 Rapport Mensuel</button>
                        <button class="btn btn-primary" onclick="generateReport('performance')">⚡ Performance</button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Modal d'ajout -->
    <div id="addModal" class="modal">
        <div class="modal-content">
            <span class="close" onclick="closeModal()">&times;</span>
            <h2>➕ Ajouter un nouvel élément</h2>
            <form id="addForm">
                <div id="formFields"></div>
                <button type="submit" class="btn btn-primary">Ajouter</button>
                <button type="button" class="btn" onclick="closeModal()">Annuler</button>
            </form>
        </div>
    </div>

    <!-- Notification -->
    <div id="notification" class="notification"></div>

    <!-- Actions flottantes -->
    <div class="floating-actions">
        <button class="fab" onclick="window.location.reload()" title="Actualiser">🔄</button>
        <button class
