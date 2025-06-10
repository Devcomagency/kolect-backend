const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const pool = require('../config/database');

const router = express.Router();

// Profil avec stats CORRIGÉES
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    console.log('🔍 Récupération profil pour utilisateur ID:', user.id);
    
    // Stats du collaborateur SEULEMENT
    const statsQuery = `
      SELECT 
        COUNT(s.id) as total_scans,
        COALESCE(SUM(s.valid_signatures), 0) as total_valid_signatures,
        COALESCE(SUM(s.rejected_signatures), 0) as total_rejected_signatures,
        COALESCE(SUM(s.total_signatures), 0) as total_signatures
      FROM scans s
      WHERE s.collaborator_id = $1
    `;
    
    console.log('🔍 Exécution requête stats pour collaborator_id:', user.id);
    const statsResult = await pool.query(statsQuery, [user.id]);
    const stats = statsResult.rows[0];
    
    console.log('📊 Stats brutes:', stats);

    // Debug: vérifier tous les scans de ce collaborateur
    const debugQuery = 'SELECT * FROM scans WHERE collaborator_id = $1';
    const debugResult = await pool.query(debugQuery, [user.id]);
    console.log('🔍 Scans de ce collaborateur:', debugResult.rows);

    res.json({
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        phone: user.phone,
        contractSigned: user.contract_signed,
        status: user.status,
        joinedAt: user.created_at
      },
      stats: {
        totalScans: parseInt(stats.total_scans) || 0,
        totalValidSignatures: parseInt(stats.total_valid_signatures) || 0,
        totalRejectedSignatures: parseInt(stats.total_rejected_signatures) || 0,
        totalSignatures: parseInt(stats.total_signatures) || 0,
        validationRate: stats.total_signatures > 0 ? 
          Math.round((stats.total_valid_signatures / stats.total_signatures) * 100) : 0
      },
      debug: {
        userId: user.id,
        rawStats: stats,
        scansCount: debugResult.rows.length
      }
    });

  } catch (error) {
    console.error('❌ Erreur profil:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération du profil' });
  }
});

module.exports = router;
