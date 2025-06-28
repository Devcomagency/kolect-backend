const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const scansRoutes = require('./routes/scans');
const collaboratorsRoutes = require('./routes/collaborators');
const statsRoutes = require('./routes/stats');
const emailRoutes = require('./routes/email');
const initiativesRoutes = require('./routes/initiatives');

// ======= ROUTES ADMIN BACKOFFICE COMPLETES =======
const adminAuthRoutes = require('./routes/admin/auth');
const adminDashboardRoutes = require('./routes/admin/dashboard');
const adminUsersRoutes = require('./routes/admin/users');
const adminInitiativesRoutes = require('./routes/admin/initiatives');
const adminVerificationsRoutes = require('./routes/admin/verifications');
const adminActivityRoutes = require('./routes/admin/activity');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware de base
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Fichiers statiques
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Middleware de logging pour debug
app.use((req, res, next) => {
    if (req.path.startsWith('/api/admin')) {
        console.log(`🔧 Admin API: ${req.method} ${req.path}`, {
            timestamp: new Date().toISOString(),
            ip: req.ip,
            userAgent: req.get('User-Agent')?.substring(0, 50)
        });
    }
    next();
});

// ======= ROUTES API EXISTANTES (INCHANGÉES) =======
app.use('/api/auth', authRoutes);
app.use('/api/scans', scansRoutes);
app.use('/api/collaborators', collaboratorsRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/initiatives', initiativesRoutes);

// ======= NOUVELLES ROUTES ADMIN BACKOFFICE =======
app.use('/api/admin/auth', adminAuthRoutes);
app.use('/api/admin/dashboard', adminDashboardRoutes);
app.use('/api/admin/users', adminUsersRoutes);
app.use('/api/admin/initiatives', adminInitiativesRoutes);
app.use('/api/admin/verifications', adminVerificationsRoutes);
app.use('/api/admin/activity', adminActivityRoutes);

// ======= ROUTES MATCHING SYSTEM (PHASE 1) =======
console.log('🔄 Chargement routes matching...');
app.use('/api/matching', require('./routes/matching'));
console.log('✅ Routes matching chargées');

// Interface web admin (AMÉLIORÉE)
app.use('/admin', express.static('public/admin'));

// Route principale admin (login page)
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/admin/index.html'));
});

// Route pour l'interface admin (après login)
app.get('/admin/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/admin/dashboard.html'));
});

// Health check amélioré avec nouvelles routes
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        message: 'Kolect Backend v2.1 - Admin Backoffice + Matching System 🚀',
        timestamp: new Date().toISOString(),
        version: '2.1.0',
        features: [
            'App Mobile Kolect',
            'Admin Backoffice Complet',
            'Gestion Collaborateurs Avancée',
            'Upload Images Initiatives',
            'Vérifications Manuelles',
            'Activité Détaillée avec Filtres',
            'Graphiques & Analytics',
            'Matching System Phase 1'
        ],
        availableRoutes: {
            mobile: [
                'POST /api/auth/register',
                'POST /api/auth/login',
                'GET /api/collaborators/profile',
                'GET /api/initiatives/contexts/active',
                'GET /api/scans/initiatives',
                'POST /api/scans/submit',
                'POST /api/email/send-contract'
            ],
            admin: [
                'POST /api/admin/auth/login',
                'GET /api/admin/auth/verify',
                'GET /api/admin/dashboard/stats',
                'GET /api/admin/dashboard/recent-activity',
                'GET /api/admin/dashboard/charts/signatures-evolution',
                'GET /api/admin/users',
                'GET /api/admin/users/:id/details',
                'PATCH /api/admin/users/:id/suspend',
                'PATCH /api/admin/users/:id/unsuspend',
                'DELETE /api/admin/users/:id',
                'GET /api/admin/initiatives',
                'POST /api/admin/initiatives',
                'PATCH /api/admin/initiatives/:id',
                'POST /api/admin/initiatives/:id/images',
                'GET /api/admin/verifications/pending',
                'POST /api/admin/verifications/:scanId/verify',
                'GET /api/admin/verifications/stats',
                'GET /api/admin/activity/detailed',
                'GET /api/admin/activity/summary',
                'GET /api/admin/activity/charts'
            ],
            matching: [
                'GET /api/matching/test',
                'GET /api/matching/pending-matches',
                'POST /api/matching/manual-match',
                'POST /api/matching/upload-batch'
            ],
            interfaces: [
                'GET /admin (Interface admin)',
                'GET /admin/dashboard (Dashboard admin)',
                'GET / (API documentation)',
                'GET /api/health (Health check)'
            ]
        },
        database: {
            tables: [
                'collaborators (avec nouvelles colonnes)',
                'scans (table principale + colonnes matching)',
                'initiatives (avec images)',
                'admin_users (authentification)',
                'admin_logs (traçabilité)',
                'scan_verifications (vérifications manuelles)',
                'initiative_images (images de référence)',
                'signature_details (détails signatures)',
                'matching_logs (logs matching)',
                'doubtful_scans (vue scans douteux)',
                'collaborator_stats (vue stats collaborateurs)'
            ]
        }
    });
});

