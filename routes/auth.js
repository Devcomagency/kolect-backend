const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const router = express.Router();

// =======================================
// 🧪 ENDPOINTS DE TEST
// =======================================

router.get('/test', (req, res) => {
  res.json({
    message: 'Route auth fonctionnelle! 🔑',
    timestamp: new Date().toISOString()
  });
});

router.get('/db-test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({
      message: 'Connexion DB OK! 🐘',
      timestamp: result.rows[0].now
    });
  } catch (error) {
    res.status(500).json({
      error: 'Erreur DB',
      details: error.message
    });
  }
});

// =======================================
// 📝 INSCRIPTION
// =======================================

router.post('/register', async (req, res) => {
  try {
    console.log('📝 === INSCRIPTION ===');
    const { firstName, lastName, email, phone, password } = req.body;
    console.log('📧 Email inscription:', email);

    if (!firstName || !lastName || !email || !password) {
      console.log('❌ Champs manquants');
      return res.status(400).json({
        success: false,
        error: 'Tous les champs requis (firstName, lastName, email, password)'
      });
    }

    // Vérifier si email existe
    const existingUser = await pool.query('SELECT id FROM collaborators WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      console.log('❌ Email déjà utilisé:', email);
      return res.status(400).json({
        success: false,
        error: 'Email déjà utilisé'
      });
    }

    // Hash du mot de passe
    const passwordHash = await bcrypt.hash(password, 12);

    // Insérer le collaborateur
    const result = await pool.query(`
      INSERT INTO collaborators (first_name, last_name, email, phone, password_hash, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING id, first_name, last_name, email, phone, created_at
    `, [firstName, lastName, email, phone || null, passwordHash]);

    const newUser = result.rows[0];

    console.log('✅ Nouveau collaborateur créé:', {
      id: newUser.id,
      email: newUser.email,
      firstName: newUser.first_name
    });

    res.status(201).json({
      success: true,
      message: 'Compte créé avec succès! 🌿',
      user: {
        id: newUser.id,
        firstName: newUser.first_name,
        lastName: newUser.last_name,
        email: newUser.email,
        phone: newUser.phone
      }
    });

  } catch (error) {
    console.error('❌ Erreur inscription:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la création du compte',
      details: error.message
    });
  }
});

// =======================================
// 🔑 CONNEXION (CORRIGÉE)
// =======================================

router.post('/login', async (req, res) => {
  try {
    console.log('🔑 === CONNEXION ===');
    const { email, password } = req.body;
    console.log('📧 Email de connexion:', email);

    if (!email || !password) {
      console.log('❌ Email ou mot de passe manquant');
      return res.status(400).json({
        success: false,
        error: 'Email et mot de passe requis'
      });
    }

    // 1. TROUVER L'UTILISATEUR EXACT
    const userResult = await pool.query(
      'SELECT * FROM collaborators WHERE email = $1',
      [email]
    );
    
    if (userResult.rows.length === 0) {
      console.log('❌ Utilisateur non trouvé pour email:', email);
      return res.status(401).json({
        success: false,
        error: 'Email ou mot de passe incorrect'
      });
    }

    const user = userResult.rows[0];
    console.log('✅ Utilisateur trouvé:', {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name
    });

    // 2. VÉRIFIER LE MOT DE PASSE
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      console.log('❌ Mot de passe incorrect pour:', email);
      return res.status(401).json({
        success: false,
        error: 'Email ou mot de passe incorrect'
      });
    }

    console.log('✅ Mot de passe valide pour:', email);

    // 3. GÉNÉRER LE TOKEN AVEC LE BON USER ID ✅
    const tokenPayload = {
      userId: user.id,        // ← UTILISER L'ID DU VRAI USER !
      id: user.id,           // ← AUSSI POUR COMPATIBILITÉ
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name
    };

    console.log('🔑 Payload du token:', tokenPayload);

    const token = jwt.sign(
      tokenPayload,
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log('✅ Token généré pour user ID:', user.id);

    // 4. RÉPONSE AVEC LES BONNES DONNÉES
    const responseData = {
      success: true,
      message: 'Connexion réussie! 🎉',
      token: token,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        phone: user.phone,
        contractSigned: user.contract_signed || false,
        status: user.status || 'active'
      }
    };

    console.log('📤 Réponse login:', {
      success: responseData.success,
      userId: responseData.user.id,
      firstName: responseData.user.firstName,
      lastName: responseData.user.lastName,
      tokenPresent: !!responseData.token
    });

    res.json(responseData);

  } catch (error) {
    console.error('❌ Erreur connexion:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la connexion',
      details: error.message
    });
  }
});

