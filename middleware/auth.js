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
    
    // Récupérer les infos du collaborateur
    const userQuery = 'SELECT * FROM collaborators WHERE id = $1 AND status = $2';
    const userResult = await pool.query(userQuery, [decoded.userId, 'active']);
    
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Utilisateur non autorisé' });
    }

    req.user = userResult.rows[0];
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Token invalide' });
  }
};

const requireAdmin = (req, res, next) => {
  // L'admin est défini par l'email dans .env
  if (req.user.email !== process.env.ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Accès administrateur requis' });
  }
  next();
};

module.exports = {
  authenticateToken,
  requireAdmin
};