// Route de test pour vérifier les nouvelles fonctionnalités
app.get('/api/test/admin-features', async (req, res) => {
    try {
        const pool = require('./config/database');
        
        // Test connexion database
        const dbTest = await pool.query('SELECT NOW()');
        
        // Test existence des nouvelles tables
        const tablesCheck = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_name IN (
                'scan_verifications', 
                'initiative_images',
                'admin_users',
                'admin_logs',
                'signature_details',
                'matching_logs'
            )
        `);
        
        // Test vues
        const viewsCheck = await pool.query(`
            SELECT table_name 
            FROM information_schema.views 
            WHERE table_name IN ('doubtful_scans', 'collaborator_stats')
        `);
        
        res.json({
            status: 'OK',
            database_connected: true,
            database_time: dbTest.rows[0].now,
            tables_created: tablesCheck.rows.map(r => r.table_name),
            views_created: viewsCheck.rows.map(r => r.table_name),
            missing_tables: [
                'scan_verifications',
                'initiative_images',
                'admin_users',
                'admin_logs',
                'signature_details',
                'matching_logs'
            ].filter(table =>
                !tablesCheck.rows.some(r => r.table_name === table)
            ),
            missing_views: [
                'doubtful_scans',
                'collaborator_stats'
            ].filter(view =>
                !viewsCheck.rows.some(r => r.table_name === view)
            )
        });
        
    } catch (error) {
        res.status(500).json({
            status: 'ERROR',
            message: error.message,
            recommendation: 'Exécutez le script SQL de diagnostic fourni'
        });
    }
});

// Middleware de gestion d'erreurs
app.use((error, req, res, next) => {
    console.error('🚨 Erreur serveur:', error);
    
    if (error.type === 'entity.too.large') {
        return res.status(413).json({
            error: 'Fichier trop volumineux',
            maxSize: '50MB'
        });
    }
    
    res.status(500).json({
        error: 'Erreur serveur interne',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Une erreur est survenue'
    });
});

// Route 404 pour API
app.use('/api/*', (req, res) => {
    res.status(404).json({
        error: 'Route API non trouvée',
        requested: req.originalUrl,
        available: '/api/health pour voir toutes les routes'
    });
});

// Route par défaut pour SPA admin
app.get('*', (req, res) => {
    if (req.path.startsWith('/admin')) {
        res.sendFile(path.join(__dirname, 'public/admin/index.html'));
    } else {
        res.status(404).json({
            error: 'Page non trouvée',
            available: [
                '/admin (Interface admin)',
                '/api/health (API status)',
                '/api/* (API endpoints)'
            ]
        });
    }
});

// Démarrage serveur avec infos complètes
app.listen(PORT, () => {
    console.log('\n🚀 ===== KOLECT BACKEND V2.1 DÉMARRÉ =====');
    console.log(`📡 Port: ${PORT}`);
    console.log(`🌐 URL locale: http://localhost:${PORT}`);
    console.log(`🔧 Admin: http://localhost:${PORT}/admin`);
    console.log(`⚡ Health: http://localhost:${PORT}/api/health`);
    console.log(`📊 Test: http://localhost:${PORT}/api/test/admin-features`);
    console.log(`🔄 Matching: http://localhost:${PORT}/api/matching/test`);
    console.log('\n📋 NOUVELLES FONCTIONNALITÉS V2.1:');
    console.log('   ✅ Gestion collaborateurs complète (suspend/delete)');
    console.log('   ✅ Upload images initiatives pour GPT-4');
    console.log('   ✅ Vérifications manuelles scans douteux');
    console.log('   ✅ Activité détaillée avec filtres avancés');
    console.log('   ✅ Graphiques & analytics temps réel');
    console.log('   ✅ Database améliorée avec nouvelles tables');
    console.log('   🆕 MATCHING SYSTEM Phase 1 - Automatisation validation');
    console.log('   🆕 Upload batch jusqu\'à 1000 feuilles');
    console.log('   🆕 Matching automatique terrain/validation');
    console.log('\n🔐 COMPTES ADMIN EXISTANTS:');
    console.log('   📧 admin@kolect.ch / Devcom20!');
    console.log('   📧 test@kolect.ch / test123');
    console.log('\n⚙️ PROCHAINES ÉTAPES:');
    console.log('   1. Tester API matching: GET /api/matching/test');
    console.log('   2. Interface admin mise à jour');
    console.log('   3. Upload batch validation feuilles');
    console.log('==========================================\n');
});
