const jwt = require('jsonwebtoken');
const pool = require('../config/database');

const verifyAdmin = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ message: 'Token admin requis' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (decoded.type !== 'admin') {
      return res.status(403).json({ message: 'Accès admin requis' });
    }

    const result = await pool.query(
      'SELECT id, name, email, role FROM admin_users WHERE id = $1',
      [decoded.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Admin non trouvé' });
    }

    req.admin = result.rows[0];
    next();

  } catch (error) {
    console.error('Erreur auth admin:', error);
    res.status(401).json({ message: 'Token invalide' });
  }
};

module.exports = { verifyAdmin };