// =======================================
// 🔍 ENDPOINTS DE DEBUG
// =======================================

// 🔍 ENDPOINT: Vérifier le token
router.get('/verify-token', async (req, res) => {
  try {
    console.log('🔍 === VÉRIFICATION TOKEN ===');
    
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      console.log('❌ Pas de token fourni');
      return res.status(401).json({
        success: false,
        error: 'Pas de token fourni'
      });
    }

    console.log('🔑 Token reçu (premiers 20 chars):', token.substring(0, 20));

    // Décoder le token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('🔍 Token décodé:', decoded);

    // Vérifier que l'utilisateur existe toujours
    const userResult = await pool.query(
      'SELECT id, email, first_name, last_name, phone, status FROM collaborators WHERE id = $1',
      [decoded.userId || decoded.id]
    );

    if (userResult.rows.length === 0) {
      console.log('❌ Utilisateur du token non trouvé pour ID:', decoded.userId || decoded.id);
      return res.status(401).json({
        success: false,
        error: 'Utilisateur du token non trouvé'
      });
    }

    const user = userResult.rows[0];
    console.log('✅ Utilisateur du token validé:', {
      id: user.id,
      email: user.email,
      firstName: user.first_name
    });

    res.json({
      success: true,
      message: 'Token valide',
      tokenData: decoded,
      currentUser: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        status: user.status
      }
    });

  } catch (error) {
    console.error('❌ Erreur vérification token:', error);
    res.status(403).json({
      success: false,
      error: 'Token invalide',
      details: error.message
    });
  }
});

// 🔍 ENDPOINT: Test de connexion spécifique
router.post('/test-login', async (req, res) => {
  try {
    console.log('🧪 === TEST LOGIN SPÉCIFIQUE ===');
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email requis pour le test'
      });
    }

    // Chercher l'utilisateur
    const userResult = await pool.query(
      'SELECT id, email, first_name, last_name, password_hash FROM collaborators WHERE email = $1',
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Utilisateur non trouvé'
      });
    }

    const user = userResult.rows[0];

    console.log('🔍 Utilisateur trouvé pour test:', {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      hasPassword: !!user.password_hash
    });

    res.json({
      success: true,
      message: 'Utilisateur trouvé',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        hasPassword: !!user.password_hash
      }
    });

  } catch (error) {
    console.error('❌ Erreur test login:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur test',
      details: error.message
    });
  }
});

// =======================================
// 📊 ENDPOINT: Statistiques auth
// =======================================

router.get('/stats', async (req, res) => {
  try {
    console.log('📊 === STATS AUTH ===');

    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_collaborators,
        COUNT(*) FILTER (WHERE status = 'active') as active_collaborators,
        COUNT(*) FILTER (WHERE contract_signed = true) as signed_contracts,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days') as new_this_week,
        MIN(created_at) as first_registration,
        MAX(created_at) as last_registration
      FROM collaborators
    `);

    const authStats = stats.rows[0];

    console.log('📊 Stats auth calculées:', authStats);

    res.json({
      success: true,
      message: 'Statistiques auth récupérées',
      stats: {
        totalCollaborators: parseInt(authStats.total_collaborators),
        activeCollaborators: parseInt(authStats.active_collaborators),
        signedContracts: parseInt(authStats.signed_contracts),
        newThisWeek: parseInt(authStats.new_this_week),
        firstRegistration: authStats.first_registration,
        lastRegistration: authStats.last_registration
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur stats auth:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur récupération stats',
      details: error.message
    });
  }
});

module.exports = router;
