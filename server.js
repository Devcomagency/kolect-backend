const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// === IMPORTS DES ROUTES ===
const authRoutes = require('./routes/auth');
const emailRoutes = require('./routes/email');
const scansRoutes = require('./routes/scans');
const collaboratorsRoutes = require('./routes/collaborators');
const statsRoutes = require('./routes/stats');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// === MIDDLEWARE ===
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// === FICHIERS STATIQUES ===
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// === ROUTES API ===
app.use('/api/auth', authRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/scans', scansRoutes);
app.use('/api/collaborators', collaboratorsRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/admin', adminRoutes);

// === HEALTH CHECK ===
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Kolect Backend opérationnel 🌿',
    timestamp: new Date().toISOString(),
    gpt4_enabled: true,
    availableRoutes: [
      'GET /api/health',
      'POST /api/auth/register',
      'POST /api/auth/login',
      'GET /api/collaborators/profile',
      'GET /api/scans/initiatives',
      'POST /api/scans/submit',
      'POST /api/analyze-signatures',
      'POST /api/upload-scan',
      'GET /api/email/test',
      'POST /api/email/send-contract'
    ]
  });
});

// === DÉMARRAGE SERVEUR ===
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Serveur Kolect démarré sur le port ${PORT}`);
  console.log(`🌐 Interface test: http://localhost:${PORT}/test.html`);
  console.log('📧 Routes email disponibles:');
  console.log('   GET  /api/email/test');
  console.log('   POST /api/email/send-contract');
});

module.exports = app;
