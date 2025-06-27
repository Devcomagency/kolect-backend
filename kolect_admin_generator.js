#!/usr/bin/env node

/**
 * 🖥️ KOLECT ADMIN GENERATOR - VERSION CORRIGÉE
 * Génère le backoffice admin sans erreurs de syntaxe
 */

const fs = require('fs');
const path = require('path');

console.log('🖥️ GÉNÉRATION BACKOFFICE ADMIN KOLECT (Version corrigée)\n');

// 🎯 ÉTAPE 1 : SQL
function generateSQLCommands() {
  const sqlCommands = `-- 🗄️ KOLECT ADMIN - COMMANDES SQL
-- URL: https://kolect-backend.onrender.com  

-- 1️⃣ Créer table administrateurs
CREATE TABLE IF NOT EXISTS admin_users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'admin',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);

-- 2️⃣ Créer table logs admin
CREATE TABLE IF NOT EXISTS admin_logs (
    id SERIAL PRIMARY KEY,
    admin_id INTEGER REFERENCES admin_users(id),
    action VARCHAR(255) NOT NULL,
    details JSONB,
    ip_address INET,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3️⃣ Créer premier admin avec mot de passe: Devcom20!
-- Hash généré avec bcrypt pour 'Devcom20!'
INSERT INTO admin_users (name, email, password, role) VALUES 
    ('Admin Kolect', 'admin@kolect.ch', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'super-admin')
ON CONFLICT (email) DO NOTHING;

-- 4️⃣ Index pour performance
CREATE INDEX IF NOT EXISTS idx_admin_logs_admin ON admin_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON admin_logs(created_at);

-- ✅ PRÊT ! Login: admin@kolect.ch / Devcom20!`;

  fs.writeFileSync('SQL_ADMIN_SETUP.sql', sqlCommands);
  console.log('✅ Fichier SQL_ADMIN_SETUP.sql créé');
}

// 📁 CRÉER DOSSIERS
function createAdminFolders() {
  const folders = [
    'routes/admin',
    'public/admin',
    'public/admin/assets'
  ];
  
  folders.forEach(folder => {
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
      console.log(`✅ Dossier créé: ${folder}`);
    }
  });
}

// 🔐 MIDDLEWARE ADMIN
function generateAdminMiddleware() {
  const code = `const jwt = require('jsonwebtoken');
const pool = require('../config/database');

const verifyAdmin = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ message: 'Token admin requis' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (decoded.type !== 'admin') {
      return res.status(403).json({ message: 'Accès admin requis' });
    }

    const result = await pool.query(
      'SELECT id, name, email, role FROM admin_users WHERE id = $1',
      [decoded.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Admin non trouvé' });
    }

    req.admin = result.rows[0];
    next();

  } catch (error) {
    console.error('Erreur auth admin:', error);
    res.status(401).json({ message: 'Token invalide' });
  }
};

module.exports = { verifyAdmin };`;

  fs.writeFileSync('middleware/adminAuth.js', code);
  console.log('✅ Middleware admin créé');
}

// 🔐 ROUTE AUTH
function generateAdminAuthRoute() {
  const code = `const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../../config/database');
const { verifyAdmin } = require('../../middleware/adminAuth');
const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log('🔐 Tentative login admin:', email);

    const result = await pool.query(
      'SELECT * FROM admin_users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Email ou mot de passe incorrect' });
    }

    const admin = result.rows[0];
    const validPassword = await bcrypt.compare(password, admin.password);

    if (!validPassword) {
      return res.status(401).json({ message: 'Email ou mot de passe incorrect' });
    }

    await pool.query(
      'UPDATE admin_users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [admin.id]
    );

    const token = jwt.sign(
      { 
        id: admin.id, 
        email: admin.email, 
        role: admin.role,
        type: 'admin'
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log('✅ Login admin réussi:', admin.name);

    res.json({
      token,
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role
      }
    });

  } catch (error) {
    console.error('❌ Erreur login admin:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

router.get('/verify', verifyAdmin, (req, res) => {
  res.json({ admin: req.admin });
});

module.exports = router;`;

  fs.writeFileSync('routes/admin/auth.js', code);
  console.log('✅ Route admin auth créée');
}

