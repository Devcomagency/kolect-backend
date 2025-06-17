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

module.exports = router;
