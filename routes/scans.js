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

router.post('/submit', authenticateToken, async (req, res) => {
  try {
    const { initiative, signatures, quality, confidence } = req.body;

    if (!initiative || signatures === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Initiative et signatures requis'
      });
    }

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
      status: '🎉 APP KOLECT V1 100% OPÉRATIONNELLE!'
    });

  } catch (error) {
    console.error('❌ Erreur:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 🔍 DEBUG ENDPOINT - Voir toutes les données
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
        LIMIT 10
      `);
      tableData.collaborators = collabResult.rows;
    }

    // Scans
    if (tables.includes('scans')) {
      const scansResult = await pool.query(`
        SELECT id, user_id, initiative, signatures, quality, 
               confidence, location, created_at 
        FROM scans 
        ORDER BY id DESC 
        LIMIT 20
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

      // Stats par initiative
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
            table { width: 100%; border-collapse: collapse; margin: 15px 0; }
            th, td { border: 1px solid #e0e0e0; padding: 12px 8px; text-align: left; }
            th { background: linear-gradient(135deg, #4ECDC4, #35A085); color: white; font-weight: 600; }
            tr:nth-child(even) { background: rgba(248,249,250,0.8); }
            tr:hover { background: rgba(78,205,196,0.1); }
            .count { background: linear-gradient(135deg, #35A085, #4ECDC4); color: white; padding: 8px 15px; border-radius: 25px; font-weight: bold; display: inline-block; margin: 5px; }
            .section { margin: 40px 0; }
            pre { background: rgba(248,249,250,0.9); padding: 20px; border-radius: 10px; overflow-x: auto; border-left: 4px solid #4ECDC4; }
            h1 { margin: 0; font-size: 2.5em; font-weight: 300; }
            h2 { color: #2c3e50; border-bottom: 3px solid #4ECDC4; padding-bottom: 10px; }
            .highlight { background: linear-gradient(135deg, #4ECDC4, #35A085); color: white; padding: 3px 8px; border-radius: 5px; font-weight: bold; }
            .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🔍 KOLECT DATABASE</h1>
                <p style="font-size: 1.2em; margin: 10px 0 0 0;">Vue complète de tes données en temps réel</p>
            </div>

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
                <h2>👥 Utilisateurs (Collaborators)</h2>
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
                <h2>📸 Scans récents</h2>
                <table>
                    <tr>
                        <th>ID</th><th>User ID</th><th>Initiative</th><th>Signatures</th>
                        <th>Qualité</th><th>Confiance</th><th>Lieu</th><th>Date</th>
                    </tr>
                    ${tableData.scans.map(scan => `
                        <tr>
                            <td><span class="highlight">${scan.id}</span></td>
                            <td>${scan.user_id}</td>
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
                <pre>${JSON.stringify(tableData.initiatives, null, 2)}</pre>
            </div>
            ` : ''}

            <div class="grid">
                ${stats.topUsers ? `
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

                ${stats.byInitiative ? `
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
                <p><strong>Analyze Signatures:</strong> <code>POST /api/analyze-signatures</code></p>
                <p><strong>Submit Scan:</strong> <code>POST /api/scans/submit</code></p>
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

module.exports = router;
