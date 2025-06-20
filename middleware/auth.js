const jwt = require('jsonwebtoken');
const pool = require('../config/database');

const authenticateToken = async (req, res, next) => {
  // 🚨 LOGS DE DEBUG TEMPORAIRES
  console.log('🔍 === DEBUG COMPLET ENVIRONMENT ===');
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log('PORT:', process.env.PORT);
  console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);
  console.log('JWT_SECRET exists:', !!process.env.JWT_SECRET);
  console.log('JWT_SECRET value:', process.env.JWT_SECRET ? `"${process.env.JWT_SECRET}"` : 'UNDEFINED');
  console.log('JWT_SECRET type:', typeof process.env.JWT_SECRET);
  console.log('All JWT env vars:', Object.keys(process.env).filter(k => k.includes('JWT')));
  console.log('🔍 === FIN DEBUG ENVIRONMENT ===');

  console.log('🔍 === DEBUG AUTH MIDDLEWARE ===');
  
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  console.log('🔍 Authorization header:', authHeader ? 'PRÉSENT' : 'ABSENT');
  console.log('🔍 Token extrait:', token ? 'PRÉSENT (' + token.substring(0, 20) + '...)' : 'AUCUN');

  if (!token) {
    console.log('❌ Aucun token fourni');
    return res.status(401).json({
      success: false,
      error: 'Token requis'
    });
  }

  try {
    console.log('🔑 JWT Secret présent:', process.env.JWT_SECRET ? 'OUI' : 'NON');
    
    if (!process.env.JWT_SECRET) {
      console.log('❌ JWT_SECRET manquant dans les variables d\'environnement');
      return res.status(500).json({
        success: false,
        error: 'Configuration serveur incorrecte - JWT_SECRET manquant'
      });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('✅ Token décodé avec succès:', {
      userId: decoded.userId,
      id: decoded.id,
      email: decoded.email
    });
    
    // Extraire l'ID (support ancien/nouveau format)
    const userId = decoded.userId || decoded.id;
    console.log('👤 User ID final extrait:', userId);
    
    if (!userId) {
      console.log('❌ Pas d\'ID utilisateur dans le token');
      return res.status(403).json({
        success: false,
        error: 'Token invalide - pas d\'ID utilisateur'
      });
    }
    
    // ✅ REQUÊTE POUR VÉRIFIER L'UTILISATEUR
    const userQuery = `
      SELECT 
        id,
        first_name,
        last_name,
        email,
        phone,
        status,
        contract_signed
      FROM collaborators 
      WHERE id = $1 AND status = 'active'
    `;
    
    const userResult = await pool.query(userQuery, [userId]);
    
    if (userResult.rows.length === 0) {
      console.error('❌ Utilisateur non trouvé ou inactif:', userId);
      return res.status(403).json({
        success: false,
        error: 'Utilisateur non trouvé ou inactif'
      });
    }
    
    const user = userResult.rows[0];
    console.log('✅ Utilisateur trouvé:', {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      status: user.status
    });

    // ✅ CORRECTION CRITIQUE : req.user.id (pas userId !)
    req.user = {
      id: user.id,              // ← CORRECTION : id au lieu de userId !
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      phone: user.phone,
      status: user.status,
      contractSigned: user.contract_signed
    };
    
    // ✅ AUSSI POUR COMPATIBILITÉ
    req.userId = user.id;
    
    console.log('✅ req.user configuré:', {
      id: req.user.id,
      email: req.user.email,
      firstName: req.user.firstName
    });
    
    console.log('✅ Authentification réussie pour user ID:', req.user.id);
    console.log('🔍 === FIN DEBUG AUTH MIDDLEWARE ===');
    
    next();
    
  } catch (error) {
    console.error('❌ Erreur authentification:', error.message);
    console.error('❌ Type erreur:', error.name);
    
    if (error.name === 'TokenExpiredError') {
      console.log('❌ Token expiré');
      return res.status(401).json({
        success: false,
        error: 'Token expiré'
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      console.log('❌ Token signature invalide');
      return res.status(403).json({
        success: false,
        error: 'Token invalide - signature incorrecte'
      });
    }
    
    console.log('❌ Erreur token générique');
    return res.status(403).json({
      success: false,
      error: 'Token invalide'
    });
  }
};

// 🚀 MODIFICATION - ADMIN DEVCOM
const requireAdmin = (req, res, next) => {
  console.log('🔍 === VÉRIFICATION ADMIN ===');
  console.log('👤 User email:', req.user.email);
  
  // 🚀 ACCÈS ADMIN POUR DEVCOM
  if (req.user.email === 'info@devcom.ch') {
    console.log('✅ Devcom détecté - Accès admin accordé');
    req.user.role = 'admin';
    next();
    return;
  }
  
  // 🚀 AUSSI POUR BANANIA (backup)
  if (req.user.email === 'banania@gmail.com') {
    console.log('✅ Banania détecté - Accès admin accordé (backup)');
    req.user.role = 'admin';
    next();
    return;
  }
  
  // Vérification admin normale
  if (req.user.email !== process.env.ADMIN_EMAIL) {
    console.log('❌ Accès admin refusé pour:', req.user.email);
    return res.status(403).json({
      success: false,
      error: 'Accès administrateur requis'
    });
  }
  
  console.log('✅ Accès admin accordé');
  next();
};

const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userId = decoded.userId || decoded.id;
      
      if (userId) {
        const userResult = await pool.query(`
          SELECT 
            id,
            first_name,
            last_name,
            email,
            phone,
            status,
            contract_signed
          FROM collaborators 
          WHERE id = $1 AND status = 'active'
        `, [userId]);
        
        if (userResult.rows.length > 0) {
          const user = userResult.rows[0];
          req.user = {
            id: user.id,              // ← CORRECTION : id au lieu de userId !
            firstName: user.first_name,
            lastName: user.last_name,
            email: user.email,
            phone: user.phone,
            status: user.status,
            contractSigned: user.contract_signed
          };
          req.userId = user.id;
        }
      }
    }
    
    next();
  } catch (error) {
    // En cas d'erreur, on continue sans authentification
    console.log('⚠️ Erreur auth optionnelle:', error.message);
    next();
  }
};

module.exports = {
  authenticateToken,
  requireAdmin,
  optionalAuth
};
