const express = require('express');
const pool = require('../../config/database');
const { verifyAdmin } = require('../../middleware/adminAuth');
const router = express.Router();

router.get('/stats', verifyAdmin, async (req, res) => {
  try {
    console.log('📊 Chargement stats admin...');

    const statsQueries = await Promise.all([
      pool.query('SELECT COALESCE(SUM(total_signatures), 0) as total FROM scans'),
      pool.query(`SELECT COUNT(*) as count FROM collaborators WHERE created_at > CURRENT_DATE - INTERVAL '30 days'`),
      pool.query('SELECT ROUND(AVG(ocr_confidence * 100), 1) as avg FROM scans WHERE ocr_confidence IS NOT NULL'),
      pool.query('SELECT COUNT(*) as count FROM scans WHERE DATE(created_at) = CURRENT_DATE'),
      pool.query(`
        SELECT 
          c.first_name || ' ' || COALESCE(c.last_name, '') as name,
          COALESCE(SUM(s.total_signatures), 0) as total_signatures
        FROM collaborators c
        LEFT JOIN scans s ON c.id = s.collaborator_id
        GROUP BY c.id, c.first_name, c.last_name
        ORDER BY total_signatures DESC
        LIMIT 5
      `),
      pool.query(`
        SELECT 
          COALESCE(s.initiative, 'Initiative inconnue') as initiative,
          COALESCE(SUM(s.total_signatures), 0) as signatures,
          COUNT(s.id) as scans_count
        FROM scans s
        GROUP BY s.initiative
        ORDER BY signatures DESC
        LIMIT 10
      `)
    ]);

    const [totalSig, activeColl, avgQuality, todayScans, topCollabs, initiatives] = statsQueries;

    const stats = {
      totalSignatures: parseInt(totalSig.rows[0].total),
      activeCollaborators: parseInt(activeColl.rows[0].count),
      averageQuality: parseFloat(avgQuality.rows[0].avg) || 0,
      todayScans: parseInt(todayScans.rows[0].count),
      topCollaborators: topCollabs.rows,
      initiativeStats: initiatives.rows
    };

    console.log('✅ Stats calculées:', stats);
    res.json(stats);

  } catch (error) {
    console.error('❌ Erreur stats dashboard:', error);
    res.status(500).json({ message: 'Erreur chargement statistiques' });
  }
});

router.get('/recent-activity', verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        s.id,
        c.first_name || ' ' || COALESCE(c.last_name, '') as collaborator_name,
        COALESCE(s.initiative, 'Initiative') as initiative,
        s.total_signatures,
        s.ocr_confidence,
        s.created_at
      FROM scans s
      JOIN collaborators c ON s.collaborator_id = c.id
      ORDER BY s.created_at DESC
      LIMIT 10
    `);

    res.json(result.rows);

  } catch (error) {
    console.error('❌ Erreur activité récente:', error);
    res.status(500).json({ message: 'Erreur chargement activité' });
  }
});

module.exports = router;
