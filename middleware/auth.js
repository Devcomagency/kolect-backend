const jwt = require('jsonwebtoken');
const pool = require('../config/database');

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token requis' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const userQuery = `
      SELECT id, first_name, last_name, email, phone, status, 
             contract_signed, created_at, updated_at
      FROM collaborators 
      WHERE id = $1
    `;
    const userResult = await pool.query(userQuery, [decoded.userId]);
    
    if (userResult.rows.length === 0) {
      console.error('❌ Utilisateur non trouvé:', decoded.userId);
      return res.status(401).json({ error: 'Utilisateur non trouvé' });
    }
    
    console.log('✅ Utilisateur trouvé:', {
      id: userResult.rows[0].id,
      email: userResult.rows[0].email,
      status: userResult.rows[0].status
    });

    const user = userResult.rows[0];
    req.user = {
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      phone: user.phone,
      status: user.status,
      contractSigned: user.contract_signed,
      createdAt: user.created_at,
      updatedAt: user.updated_at
    };
    
    req.userId = decoded.userId;
    next();
  } catch (error) {
    console.error('❌ Erreur authentification:', error.message);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expiré' });
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
      const userResult = await pool.query(
        'SELECT * FROM collaborators WHERE id = $1',
        [decoded.userId]
      );
      
      if (userResult.rows.length > 0) {
        const user = userResult.rows[0];
        req.user = {
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
    next();
  }
};

module.exports = {
  authenticateToken,
  requireAdmin,
  optionalAuth
};
// Force deploy lun. 16 juin 2025 18:39:53 CEST