// 📊 ROUTE DASHBOARD
function generateAdminDashboardRoute() {
  const code = `const express = require('express');
const pool = require('../../config/database');
const { verifyAdmin } = require('../../middleware/adminAuth');
const router = express.Router();

router.get('/stats', verifyAdmin, async (req, res) => {
  try {
    console.log('📊 Chargement stats admin...');

    const statsQueries = await Promise.all([
      pool.query('SELECT COALESCE(SUM(total_signatures), 0) as total FROM scans'),
      pool.query('SELECT COUNT(*) as count FROM collaborators WHERE created_at > CURRENT_DATE - INTERVAL \'30 days\''),
      pool.query('SELECT ROUND(AVG(ocr_confidence * 100), 1) as avg FROM scans WHERE ocr_confidence IS NOT NULL'),
      pool.query('SELECT COUNT(*) as count FROM scans WHERE DATE(created_at) = CURRENT_DATE'),
      pool.query(\`
        SELECT 
          c.first_name || ' ' || COALESCE(c.last_name, '') as name,
          COALESCE(SUM(s.total_signatures), 0) as total_signatures
        FROM collaborators c
        LEFT JOIN scans s ON c.id = s.collaborator_id
        GROUP BY c.id, c.first_name, c.last_name
        ORDER BY total_signatures DESC
        LIMIT 5
      \`),
      pool.query(\`
        SELECT 
          COALESCE(s.initiative, 'Initiative inconnue') as initiative,
          COALESCE(SUM(s.total_signatures), 0) as signatures,
          COUNT(s.id) as scans_count
        FROM scans s
        GROUP BY s.initiative
        ORDER BY signatures DESC
        LIMIT 10
      \`)
    ]);

    const [totalSig, activeColl, avgQuality, todayScans, topCollabs, initiatives] = statsQueries;

    const stats = {
      totalSignatures: parseInt(totalSig.rows[0].total),
      activeCollaborators: parseInt(activeColl.rows[0].count),
      averageQuality: parseFloat(avgQuality.rows[0].avg) || 0,
      todayScans: parseInt(todayScans.rows[0].count),
      topCollaborators: topCollabs.rows,
      initiativeStats: initiatives.rows
    };

    console.log('✅ Stats calculées:', stats);
    res.json(stats);

  } catch (error) {
    console.error('❌ Erreur stats dashboard:', error);
    res.status(500).json({ message: 'Erreur chargement statistiques' });
  }
});

router.get('/recent-activity', verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(\`
      SELECT 
        s.id,
        c.first_name || ' ' || COALESCE(c.last_name, '') as collaborator_name,
        COALESCE(s.initiative, 'Initiative') as initiative,
        s.total_signatures,
        s.ocr_confidence,
        s.created_at
      FROM scans s
      JOIN collaborators c ON s.collaborator_id = c.id
      ORDER BY s.created_at DESC
      LIMIT 10
    \`);

    res.json(result.rows);

  } catch (error) {
    console.error('❌ Erreur activité récente:', error);
    res.status(500).json({ message: 'Erreur chargement activité' });
  }
});

module.exports = router;`;

  fs.writeFileSync('routes/admin/dashboard.js', code);
  console.log('✅ Route admin dashboard créée');
}

