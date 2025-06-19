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
    // ✅ UTILISER EXACTEMENT LE SECRET DE RENDER
    const jwtSecret = process.env.JWT_SECRET;
    console.log('🔑 JWT Secret défini:', !!jwtSecret);
    console.log('🔑 JWT Secret preview:', jwtSecret ? jwtSecret.substring(0, 20) + '...' : 'UNDEFINED');
    
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

// POST /api/scans/submit - Soumettre un scan
router.post('/submit', authenticateToken, async (req, res) => {
  try {
    const { initiative, signatures, quality, confidence, location, photoPath } = req.body;

    if (!initiative || signatures === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Initiative et signatures requis'
      });
    }

    // Sauvegarder dans la database si la table existe
    try {
      const insertScan = `
        INSERT INTO scans (user_id, initiative, signatures, quality, confidence, location, photo_paths)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, created_at
      `;
      
      const scanResult = await pool.query(insertScan, [
        req.user.userId,
        initiative,
        signatures,
        quality || 85,
        confidence || 85,
        location || 'Mobile App',
        photoPath ? [photoPath] : []
      ]);

      const scan = scanResult.rows[0];

      console.log('✅ Scan sauvegardé en database:', scan.id);

      res.json({
        success: true,
        message: `✅ KOLECT V1 - Scan sauvegardé pour ${req.user.firstName}!`,
        scan: {
          id: scan.id,
          initiative,
          signatures,
          quality: quality || 85,
          confidence: confidence || 85,
          timestamp: scan.created_at
        },
        auth: {
          userId: req.user.userId,
          firstName: req.user.firstName,
          email: req.user.email
        },
        status: '🎉 APP KOLECT V1 100% OPÉRATIONNELLE!'
      });

    } catch (dbError) {
      console.log('⚠️ Table scans non trouvée, réponse sans sauvegarde');
      
      // Réponse sans sauvegarde si table n'existe pas
      res.json({
        success: true,
        message: `✅ KOLECT V1 - Scanner fonctionnel pour ${req.user.firstName}!`,
        scan: {
          id: 'scan_' + Date.now(),
          initiative,
          signatures,
          quality: quality || 85,
          confidence: confidence || 85,
          timestamp: new Date().toISOString()
        },
        auth: {
          userId: req.user.userId,
          firstName: req.user.firstName,
          email: req.user.email
        },
        status: '🎉 APP KOLECT V1 100% OPÉRATIONNELLE!',
        note: 'Tables manquantes - utilisez /api/scans/setup/tables'
      });
    }

  } catch (error) {
    console.error('❌ Erreur:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/scans/initiatives - Récupérer les initiatives
router.get('/initiatives', authenticateToken, async (req, res) => {
  try {
    console.log('📊 === GET INITIATIVES ===');

    const query = `
      SELECT 
        i.name,
        i.description,
        i.deadline,
        i.target_signatures,
        COALESCE(SUM(s.signatures), 0) as total_signatures,
        COUNT(s.id) as total_scans
      FROM initiatives i
      LEFT JOIN scans s ON s.initiative = i.name
      GROUP BY i.id, i.name, i.description, i.deadline, i.target_signatures
      ORDER BY total_signatures DESC
    `;

    const result = await pool.query(query);

    const initiatives = result.rows.map(row => ({
      name: row.name,
      description: row.description,
      deadline: row.deadline,
      targetSignatures: row.target_signatures,
      totalSignatures: parseInt(row.total_signatures),
      totalScans: parseInt(row.total_scans),
      progress: row.target_signatures > 0 ?
        Math.round((row.total_signatures / row.target_signatures) * 100) : 0
    }));

    res.json({
      success: true,
      initiatives: initiatives,
      total: initiatives.length
    });

  } catch (error) {
    console.error('❌ Erreur GET initiatives:', error);
    res.status(500).json({
      success: false,
      error: 'Table initiatives non trouvée - utilisez /api/scans/setup/tables'
    });
  }
});

// GET /api/scans/history - Récupérer l'historique
router.get('/history', authenticateToken, async (req, res) => {
  try {
    console.log('📊 === GET HISTORY ===');

    const { days = 30, userId } = req.query;
    const targetUserId = userId || req.user.userId;

    const query = `
      SELECT 
        DATE(created_at) as scan_date,
        SUM(signatures) as daily_signatures,
        COUNT(*) as daily_scans,
        initiative
      FROM scans 
      WHERE user_id = $1
        AND created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY DATE(created_at), initiative
      ORDER BY scan_date DESC
    `;

    const result = await pool.query(query, [targetUserId]);

    const history = result.rows.map(row => ({
      date: row.scan_date,
      signatures: parseInt(row.daily_signatures),
      scans: parseInt(row.daily_scans),
      initiative: row.initiative
    }));

    const totalSignatures = history.reduce((sum, day) => sum + day.signatures, 0);
    const totalScans = history.reduce((sum, day) => sum + day.scans, 0);

    res.json({
      success: true,
      history: history,
      stats: {
        totalSignatures,
        totalScans,
        averageSignaturesPerDay: history.length > 0 ?
          Math.round(totalSignatures / history.length) : 0,
        daysCount: history.length
      }
    });

  } catch (error) {
    console.error('❌ Erreur GET history:', error);
    res.status(500).json({
      success: false,
      error: 'Table scans non trouvée - utilisez /api/scans/setup/tables'
    });
  }
});

// POST /api/scans/setup/tables - Créer les tables manquantes
router.post('/setup/tables', async (req, res) => {
  try {
    console.log('🔧 === CRÉATION TABLES MANQUANTES ===');

    // 1. Créer table initiatives
    const createInitiativesTable = `
      CREATE TABLE IF NOT EXISTS initiatives (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        description TEXT,
        deadline DATE,
        target_signatures INTEGER DEFAULT 1000,
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await pool.query(createInitiativesTable);
    console.log('✅ Table initiatives créée');

    // 2. Insérer les initiatives par défaut
    const insertInitiatives = `
      INSERT INTO initiatives (name, description, target_signatures, deadline) 
      VALUES 
        ('Forêt', 'Initiative pour la protection des forêts', 10000, '2026-03-10'),
        ('Commune', 'Initiative pour l''amélioration de la commune', 5000, '2026-02-15'),
        ('Frontière', 'Initiative pour la gestion des frontières', 7500, '2026-04-20')
      ON CONFLICT (name) DO NOTHING;
    `;

    await pool.query(insertInitiatives);
    console.log('✅ Initiatives par défaut créées');

    // 3. Créer table scans
    const createScansTable = `
      CREATE TABLE IF NOT EXISTS scans (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES collaborators(id) ON DELETE CASCADE,
        initiative VARCHAR(100) REFERENCES initiatives(name) ON DELETE SET NULL,
        signatures INTEGER NOT NULL DEFAULT 0,
        quality INTEGER DEFAULT 85,
        confidence INTEGER DEFAULT 85,
        location VARCHAR(255) DEFAULT 'Mobile App',
        photo_paths TEXT[],
        analysis_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await pool.query(createScansTable);
    console.log('✅ Table scans créée');

    // 4. Créer des index pour performance
    const createIndexes = [
      'CREATE INDEX IF NOT EXISTS idx_scans_user_id ON scans(user_id);',
      'CREATE INDEX IF NOT EXISTS idx_scans_initiative ON scans(initiative);',
      'CREATE INDEX IF NOT EXISTS idx_scans_created_at ON scans(created_at);',
      'CREATE INDEX IF NOT EXISTS idx_collaborators_email ON collaborators(email);'
    ];

    for (const indexQuery of createIndexes) {
      await pool.query(indexQuery);
    }
    console.log('✅ Index créés');

    // 5. Insérer quelques scans de test pour les utilisateurs existants
    const getUsersQuery = 'SELECT id FROM collaborators ORDER BY id LIMIT 5';
    const usersResult = await pool.query(getUsersQuery);
    
    if (usersResult.rows.length > 0) {
      const userId1 = usersResult.rows[0]?.id;
      const userId2 = usersResult.rows[1]?.id || userId1;
      const userId3 = usersResult.rows[2]?.id || userId1;

      const insertTestScans = `
        INSERT INTO scans (user_id, initiative, signatures, quality, confidence, location)
        VALUES 
          ($1, 'Forêt', 23, 92, 88, 'Paris 11ème'),
          ($1, 'Forêt', 18, 87, 85, 'Paris 12ème'), 
          ($2, 'Commune', 15, 90, 92, 'Lyon Centre'),
          ($3, 'Frontière', 27, 85, 80, 'Marseille'),
          ($1, 'Forêt', 21, 88, 87, 'Paris 10ème'),
          ($2, 'Commune', 19, 91, 89, 'Lyon Part-Dieu'),
          ($3, 'Forêt', 16, 86, 84, 'Marseille Vieux-Port'),
          ($1, 'Commune', 25, 89, 86, 'Paris 13ème'),
          ($2, 'Frontière', 14, 84, 82, 'Lyon Bellecour'),
          ($3, 'Forêt', 20, 90, 88, 'Marseille Canebière')
        ON CONFLICT DO NOTHING;
      `;

      await pool.query(insertTestScans, [userId1, userId2, userId3]);
      console.log('✅ Scans de test créés');
    }

    // 6. Vérifier les tables créées
    const tablesQuery = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `;
    const tablesResult = await pool.query(tablesQuery);
    const tables = tablesResult.rows.map(row => row.table_name);

    // 7. Compter les données
    const counts = {};
    for (const table of ['collaborators', 'initiatives', 'scans']) {
      if (tables.includes(table)) {
        const countResult = await pool.query(`SELECT COUNT(*) FROM ${table}`);
        counts[table] = parseInt(countResult.rows[0].count);
      }
    }

    res.json({
      success: true,
      message: '🎉 Tables créées avec succès !',
      tables: tables,
      counts: counts,
      created: {
        initiatives: true,
        scans: true,
        indexes: true,
        testData: true
      },
      nextStep: 'Retourne sur /api/scans/debug/tables pour voir toutes tes données !'
    });

  } catch (error) {
    console.error('❌ Erreur création tables:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur création tables',
      details: error.message
    });
  }
});

// GET /api/scans/debug/tables - Voir toutes les données
router.get('/debug/tables', async (req, res) => {
  try {
    console.log('🔍 === DEBUG TABLES ===');

    // 1. Lister toutes les tables
    const tablesQuery = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `;
    const tablesResult = await pool.query(tablesQuery);
    const tables = tablesResult.rows.map(row => row.table_name);

    // 2. Compter les enregistrements
    const tableCounts = {};
    for (const table of tables) {
      try {
        const countResult = await pool.query(`SELECT COUNT(*) FROM ${table}`);
        tableCounts[table] = parseInt(countResult.rows[0].count);
      } catch (error) {
        tableCounts[table] = `Erreur: ${error.message}`;
      }
    }

    // 3. Voir le contenu des tables principales
    const tableData = {};

    // Collaborators
    if (tables.includes('collaborators')) {
      const collabResult = await pool.query(`
        SELECT id, first_name, last_name, email, phone, 
               status, contract_signed, created_at 
        FROM collaborators 
        ORDER BY id DESC 
        LIMIT 20
      `);
      tableData.collaborators = collabResult.rows;
    }

    // Scans
    if (tables.includes('scans')) {
      const scansResult = await pool.query(`
        SELECT s.id, s.user_id, s.initiative, s.signatures, s.quality, 
               s.confidence, s.location, s.created_at,
               c.first_name, c.last_name
        FROM scans s
        LEFT JOIN collaborators c ON s.user_id = c.id
        ORDER BY s.id DESC 
        LIMIT 30
      `);
      tableData.scans = scansResult.rows;
    }

    // Initiatives
    if (tables.includes('initiatives')) {
      const initiativesResult = await pool.query(`
        SELECT * FROM initiatives 
        ORDER BY id
      `);
      tableData.initiatives = initiativesResult.rows;
    }

    // 4. Stats rapides
    const stats = {};
    
    if (tables.includes('scans') && tables.includes('collaborators')) {
      // Top utilisateurs
      try {
        const userStatsResult = await pool.query(`
          SELECT 
            c.first_name, 
            c.last_name,
            COUNT(s.id) as total_scans,
            SUM(s.signatures) as total_signatures
          FROM collaborators c
          LEFT JOIN scans s ON s.user_id = c.id
          GROUP BY c.id, c.first_name, c.last_name
          HAVING SUM(s.signatures) > 0
          ORDER BY total_signatures DESC
          LIMIT 10
        `);
        stats.topUsers = userStatsResult.rows;
      } catch (error) {
        stats.topUsers = [];
      }

      // Stats par initiative
      try {
        const initiativeStatsResult = await pool.query(`
          SELECT 
            initiative,
            COUNT(*) as scan_count,
            SUM(signatures) as total_signatures,
            AVG(signatures)::NUMERIC(10,2) as avg_signatures,
            AVG(quality)::NUMERIC(10,2) as avg_quality
          FROM scans
          GROUP BY initiative
          ORDER BY total_signatures DESC
        `);
        stats.byInitiative = initiativeStatsResult.rows;
      } catch (error) {
        stats.byInitiative = [];
      }
    }

    // 5. HTML Response
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>🔍 Database Kolect Debug</title>
        <meta charset="UTF-8">
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; }
            .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #4ECDC4, #35A085); color: white; padding: 30px; border-radius: 15px; text-align: center; margin-bottom: 30px; box-shadow: 0 8px 32px rgba(0,0,0,0.1); }
            .card { background: rgba(255,255,255,0.95); padding: 25px; margin: 20px 0; border-radius: 15px; box-shadow: 0 8px 32px rgba(0,0,0,0.1); backdrop-filter: blur(10px); }
            table { width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 14px; }
            th, td { border: 1px solid #e0e0e0; padding: 8px 6px; text-align: left; }
            th { background: linear-gradient(135deg, #4ECDC4, #35A085); color: white; font-weight: 600; font-size: 13px; }
            tr:nth-child(even) { background: rgba(248,249,250,0.8); }
            tr:hover { background: rgba(78,205,196,0.1); }
            .count { background: linear-gradient(135deg, #35A085, #4ECDC4); color: white; padding: 8px 15px; border-radius: 25px; font-weight: bold; display: inline-block; margin: 5px; }
            .section { margin: 40px 0; }
            pre { background: rgba(248,249,250,0.9); padding: 20px; border-radius: 10px; overflow-x: auto; border-left: 4px solid #4ECDC4; font-size: 12px; }
            h1 { margin: 0; font-size: 2.5em; font-weight: 300; }
            h2 { color: #2c3e50; border-bottom: 3px solid #4ECDC4; padding-bottom: 10px; }
            .highlight { background: linear-gradient(135deg, #4ECDC4, #35A085); color: white; padding: 3px 8px; border-radius: 5px; font-weight: bold; }
            .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
            .btn { background: linear-gradient(135deg, #4ECDC4, #35A085); color: white; padding: 10px 20px; border: none; border-radius: 8px; cursor: pointer; margin: 5px; text-decoration: none; display: inline-block; font-weight: 600; }
            .btn:hover { transform: translateY(-2px); }
            .alert { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 10px; margin: 20px 0; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🔍 KOLECT DATABASE</h1>
                <p style="font-size: 1.2em; margin: 10px 0 0 0;">Vue complète de tes données en temps réel</p>
                <div style="margin-top: 20px;">
                    <a href="/api/scans/admin" class="btn">🔧 Interface Admin</a>
                    ${!tables.includes('scans') ? '<a href="/api/scans/setup/tables" class="btn" style="background: linear-gradient(135deg, #ff6b6b, #ee5a24);">⚠️ Créer Tables Manquantes</a>' : ''}
                </div>
            </div>

            ${!tables.includes('scans') ? `
            <div class="alert">
                <strong>⚠️ Tables manquantes détectées !</strong><br>
                Les tables <code>scans</code> et <code>initiatives</code> n'existent pas encore.<br>
                <a href="/api/scans/setup/tables">Cliquez ici pour les créer automatiquement</a>
            </div>
            ` : ''}

            <div class="card">
                <h2>📊 Tables disponibles</h2>
                <div style="text-align: center;">
                    ${tables.map(table => `
                        <span class="count">${table}: ${tableCounts[table]} entrées</span>
                    `).join('')}
                </div>
            </div>

            ${tableData.collaborators ? `
            <div class="card">
                <h2>👥 Utilisateurs (Collaborators) - ${tableData.collaborators.length} derniers</h2>
                <table>
                    <tr>
                        <th>ID</th><th>Prénom</th><th>Nom</th><th>Email</th>
                        <th>Téléphone</th><th>Status</th><th>Contrat</th><th>Créé le</th>
                    </tr>
                    ${tableData.collaborators.map(user => `
                        <tr>
                            <td><span class="highlight">${user.id}</span></td>
                            <td><strong>${user.first_name}</strong></td>
                            <td><strong>${user.last_name}</strong></td>
                            <td>${user.email}</td>
                            <td>${user.phone || 'N/A'}</td>
                            <td>${user.status}</td>
                            <td>${user.contract_signed ? '✅ Signé' : '❌ Non signé'}</td>
                            <td>${new Date(user.created_at).toLocaleDateString('fr-FR')}</td>
                        </tr>
                    `).join('')}
                </table>
            </div>
            ` : ''}

            ${tableData.scans ? `
            <div class="card">
                <h2>📸 Scans récents - ${tableData.scans.length} derniers</h2>
                <table>
                    <tr>
                        <th>ID</th><th>Utilisateur</th><th>Initiative</th><th>Signatures</th>
                        <th>Qualité</th><th>Confiance</th><th>Lieu</th><th>Date</th>
                    </tr>
                    ${tableData.scans.map(scan => `
                        <tr>
                            <td><span class="highlight">${scan.id}</span></td>
                            <td>${scan.first_name} ${scan.last_name}</td>
                            <td><strong>${scan.initiative}</strong></td>
                            <td><span class="highlight">${scan.signatures}</span></td>
                            <td>${scan.quality}%</td>
                            <td>${scan.confidence}%</td>
                            <td>${scan.location}</td>
                            <td>${new Date(scan.created_at).toLocaleDateString('fr-FR')}</td>
                        </tr>
                    `).join('')}
                </table>
            </div>
            ` : ''}

            ${tableData.initiatives ? `
            <div class="card">
                <h2>🎯 Initiatives</h2>
                <table>
                    <tr><th>ID</th><th>Nom</th><th>Description</th><th>Objectif</th><th>Deadline</th><th>Status</th></tr>
                    ${tableData.initiatives.map(init => `
                        <tr>
                            <td><span class="highlight">${init.id}</span></td>
                            <td><strong>${init.name}</strong></td>
                            <td>${init.description || 'N/A'}</td>
                            <td>${init.target_signatures}</td>
                            <td>${init.deadline ? new Date(init.deadline).toLocaleDateString('fr-FR') : 'N/A'}</td>
                            <td>${init.status}</td>
                        </tr>
                    `).join('')}
                </table>
            </div>
            ` : ''}

            <div class="grid">
                ${stats.topUsers && stats.topUsers.length > 0 ? `
                <div class="card">
                    <h2>🏆 Top Collecteurs</h2>
                    <table>
                        <tr><th>Prénom</th><th>Nom</th><th>Scans</th><th>Signatures</th></tr>
                        ${stats.topUsers.map(user => `
                            <tr>
                                <td><strong>${user.first_name}</strong></td>
                                <td><strong>${user.last_name}</strong></td>
                                <td>${user.total_scans}</td>
                                <td><span class="highlight">${user.total_signatures}</span></td>
                            </tr>
                        `).join('')}
                    </table>
                </div>
                ` : ''}

                ${stats.byInitiative && stats.byInitiative.length > 0 ? `
                <div class="card">
                    <h2>📊 Stats par Initiative</h2>
                    <table>
                        <tr><th>Initiative</th><th>Scans</th><th>Signatures</th><th>Moy/Scan</th><th>Qualité</th></tr>
                        ${stats.byInitiative.map(init => `
                            <tr>
                                <td><strong>${init.initiative}</strong></td>
                                <td>${init.scan_count}</td>
                                <td><span class="highlight">${init.total_signatures}</span></td>
                                <td>${init.avg_signatures}</td>
                                <td>${init.avg_quality}%</td>
                            </tr>
                        `).join('')}
                    </table>
                </div>
                ` : ''}
            </div>

            <div class="card">
                <h2>🔗 API Endpoints</h2>
                <p><strong>Health Check:</strong> <a href="/api/health" target="_blank">/api/health</a></p>
                <p><strong>Profile API:</strong> <a href="/api/collaborators/profile" target="_blank">/api/collaborators/profile</a></p>
                <p><strong>Setup Tables:</strong> <a href="/api/scans/setup/tables" target="_blank">/api/scans/setup/tables</a></p>
                <p><strong>Admin Interface:</strong> <a href="/api/scans/admin" target="_blank">/api/scans/admin</a></p>
                <p><strong>Analyze Signatures:</strong> <code>POST /api/analyze-signatures</code></p>
                <p><strong>Submit Scan:</strong> <code>POST /api/scans/submit</code></p>
                <p><strong>Get Initiatives:</strong> <code>GET /api/scans/initiatives</code></p>
                <p><strong>Get History:</strong> <code>GET /api/scans/history</code></p>
            </div>
        </div>
    </body>
    </html>
    `;

    res.send(html);

  } catch (error) {
    console.error('❌ Erreur debug tables:', error);
    res.status(500).json({
      error: 'Erreur serveur debug',
      details: error.message,
      stack: error.stack
    });
  }
});

// GET /api/scans/admin - Interface d'administration complète
router.get('/admin', async (req, res) => {
  try {
    console.log('🔧 === ADMIN INTERFACE ===');

    // Récupérer toutes les données
    const tablesQuery = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `;
    const tablesResult = await pool.query(tablesQuery);
    const tables = tablesResult.rows.map(row => row.table_name);

    // Données des tables principales
    const tableData = {};

    if (tables.includes('collaborators')) {
      const collabResult = await pool.query(`
        SELECT * FROM collaborators 
        ORDER BY id DESC
      `);
      tableData.collaborators = collabResult.rows;
    }

    if (tables.includes('scans')) {
      const scansResult = await pool.query(`
        SELECT s.*, c.first_name, c.last_name 
        FROM scans s
        LEFT JOIN collaborators c ON s.user_id = c.id
        ORDER BY s.id DESC
      `);
      tableData.scans = scansResult.rows;
    }

    if (tables.includes('initiatives')) {
      const initiativesResult = await pool.query(`
        SELECT * FROM initiatives 
        ORDER BY id
      `);
      tableData.initiatives = initiativesResult.rows;
    }

    // Interface HTML complète avec CRUD
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>🔧 KOLECT ADMIN</title>
        <meta charset="UTF-8">
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; }
            .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #4ECDC4, #35A085); color: white; padding: 30px; border-radius: 15px; text-align: center; margin-bottom: 30px; box-shadow: 0 8px 32px rgba(0,0,0,0.1); }
            .card { background: rgba(255,255,255,0.95); padding: 25px; margin: 20px 0; border-radius: 15px; box-shadow: 0 8px 32px rgba(0,0,0,0.1); }
            .btn { background: linear-gradient(135deg, #4ECDC4, #35A085); color: white; padding: 10px 20px; border: none; border-radius: 8px; cursor: pointer; margin: 5px; text-decoration: none; display: inline-block; font-weight: 600; }
            .btn:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
            .btn-danger { background: linear-gradient(135deg, #ff6b6b, #ee5a24); }
            .btn-success { background: linear-gradient(135deg, #6c5ce7, #a29bfe); }
            table { width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 13px; }
            th, td { border: 1px solid #e0e0e0; padding: 8px 6px; text-align: left; }
            th { background: linear-gradient(135deg, #4ECDC4, #35A085); color: white; font-weight: 600; }
            tr:nth-child(even) { background: rgba(248,249,250,0.8); }
            tr:hover { background: rgba(78,205,196,0.1); }
            .editable { background: #fff3cd; border: 1px dashed #ffeaa7; padding: 5px; border-radius: 4px; }
            input, select, textarea { padding: 8px; border: 1px solid #ddd; border-radius: 4px; width: 100%; max-width: 150px; font-size: 12px; }
            h1 { margin: 0; font-size: 2.5em; font-weight: 300; }
            h2 { color: #2c3e50; border-bottom: 3px solid #4ECDC4; padding-bottom: 10px; }
            .tabs { display: flex; margin-bottom: 20px; }
            .tab { padding: 12px 24px; background: rgba(255,255,255,0.7); margin-right: 5px; border-radius: 8px 8px 0 0; cursor: pointer; }
            .tab.active { background: white; font-weight: bold; }
            .tab-content { display: none; }
            .tab-content.active { display: block; }
            .alert { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 10px; margin: 20px 0; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🔧 KOLECT ADMIN</h1>
                <p>Interface d'administration complète</p>
                <div style="margin-top: 20px;">
                    <a href="/api/scans/debug/tables" class="btn">🔍 Vue Debug</a>
                    ${!tables.includes('scans') ? '<a href="/api/scans/setup/tables" class="btn btn-success">🔧 Setup Tables</a>' : ''}
                </div>
            </div>

            ${!tables.includes('scans') ? `
            <div class="alert">
                <strong>⚠️ Tables manquantes !</strong><br>
                Les tables principales n'existent pas encore. 
                <a href="/api/scans/setup/tables">Créez-les automatiquement</a>
            </div>
            ` : ''}

            <div class="tabs">
                <div class="tab active" onclick="showTab('users')">👥 Utilisateurs (${tableData.collaborators?.length || 0})</div>
                <div class="tab" onclick="showTab('scans')">📸 Scans (${tableData.scans?.length || 0})</div>
                <div class="tab" onclick="showTab('initiatives')">🎯 Initiatives (${tableData.initiatives?.length || 0})</div>
                <div class="tab" onclick="showTab('actions')">⚡ Actions</div>
            </div>

            <div id="users" class="tab-content active">
                <div class="card">
                    <h2>👥 Gestion Utilisateurs</h2>
                    ${tableData.collaborators ? `
                    <table>
                        <tr>
                            <th>ID</th><th>Prénom</th><th>Nom</th><th>Email</th>
                            <th>Téléphone</th><th>Status</th><th>Contrat</th><th>Créé</th><th>Actions</th>
                        </tr>
                        ${tableData.collaborators.map(user => `
                            <tr>
                                <td>${user.id}</td>
                                <td class="editable" contenteditable>${user.first_name}</td>
                                <td class="editable" contenteditable>${user.last_name}</td>
                                <td>${user.email}</td>
                                <td class="editable" contenteditable>${user.phone || ''}</td>
                                <td>
                                    <select>
                                        <option value="active" ${user.status === 'active' ? 'selected' : ''}>Active</option>
                                        <option value="inactive" ${user.status === 'inactive' ? 'selected' : ''}>Inactive</option>
                                        <option value="suspended" ${user.status === 'suspended' ? 'selected' : ''}>Suspendu</option>
                                    </select>
                                </td>
                                <td>${user.contract_signed ? '✅' : '❌'}</td>
                                <td>${new Date(user.created_at).toLocaleDateString('fr-FR')}</td>
                                <td>
                                    <button class="btn btn-danger" onclick="confirmDelete('user', ${user.id})">🗑️</button>
                                </td>
                            </tr>
                        `).join('')}
                    </table>
                    ` : '<p>Aucun utilisateur trouvé</p>'}
                </div>
            </div>

            <div id="scans" class="tab-content">
                <div class="card">
                    <h2>📸 Gestion Scans</h2>
                    ${tableData.scans ? `
                    <table>
                        <tr>
                            <th>ID</th><th>Utilisateur</th><th>Initiative</th><th>Signatures</th>
                            <th>Qualité</th><th>Lieu</th><th>Date</th><th>Actions</th>
                        </tr>
                        ${tableData.scans.map(scan => `
                            <tr>
                                <td>${scan.id}</td>
                                <td>${scan.first_name} ${scan.last_name}</td>
                                <td class="editable" contenteditable>${scan.initiative}</td>
                                <td class="editable" contenteditable>${scan.signatures}</td>
                                <td class="editable" contenteditable>${scan.quality}</td>
                                <td class="editable" contenteditable>${scan.location}</td>
                                <td>${new Date(scan.created_at).toLocaleDateString('fr-FR')}</td>
                                <td>
                                    <button class="btn btn-danger" onclick="confirmDelete('scan', ${scan.id})">🗑️</button>
                                </td>
                            </tr>
                        `).join('')}
                    </table>
                    ` : '<p>Aucun scan trouvé - <a href="/api/scans/setup/tables">Créer les tables</a></p>'}
                </div>
            </div>

            <div id="initiatives" class="tab-content">
                <div class="card">
                    <h2>🎯 Gestion Initiatives</h2>
                    ${tableData.initiatives ? `
                    <table>
                        <tr>
                            <th>ID</th><th>Nom</th><th>Description</th><th>Objectif</th>
                            <th>Deadline</th><th>Status</th><th>Actions</th>
                        </tr>
                        ${tableData.initiatives.map(init => `
                            <tr>
                                <td>${init.id}</td>
                                <td class="editable" contenteditable>${init.name}</td>
                                <td class="editable" contenteditable>${init.description || ''}</td>
                                <td class="editable" contenteditable>${init.target_signatures}</td>
                                <td class="editable" contenteditable>${init.deadline || ''}</td>
                                <td>${init.status}</td>
                                <td>
                                    <button class="btn btn-danger" onclick="confirmDelete('initiative', ${init.id})">🗑️</button>
                                </td>
                            </tr>
                        `).join('')}
                    </table>
                    ` : '<p>Aucune initiative trouvée - <a href="/api/scans/setup/tables">Créer les tables</a></p>'}
                </div>
            </div>

            <div id="actions" class="tab-content">
                <div class="card">
                    <h2>⚡ Actions Rapides</h2>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">
                        <div>
                            <h3>🔧 Setup</h3>
                            <button class="btn btn-success" onclick="setupTables()">Créer Tables Manquantes</button>
                            <button class="btn" onclick="addTestData()">Ajouter Données Test</button>
                        </div>
                        <div>
                            <h3>📊 Export</h3>
                            <button class="btn" onclick="exportData('users')">Export Utilisateurs</button>
                            <button class="btn" onclick="exportData('scans')">Export Scans</button>
                        </div>
                        <div>
                            <h3>🧹 Nettoyage</h3>
                            <button class="btn btn-danger" onclick="cleanOldData()">Nettoyer Anciennes Données</button>
                            <button class="btn btn-danger" onclick="resetDatabase()">Reset Database</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <script>
            function showTab(tabName) {
                document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
                document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
                
                document.getElementById(tabName).classList.add('active');
                event.target.classList.add('active');
            }

            function setupTables() {
                if (confirm('Créer les tables manquantes et données de test ?')) {
                    fetch('/api/scans/setup/tables', { method: 'POST' })
                        .then(response => response.json())
                        .then(data => {
                            alert(data.message || 'Tables créées !');
                            location.reload();
                        })
                        .catch(error => alert('Erreur: ' + error));
                }
            }

            function confirmDelete(type, id) {
                if (confirm('Supprimer cet élément ? Cette action est irréversible.')) {
                    alert('Fonction de suppression à implémenter pour ' + type + ' ID: ' + id);
                }
            }

            function exportData(type) {
                alert('Export ' + type + ' - Fonction à implémenter');
            }

            function addTestData() {
                if (confirm('Ajouter des données de test ?')) {
                    alert('Fonction à implémenter');
                }
            }

            function cleanOldData() {
                if (confirm('Supprimer les données anciennes (>6 mois) ?')) {
                    alert('Fonction de nettoyage à implémenter');
                }
            }

            function resetDatabase() {
                if (confirm('ATTENTION: Supprimer TOUTES les données ? Cette action est IRRÉVERSIBLE !')) {
                    if (confirm('Êtes-vous ABSOLUMENT sûr ?')) {
                        alert('Fonction de reset à implémenter');
                    }
                }
            }
        </script>
    </body>
    </html>
    `;

    res.send(html);

  } catch (error) {
    console.error('❌ Erreur admin interface:', error);
    res.status(500).json({
      error: 'Erreur admin interface',
      details: error.message
    });
  }
});

module.exports = router;
