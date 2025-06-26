// ✅ NOUVEAU FICHIER: routes/initiatives.js
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// 📋 GET - Contextes initiatives actives
router.get('/contexts/active', authenticateToken, async (req, res) => {
  try {
    console.log('📋 Récupération contextes initiatives actives...');
    
    const query = `
      SELECT 
        initiative_name,
        description,
        keywords,
        context_prompt
      FROM initiative_contexts 
      WHERE status = 'active'
      ORDER BY initiative_name
    `;
    
    const result = await pool.query(query);
    const initiatives = result.rows;
    
    console.log(`✅ ${initiatives.length} initiatives actives trouvées`);
    
    res.json({
      success: true,
      initiatives: initiatives
    });
    
  } catch (error) {
    console.error('❌ Erreur récupération contextes initiatives:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur serveur lors de la récupération des contextes',
      details: error.message
    });
  }
});

// 📝 POST - Créer nouvelle initiative (pour backoffice)
router.post('/contexts', authenticateToken, async (req, res) => {
  try {
    const { initiative_name, description, keywords, status = 'active' } = req.body;
    
    console.log('➕ Création nouvelle initiative:', initiative_name);
    
    const query = `
      INSERT INTO initiative_contexts (initiative_name, description, keywords, status)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    
    const result = await pool.query(query, [initiative_name, description, keywords, status]);
    const newInitiative = result.rows[0];
    
    console.log('✅ Initiative créée:', newInitiative.id);
    
    res.json({
      success: true,
      initiative: newInitiative
    });
    
  } catch (error) {
    console.error('❌ Erreur création initiative:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la création de l\'initiative',
      details: error.message
    });
  }
});

module.exports = router;