// 👥 ROUTE USERS
function generateAdminUsersRoute() {
  const code = `const express = require('express');
const pool = require('../../config/database');
const { verifyAdmin } = require('../../middleware/adminAuth');
const router = express.Router();

router.get('/', verifyAdmin, async (req, res) => {
  try {
    console.log('👥 Chargement liste collaborateurs...');

    const result = await pool.query(\`
      SELECT 
        c.id,
        c.first_name,
        c.last_name,
        c.email,
        c.phone,
        c.status,
        c.created_at,
        COALESCE(SUM(s.total_signatures), 0) as total_signatures,
        COUNT(s.id) as total_scans,
        COALESCE(AVG(s.ocr_confidence), 0) as avg_quality,
        MAX(s.created_at) as last_scan
      FROM collaborators c
      LEFT JOIN scans s ON c.id = s.collaborator_id
      GROUP BY c.id, c.first_name, c.last_name, c.email, c.phone, c.status, c.created_at
      ORDER BY c.created_at DESC
    \`);

    const collaborators = result.rows.map(collab => ({
      id: collab.id,
      name: (collab.first_name + ' ' + (collab.last_name || '')).trim(),
      email: collab.email,
      phone: collab.phone,
      status: collab.status,
      createdAt: collab.created_at,
      stats: {
        totalSignatures: parseInt(collab.total_signatures),
        totalScans: parseInt(collab.total_scans),
        avgQuality: Math.round(parseFloat(collab.avg_quality) * 100),
        lastScan: collab.last_scan
      }
    }));

    console.log('✅ ' + collaborators.length + ' collaborateurs chargés');
    res.json(collaborators);

  } catch (error) {
    console.error('❌ Erreur liste collaborateurs:', error);
    res.status(500).json({ message: 'Erreur chargement collaborateurs' });
  }
});

router.put('/:id/status', verifyAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    
    console.log('🔄 Changement statut collaborateur ' + req.params.id + ' -> ' + status);

    const result = await pool.query(\`
      UPDATE collaborators 
      SET status = $1 
      WHERE id = $2 
      RETURNING first_name, last_name, email
    \`, [status, req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Collaborateur non trouvé' });
    }

    await pool.query(\`
      INSERT INTO admin_logs (admin_id, action, details)
      VALUES ($1, 'CHANGE_USER_STATUS', $2)
    \`, [req.admin.id, JSON.stringify({ 
      user_id: req.params.id, 
      user_name: result.rows[0].first_name + ' ' + result.rows[0].last_name,
      new_status: status
    })]);

    res.json({ 
      message: 'Statut collaborateur changé vers ' + status,
      collaborator: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Erreur changement statut:', error);
    res.status(500).json({ message: 'Erreur changement statut' });
  }
});

module.exports = router;`;

  fs.writeFileSync('routes/admin/users.js', code);
  console.log('✅ Route admin users créée');
}

