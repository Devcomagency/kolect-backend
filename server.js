const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const scansRoutes = require('./routes/scans');
const collaboratorsRoutes = require('./routes/collaborators');
const statsRoutes = require('./routes/stats');
const adminRoutes = require('./routes/admin');
const emailRoutes = require('./routes/email');
const initiativesRoutes = require('./routes/initiatives');

// ======= NOUVELLES ROUTES ADMIN BACKOFFICE =======
const adminAuthRoutes = require('./routes/admin/auth');
const adminDashboardRoutes = require('./routes/admin/dashboard');
const adminUsersRoutes = require('./routes/admin/users');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Fichiers statiques
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Routes API existantes (INCHANGÉES)
app.use('/api/auth', authRoutes);
app.use('/api/scans', scansRoutes);
app.use('/api/collaborators', collaboratorsRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/initiatives', initiativesRoutes);

// ======= NOUVELLES ROUTES ADMIN BACKOFFICE =======
app.use('/api/admin/auth', adminAuthRoutes);
app.use('/api/admin/dashboard', adminDashboardRoutes);
app.use('/api/admin/users', adminUsersRoutes);

// Interface web admin (NOUVEAU)
app.use('/admin', express.static('public/admin'));

// Health check (AMÉLIORÉ)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Kolect Backend opérationnel 🌿',
    timestamp: new Date().toISOString(),
    version: '1.1.0 - Admin Backoffice',
    availableRoutes: [
      'GET /api/health',
      'POST /api/auth/register',
      'POST /api/auth/login',
      'GET /api/collaborators/profile',
      'GET /api/initiatives/contexts/active',
      'GET /api/scans/initiatives',
      'POST /api/scans/submit',
      'POST /api/email/send-contract',
      // Nouvelles routes admin
      'POST /api/admin/auth/login',
      'GET /api/admin/dashboard/stats',
      'GET /api/admin/users',
      'GET /admin (Interface web admin)'
    ]
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Serveur Kolect démarré sur le port ${PORT}`);
  console.log(`🌐 Interface test: http://localhost:${PORT}/test.html`);
  console.log(`🖥️ Admin backoffice: http://localhost:${PORT}/admin`);
});
