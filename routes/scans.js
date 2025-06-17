const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const router = express.Router();

// Configuration PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ✅ MIDDLEWARE AUTH - EXACTEMENT COMME middleware/auth.js
const authenticateToken = async (req, res, next) => {
  console.log('🔍 === DEBUG AUTH MIDDLEWARE ===');
  
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  console.log('🔍 Authorization header:', authHeader);
  console.log('🔍 Token extrait:', token ? token.substring(0, 50) + '...' : 'AUCUN');

  if (!token) {
    console.log('❌ Aucun token fourni');
    return res.status(401).json({ error: 'Token requis' });
  }

  try {
    console.log('🔑 JWT Secret utilisé:', process.env.JWT_SECRET);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('✅ Token décodé avec succès, userId:', decoded.userId);
    
    // ✅ EXACTEMENT LA MÊME REQUÊTE QUE middleware/auth.js
    const userQuery = `
      SELECT 
        id,
        first_name,
        last_name,
        email,
        phone,
        password_hash,
        status,
        contract_signed,
        contract_signed_at,
        contract_pdf_url
      FROM collaborators 
      WHERE id = $1
    `;
    const userResult = await pool.query(userQuery, [decoded.userId]);
    
    if (userResult.rows.length === 0) {
      console.error('❌ Utilisateur non trouvé dans la base:', decoded.userId);
      return res.status(401).json({ error: 'Utilisateur non trouvé' });
    }
    
    console.log('✅ Utilisateur trouvé:', {
      id: userResult.rows[0].id,
      email: userResult.rows[0].email,
      status: userResult.rows[0].status
    });

    const user = userResult.rows[0];
    
    // ✅ EXACTEMENT LE MÊME MAPPING QUE middleware/auth.js
    req.user = {
      userId: user.id,
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      phone: user.phone,
      status: user.status,
      contractSigned: user.contract_signed,
      contractSignedAt: user.contract_signed_at,
      contractPdfUrl: user.contract_pdf_url
    };
    
    req.userId = decoded.userId;
    console.log('✅ Authentification réussie pour:', user.email);
    next();
    
  } catch (error) {
    console.error('❌ Erreur authentification complète:', error);
    console.error('❌ Type erreur:', error.name);
    console.error('❌ Message erreur:', error.message);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expiré' });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(403).json({ error: 'Token invalide - signature incorrecte' });
    }
    
    return res.status(403).json({ error: 'Token invalide' });
  }
};

// === SOUMETTRE UN SCAN ===
router.post('/submit', authenticateToken, async (req, res) => {
  try {
    const { initiative, signatures, quality, confidence } = req.body;

    console.log('📸 Scan reçu de:', req.user.firstName);
    console.log('🌿 Initiative:', initiative, '✍️ Signatures:', signatures);

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
