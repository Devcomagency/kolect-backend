const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const router = express.Router();

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

// Inscription
router.post('/register', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, password } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: 'Tous les champs requis' });
    }

    // Vérifier si email existe
    const existingUser = await pool.query('SELECT id FROM collaborators WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email déjà utilisé' });
    }

    // Hash du mot de passe
    const passwordHash = await bcrypt.hash(password, 12);

    // Insérer le collaborateur
    const result = await pool.query(`
      INSERT INTO collaborators (first_name, last_name, email, phone, password_hash)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, first_name, last_name, email, phone, created_at
    `, [firstName, lastName, email, phone || null, passwordHash]);

    const newUser = result.rows[0];

    res.status(201).json({
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
    console.error('Erreur inscription:', error);
    res.status(500).json({ error: 'Erreur lors de la création du compte' });
  }
});

// Connexion
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }

    // Trouver l'utilisateur
    const userResult = await pool.query('SELECT * FROM collaborators WHERE email = $1', [email]);
    
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    const user = userResult.rows[0];

    // Vérifier le mot de passe
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    // Générer le token JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Connexion réussie! 🎉',
      token,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        contractSigned: user.contract_signed
      }
    });

  } catch (error) {
    console.error('Erreur connexion:', error);
    res.status(500).json({ error: 'Erreur lors de la connexion' });
  }
});

module.exports = router;
