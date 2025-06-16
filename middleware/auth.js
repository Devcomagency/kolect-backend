const jwt = require('jsonwebtoken');
const pool = require('../config/database');

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
    
    // ✅ CORRECTION : Utiliser uniquement les colonnes qui EXISTENT
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
    
    // ✅ CORRECTION : Mapper uniquement les champs qui EXISTENT
    req.user = {
      userId: user.id, // ⚠️ IMPORTANT : garder userId pour compatibilité
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      phone: user.phone,
      status: user.status,
      contractSigned: user.contract_signed,
      contractSignedAt: user.contract_signed_at, // ✅ Utiliser contract_signed_at au lieu de created_at
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

const requireAdmin = (req, res, next) => {
  if (req.user.email !== process.env.ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Accès administrateur requis' });
  }
  next();
};

const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // ✅ CORRECTION : Utiliser uniquement les colonnes qui EXISTENT
      const userResult = await pool.query(`
        SELECT 
          id,
          first_name,
          last_name,
          email,
          phone,
          status,
          contract_signed,
          contract_signed_at
        FROM collaborators 
        WHERE id = $1
      `, [decoded.userId]);
      
      if (userResult.rows.length > 0) {
        const user = userResult.rows[0];
        req.user = {
          userId: user.id,
          id: user.id,
          firstName: user.first_name,
          lastName: user.last_name,
          email: user.email,
          phone: user.phone,
          status: user.status,
          contractSigned: user.contract_signed
        };
        req.userId = decoded.userId;
      }
    }
    
    next();
  } catch (error) {
    // En cas d'erreur, on continue sans authentification
    next();
  }
};

module.exports = {
  authenticateToken,
  requireAdmin,
  optionalAuth
};

// Force deploy lun. 16 juin 2025 18:39:53 CEST
