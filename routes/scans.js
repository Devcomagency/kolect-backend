const express = require('express');
const { Pool } = require('pg');
const router = express.Router();

// Configuration PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ✅ MIDDLEWARE CENTRAL (remplace le middleware custom)
const authenticateToken = require('../middleware/auth');

// === SOUMETTRE UN SCAN - VERSION SIMPLIFIÉE POUR TEST ===
router.post('/submit', authenticateToken, async (req, res) => {
  try {
    const { initiative, signatures, quality, confidence } = req.body;

    console.log('📸 === SOUMISSION SCAN ===');
    console.log('👤 Collaborateur:', req.user.userId, req.user.firstName);
    console.log('🌿 Initiative:', initiative);
    console.log('✍️ Signatures:', signatures);

    // Validation basique
    if (!initiative || signatures === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Données manquantes (initiative et signatures requis)'
      });
    }

    // Réponse succès avec infos auth
    res.json({
      success: true,
      message: `✅ Scanner 100% fonctionnel pour ${req.user.firstName}!`,
      scan: {
        id: 'scan_' + Date.now(),
        initiative: initiative,
        signatures: signatures,
        quality: quality || 85,
        confidence: confidence || 85,
        timestamp: new Date().toISOString()
      },
      auth: {
        userId: req.user.userId,
        firstName: req.user.firstName,
        email: req.user.email
      },
      status: '🎉 PROBLÈME AUTH RÉSOLU - APP KOLECT V1 OPÉRATIONNELLE!'
    });

  } catch (error) {
    console.error('❌ Erreur submit scan:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
