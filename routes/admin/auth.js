const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../../config/database');
const { verifyAdmin } = require('../../middleware/adminAuth');
const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log('🔐 Tentative login admin:', email);

    const result = await pool.query(
      'SELECT * FROM admin_users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Email ou mot de passe incorrect' });
    }

    const admin = result.rows[0];
    const validPassword = await bcrypt.compare(password, admin.password);

    if (!validPassword) {
      return res.status(401).json({ message: 'Email ou mot de passe incorrect' });
    }

    await pool.query(
      'UPDATE admin_users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [admin.id]
    );

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

    console.log('✅ Login admin réussi:', admin.name);

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
    console.error('❌ Erreur login admin:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

router.get('/verify', verifyAdmin, (req, res) => {
  res.json({ admin: req.admin });
});

module.exports = router;