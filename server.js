const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const scansRoutes = require('./routes/scans');
const collaboratorsRoutes = require('./routes/collaborators');
const statsRoutes = require('./routes/stats');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Fichiers statiques
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/scans', scansRoutes);
app.use('/api/collaborators', collaboratorsRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Kolect Backend opérationnel 🌿',
    timestamp: new Date().toISOString(),
    availableRoutes: [
      'GET /api/health',
      'POST /api/auth/register',
      'POST /api/auth/login',
      'GET /api/collaborators/profile',
      'GET /api/scans/initiatives',
      'POST /api/scans/submit'
    ]
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Serveur Kolect démarré sur le port ${PORT}`);
  console.log(`🌐 Interface test: http://localhost:${PORT}/test.html`);
});