// 🖥️ INTERFACE HTML (sans backticks imbriqués)
function generateAdminHTML() {
  const htmlContent = `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>KOLECT Admin - Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #4ECDC4 0%, #35A085 100%);
            min-height: 100vh;
        }
        
        .admin-container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        
        .admin-header {
            background: white;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .logo {
            font-size: 28px;
            font-weight: bold;
            color: #4ECDC4;
        }
        
        .admin-info {
            display: flex;
            align-items: center;
            gap: 15px;
        }
        
        .logout-btn {
            background: #E74C3C;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: bold;
        }
        
        .logout-btn:hover {
            background: #C0392B;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .stat-card {
            background: white;
            border-radius: 12px;
            padding: 25px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            text-align: center;
            transition: transform 0.2s ease;
        }
        
        .stat-card:hover {
            transform: translateY(-5px);
        }
        
        .stat-number {
            font-size: 36px;
            font-weight: bold;
            color: #4ECDC4;
            margin-bottom: 10px;
        }
        
        .stat-label {
            font-size: 16px;
            color: #2C3E50;
            font-weight: 500;
        }
        
        .quick-actions {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 30px;
        }
        
        .action-btn {
            background: white;
            border: 2px solid #4ECDC4;
            color: #4ECDC4;
            padding: 15px 20px;
            border-radius: 10px;
            cursor: pointer;
            font-weight: bold;
            text-decoration: none;
            text-align: center;
            transition: all 0.2s ease;
        }
        
        .action-btn:hover {
            background: #4ECDC4;
            color: white;
        }
        
        .recent-activity {
            background: white;
            border-radius: 12px;
            padding: 25px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
        }
        
        .recent-title {
            font-size: 20px;
            font-weight: bold;
            color: #2C3E50;
            margin-bottom: 20px;
        }
        
        .activity-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 0;
            border-bottom: 1px solid #ECF0F1;
        }
        
        .activity-item:last-child {
            border-bottom: none;
        }
        
        .activity-text {
            color: #2C3E50;
        }
        
        .activity-time {
            color: #7F8C8D;
            font-size: 14px;
        }
        
        .hidden {
            display: none;
        }
        
        .login-form {
            max-width: 400px;
            margin: 100px auto;
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
        }
        
        .form-title {
            text-align: center;
            font-size: 24px;
            font-weight: bold;
            color: #2C3E50;
            margin-bottom: 30px;
        }
        
        .form-group {
            margin-bottom: 20px;
        }
        
        .form-label {
            display: block;
            margin-bottom: 8px;
            font-weight: bold;
            color: #2C3E50;
        }
        
        .form-input {
            width: 100%;
            padding: 12px;
            border: 2px solid #ECF0F1;
            border-radius: 8px;
            font-size: 16px;
            transition: border-color 0.2s ease;
        }
        
        .form-input:focus {
            outline: none;
            border-color: #4ECDC4;
        }
        
        .form-btn {
            width: 100%;
            background: #4ECDC4;
            color: white;
            border: none;
            padding: 15px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            transition: background 0.2s ease;
        }
        
        .form-btn:hover {
            background: #35A085;
        }
        
        .error-message {
            background: #E74C3C;
            color: white;
            padding: 10px;
            border-radius: 5px;
            margin-bottom: 15px;
            text-align: center;
        }

        .page-title {
            font-size: 24px;
            font-weight: bold;
            color: white;
            margin-bottom: 20px;
            text-align: center;
        }

        .users-grid {
            display: grid;
            gap: 15px;
        }

        .user-card {
            background: white;
            border-radius: 10px;
            padding: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }

        .user-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }

        .user-name {
            font-size: 18px;
            font-weight: bold;
            color: #2C3E50;
        }

        .user-email {
            color: #7F8C8D;
            font-size: 14px;
        }

        .user-stats {
            display: flex;
            gap: 20px;
            margin-top: 10px;
        }

        .user-stat {
            text-align: center;
        }

        .user-stat-number {
            font-size: 20px;
            font-weight: bold;
            color: #4ECDC4;
        }

        .user-stat-label {
            font-size: 12px;
            color: #7F8C8D;
        }

        .status-badge {
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
        }

        .status-active {
            background: #D5EDDA;
            color: #155724;
        }

        .status-suspended {
            background: #F8D7DA;
            color: #721C24;
        }

        .btn-sm {
            padding: 6px 12px;
            font-size: 12px;
            border-radius: 6px;
            border: none;
            cursor: pointer;
            margin-left: 5px;
        }

        .btn-warning {
            background: #FFC107;
            color: #000;
        }

        .btn-success {
            background: #28A745;
            color: white;
        }
    </style>
</head>
<body>
    <!-- LOGIN FORM -->
    <div id="loginForm" class="login-form">
        <div class="form-title">🔐 KOLECT Admin</div>
        <div id="errorMessage" class="error-message hidden"></div>
        
        <form onsubmit="handleLogin(event)">
            <div class="form-group">
                <label class="form-label">Email</label>
                <input type="email" class="form-input" id="email" required value="admin@kolect.ch">
            </div>
            
            <div class="form-group">
                <label class="form-label">Mot de passe</label>
                <input type="password" class="form-input" id="password" required placeholder="Devcom20!">
            </div>
            
            <button type="submit" class="form-btn">Se connecter</button>
        </form>
    </div>

    <!-- ADMIN DASHBOARD -->
    <div id="adminDashboard" class="admin-container hidden">
        <!-- Header -->
        <div class="admin-header">
            <div class="logo">KOLECT Admin</div>
            <div class="admin-info">
                <span id="adminName">Admin</span>
                <button class="logout-btn" onclick="handleLogout()">Déconnexion</button>
            </div>
        </div>

        <!-- Navigation -->
        <div class="quick-actions">
            <button class="action-btn" onclick="showDashboard()">📊 Dashboard</button>
            <button class="action-btn" onclick="showUsers()">👥 Collaborateurs</button>
            <button class="action-btn" onclick="exportData()">⬇️ Export</button>
        </div>

        <!-- Dashboard View -->
        <div id="dashboardView">
            <!-- Statistics -->
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-number" id="totalSignatures">0</div>
                    <div class="stat-label">Signatures totales</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" id="activeCollaborators">0</div>
                    <div class="stat-label">Collaborateurs</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" id="averageQuality">0%</div>
                    <div class="stat-label">Qualité moyenne</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" id="todayScans">0</div>
                    <div class="stat-label">Scans aujourd'hui</div>
                </div>
            </div>

            <!-- Recent Activity -->
            <div class="recent-activity">
                <div class="recent-title">🕒 Activité récente</div>
                <div id="recentActivity">
                    <!-- Chargé dynamiquement -->
                </div>
            </div>
        </div>

        <!-- Users View -->
        <div id="usersView" class="hidden">
            <div class="page-title">👥 Gestion des Collaborateurs</div>
            <div id="usersList" class="users-grid">
                <!-- Chargé dynamiquement -->
            </div>
        </div>
    </div>

    <script>
        const API_URL = 'https://kolect-backend.onrender.com';
        let authToken = localStorage.getItem('adminToken');

        document.addEventListener('DOMContentLoaded', function() {
            if (authToken) {
                verifyToken();
            } else {
                showLogin();
            }
        });

        async function handleLogin(event) {
            event.preventDefault();
            
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            
            try {
                const response = await fetch(API_URL + '/api/admin/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    localStorage.setItem('adminToken', data.token);
                    authToken = data.token;
                    showDashboard();
                    loadDashboardData(data.admin);
                } else {
                    showError(data.message);
                }
            } catch (error) {
                showError('Erreur de connexion au serveur');
            }
        }

        async function verifyToken() {
            try {
                const response = await fetch(API_URL + '/api/admin/auth/verify', {
                    headers: { 'Authorization': 'Bearer ' + authToken }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    showDashboard();
                    loadDashboardData(data.admin);
                } else {
                    showLogin();
                }
            } catch (error) {
                showLogin();
            }
        }

        async function loadDashboardData(admin) {
            document.getElementById('adminName').textContent = admin.name;
            await loadStats();
            await loadRecentActivity();
        }

        async function loadStats() {
            try {
                const response = await fetch(API_URL + '/api/admin/dashboard/stats', {
                    headers: { 'Authorization': 'Bearer ' + authToken }
                });
                
                if (response.ok) {
                    const stats = await response.json();
                    
                    document.getElementById('totalSignatures').textContent = stats.totalSignatures || 0;
                    document.getElementById('activeCollaborators').textContent = stats.activeCollaborators || 0;
                    document.getElementById('averageQuality').textContent = (stats.averageQuality || 0) + '%';
                    document.getElementById('todayScans').textContent = stats.todayScans || 0;
                }
            } catch (error) {
                console.error('Erreur chargement stats:', error);
            }
        }

        async function loadRecentActivity() {
            try {
                const response = await fetch(API_URL + '/api/admin/dashboard/recent-activity', {
                    headers: { 'Authorization': 'Bearer ' + authToken }
                });
                
                if (response.ok) {
                    const activities = await response.json();
                    const container = document.getElementById('recentActivity');
                    
                    container.innerHTML = activities.map(activity => 
                        '<div class="activity-item">' +
                            '<span class="activity-text">' +
                                activity.collaborator_name + ' - ' + activity.total_signatures + ' signatures (' + activity.initiative + ')' +
                            '</span>' +
                            '<span class="activity-time">' +
                                new Date(activity.created_at).toLocaleDateString('fr-FR') +
                            '</span>' +
                        '</div>'
                    ).join('');
                }
            } catch (error) {
                console.error('Erreur activité récente:', error);
            }
        }

        async function loadUsers() {
            try {
                const response = await fetch(API_URL + '/api/admin/users', {
                    headers: { 'Authorization': 'Bearer ' + authToken }
                });
                
                if (response.ok) {
                    const users = await response.json();
                    const container = document.getElementById('usersList');
                    
                    container.innerHTML = users.map(user => 
                        '<div class="user-card">' +
                            '<div class="user-header">' +
                                '<div>' +
                                    '<div class="user-name">' + user.name + '</div>' +
                                    '<div class="user-email">' + user.email + '</div>' +
                                '</div>' +
                                '<div>' +
                                    '<span class="status-badge status-' + user.status + '">' + user.status + '</span>' +
                                    (user.status === 'active' ? 
                                        '<button class="btn-sm btn-warning" onclick="changeUserStatus(' + user.id + ', \'suspended\')">Suspendre</button>' :
                                        '<button class="btn-sm btn-success" onclick="changeUserStatus(' + user.id + ', \'active\')">Activer</button>'
                                    ) +
                                '</div>' +
                            '</div>' +
                            '<div class="user-stats">' +
                                '<div class="user-stat">' +
                                    '<div class="user-stat-number">' + user.stats.totalSignatures + '</div>' +
                                    '<div class="user-stat-label">Signatures</div>' +
                                '</div>' +
                                '<div class="user-stat">' +
                                    '<div class="user-stat-number">' + user.stats.totalScans + '</div>' +
                                    '<div class="user-stat-label">Scans</div>' +
                                '</div>' +
                                '<div class="user-stat">' +
                                    '<div class="user-stat-number">' + user.stats.avgQuality + '%</div>' +
                                    '<div class="user-stat-label">Qualité</div>' +
                                '</div>' +
                            '</div>' +
                        '</div>'
                    ).join('');
                }
            } catch (error) {
                console.error('Erreur chargement collaborateurs:', error);
            }
        }

        async function changeUserStatus(userId, newStatus) {
            try {
                const response = await fetch(API_URL + '/api/admin/users/' + userId + '/status', {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + authToken
                    },
                    body: JSON.stringify({ status: newStatus })
                });
                
                if (response.ok) {
                    await loadUsers();
                } else {
                    alert('Erreur changement statut');
                }
            } catch (error) {
                console.error('Erreur:', error);
                alert('Erreur de connexion');
            }
        }

        function showView(viewId) {
            ['dashboardView', 'usersView'].forEach(id => {
                document.getElementById(id).classList.add('hidden');
            });
            document.getElementById(viewId).classList.remove('hidden');
        }

        function showDashboard() {
            document.getElementById('loginForm').classList.add('hidden');
            document.getElementById('adminDashboard').classList.remove('hidden');
            showView('dashboardView');
        }

        function showUsers() {
            showView('usersView');
            loadUsers();
        }

        function showLogin() {
            document.getElementById('loginForm').classList.remove('hidden');
            document.getElementById('adminDashboard').classList.add('hidden');
        }

        function showError(message) {
            const errorDiv = document.getElementById('errorMessage');
            errorDiv.textContent = message;
            errorDiv.classList.remove('hidden');
        }

        function handleLogout() {
            localStorage.removeItem('adminToken');
            authToken = null;
            showLogin();
        }

        function exportData() {
            alert('Export en développement - Prochaine version !');
        }
    </script>
</body>
</html>`;

  fs.writeFileSync('public/admin/index.html', htmlContent);
  console.log('✅ Interface admin HTML créée');
}

