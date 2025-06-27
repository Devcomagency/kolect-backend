const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../../config/database');
const { verifyAdmin } = require('../../middleware/adminAuth');
const router = express.Router();

// Route de diagnostic pour vérifier la configuration
router.get('/check', async (req, res) => {
  try {
    console.log('🔍 DIAGNOSTIC ADMIN CONFIG:');
    console.log('📦 Pool database:', !!pool);
    console.log('🔑 JWT_SECRET présent:', !!process.env.JWT_SECRET);
    console.log('🗄️ DATABASE_URL présente:', !!process.env.DATABASE_URL);
    
    if (!pool) {
      return res.status(500).json({
        error: 'Pool database non initialisé',
        config: {
          hasPool: false,
          hasJWT: !!process.env.JWT_SECRET,
          hasDBURL: !!process.env.DATABASE_URL
        }
      });
    }

    // Test connexion database
    const testQuery = await pool.query('SELECT NOW()');
    console.log('✅ Test DB réussi:', testQuery.rows[0]);

    // Test table admin_users
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'admin_users'
      );
    `);
    
    console.log('📋 Table admin_users existe:', tableCheck.rows[0].exists);

    if (tableCheck.rows[0].exists) {
      const adminCount = await pool.query('SELECT COUNT(*) FROM admin_users');
      console.log('👥 Nombre d\'admins:', adminCount.rows[0].count);
    }

    res.json({
      status: 'OK',
      config: {
        hasPool: true,
        hasJWT: !!process.env.JWT_SECRET,
        hasDBURL: !!process.env.DATABASE_URL,
        dbConnected: true,
        adminTableExists: tableCheck.rows[0].exists,
        adminCount: tableCheck.rows[0].exists ? await pool.query('SELECT COUNT(*) FROM admin_users').then(r => r.rows[0].count) : 0
      }
    });

  } catch (error) {
    console.error('🚨 ERREUR DIAGNOSTIC:', error);
    res.status(500).json({
      error: 'Erreur diagnostic',
      message: error.message,
      code: error.code,
      config: {
        hasPool: !!pool,
        hasJWT: !!process.env.JWT_SECRET,
        hasDBURL: !!process.env.DATABASE_URL
      }
    });
  }
});

// Route de login avec diagnostic complet
router.post('/login', async (req, res) => {
  try {
    console.log('\n🔐 === DÉBUT LOGIN ADMIN ===');
    console.log('📧 Email reçu:', req.body.email);
    console.log('🔒 Password reçu:', req.body.password ? '***' : 'VIDE');
    
    const { email, password } = req.body;

    // Vérification des paramètres
    if (!email || !password) {
      console.log('❌ Email ou password manquant');
      return res.status(400).json({
        message: 'Email et mot de passe requis',
        received: { email: !!email, password: !!password }
      });
    }

    // Vérification configuration
    console.log('🔍 Vérification configuration...');
    console.log('📦 Pool database:', !!pool);
    console.log('🔑 JWT_SECRET:', !!process.env.JWT_SECRET);
    console.log('🗄️ DATABASE_URL:', !!process.env.DATABASE_URL);

    if (!pool) {
      console.log('❌ Pool database non initialisé');
      return res.status(500).json({
        message: 'Configuration database manquante',
        debug: 'Pool non initialisé - vérifiez DATABASE_URL'
      });
    }

    if (!process.env.JWT_SECRET) {
      console.log('❌ JWT_SECRET manquant');
      return res.status(500).json({
        message: 'Configuration JWT manquante',
        debug: 'JWT_SECRET non défini'
      });
    }

    // Test connexion database
    console.log('🔍 Test connexion database...');
    try {
      const testConnection = await pool.query('SELECT NOW()');
      console.log('✅ Database connectée:', testConnection.rows[0].now);
    } catch (dbError) {
      console.log('❌ Erreur connexion database:', dbError.message);
      return res.status(500).json({
        message: 'Erreur connexion database',
        debug: dbError.message
      });
    }

    // Vérification table admin_users
    console.log('🔍 Vérification table admin_users...');
    try {
      const tableCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'admin_users'
        );
      `);
      
      if (!tableCheck.rows[0].exists) {
        console.log('❌ Table admin_users n\'existe pas');
        return res.status(500).json({
          message: 'Table admin_users manquante',
          debug: 'La table admin_users n\'a pas été créée'
        });
      }
      console.log('✅ Table admin_users existe');
    } catch (tableError) {
      console.log('❌ Erreur vérification table:', tableError.message);
      return res.status(500).json({
        message: 'Erreur vérification table',
        debug: tableError.message
      });
    }

    // Recherche admin
    console.log('🔍 Recherche admin avec email:', email);
    const result = await pool.query(
      'SELECT * FROM admin_users WHERE email = $1',
      [email]
    );

    console.log('📊 Résultat recherche:', result.rows.length, 'admin(s) trouvé(s)');

    if (result.rows.length === 0) {
      console.log('❌ Aucun admin trouvé pour:', email);
      
      // Debug: lister tous les admins existants
      try {
        const allAdmins = await pool.query('SELECT email FROM admin_users');
        console.log('📋 Admins existants:', allAdmins.rows.map(a => a.email));
      } catch (e) {
        console.log('❌ Impossible de lister les admins:', e.message);
      }
      
      return res.status(401).json({ message: 'Email ou mot de passe incorrect' });
    }

    const admin = result.rows[0];
    console.log('👤 Admin trouvé:', admin.name, '- Role:', admin.role);

    // Vérification mot de passe
    console.log('🔍 Vérification mot de passe...');
    const validPassword = await bcrypt.compare(password, admin.password);
    console.log('🔒 Mot de passe valide:', validPassword);

    if (!validPassword) {
      console.log('❌ Mot de passe incorrect pour:', email);
      return res.status(401).json({ message: 'Email ou mot de passe incorrect' });
    }

    // Mise à jour last_login
    console.log('🔄 Mise à jour last_login...');
    await pool.query(
      'UPDATE admin_users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [admin.id]
    );

    // Génération token JWT
    console.log('🎫 Génération token JWT...');
    const token = jwt.sign(
      {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        type: 'admin'
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log('✅ Login admin réussi pour:', admin.name);
    console.log('🔐 === FIN LOGIN ADMIN ===\n');

    res.json({
      token,
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role
      }
    });

  } catch (error) {
    console.error('\n🚨 === ERREUR LOGIN ADMIN ===');
    console.error('Message:', error.message);
    console.error('Code:', error.code);
    console.error('Detail:', error.detail);
    console.error('Stack:', error.stack);
    console.error('🚨 === FIN ERREUR ===\n');
    
    res.status(500).json({
      message: 'Erreur serveur',
      debug: {
        message: error.message,
        code: error.code,
        hasPool: !!pool,
        hasJWT: !!process.env.JWT_SECRET,
        hasDBURL: !!process.env.DATABASE_URL
      }
    });
  }
});

// Route de vérification token
router.get('/verify', verifyAdmin, (req, res) => {
  console.log('✅ Token admin vérifié pour:', req.admin.email);
  res.json({ admin: req.admin });
});

// Route pour créer un admin (debug uniquement)
router.post('/create-admin', async (req, res) => {
  try {
    const { name, email, password, role = 'admin' } = req.body;
    
    console.log('👤 Création admin:', { name, email, role });

    // Vérifier si admin existe déjà
    const existing = await pool.query(
      'SELECT * FROM admin_users WHERE email = $1',
      [email]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ message: 'Admin existe déjà' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Créer admin
    const result = await pool.query(
      `INSERT INTO admin_users (name, email, password, role, created_at) 
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) 
       RETURNING id, name, email, role`,
      [name, email, hashedPassword, role]
    );

    console.log('✅ Admin créé:', result.rows[0]);

    res.json({
      message: 'Admin créé avec succès',
      admin: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Erreur création admin:', error);
    res.status(500).json({
      message: 'Erreur création admin',
      debug: error.message
    });
  }
});

module.exports = router;