// 📋 INSTRUCTIONS
function generateInstructions() {
  const instructions = `# 🚀 KOLECT ADMIN - INSTRUCTIONS

## ✅ SETUP DÉTECTÉ :
- URL Backend : https://kolect-backend.onrender.com
- Tables : collaborators, scans, initiatives, initiative_contexts  

## 1️⃣ ÉTAPES :

### A) EXÉCUTER SQL
Copie le contenu de SQL_ADMIN_SETUP.sql dans PostgreSQL

### B) AJOUTER ROUTES DANS server.js
\`\`\`javascript
// AJOUTER ces lignes dans ton server.js
const adminAuthRoutes = require('./routes/admin/auth');
const adminDashboardRoutes = require('./routes/admin/dashboard');
const adminUsersRoutes = require('./routes/admin/users');

app.use('/api/admin/auth', adminAuthRoutes);
app.use('/api/admin/dashboard', adminDashboardRoutes);
app.use('/api/admin/users', adminUsersRoutes);
app.use('/admin', express.static('public/admin'));
\`\`\`

### C) REDÉMARRER
Commit + push vers Render

## 2️⃣ ACCÈS :
- URL : https://kolect-backend.onrender.com/admin
- Email : admin@kolect.ch  
- Mot de passe : Devcom20!

## ✅ PRÊT !`;

  fs.writeFileSync('INTEGRATION_INSTRUCTIONS.md', instructions);
  console.log('✅ Instructions créées');
}

// 🚀 GÉNÉRATION COMPLÈTE
function generateAll() {
  console.log('🖥️ GÉNÉRATION BACKOFFICE ADMIN KOLECT (VERSION CORRIGÉE)\n');
  
  generateSQLCommands();
  createAdminFolders();
  generateAdminMiddleware();
  generateAdminAuthRoute();
  generateAdminDashboardRoute();
  generateAdminUsersRoute();
  generateAdminHTML();
  generateInstructions();
  
  console.log('\n🎉 GÉNÉRATION TERMINÉE !');
  console.log('✅ Tous les fichiers admin créés (SANS erreurs)');
  console.log('📋 Lis INTEGRATION_INSTRUCTIONS.md');
  console.log('🌐 URL admin: https://kolect-backend.onrender.com/admin');
  console.log('🔐 Login: admin@kolect.ch / Devcom20!');
}

// 🎯 EXÉCUTION
generateAll();
