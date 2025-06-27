const express = require('express');
const pool = require('../../config/database');
const { verifyAdmin } = require('../../middleware/adminAuth');
const router = express.Router();

router.get('/', verifyAdmin, async (req, res) => {
  try {
    console.log('👥 Chargement liste collaborateurs...');

    const result = await pool.query(`
      SELECT 
        c.id,
        c.first_name,
        c.last_name,
        c.email,
        c.phone,
        c.status,
        c.created_at,
        COALESCE(SUM(s.total_signatures), 0) as total_signatures,
        COUNT(s.id) as total_scans,
        COALESCE(AVG(s.ocr_confidence), 0) as avg_quality,
        MAX(s.created_at) as last_scan
      FROM collaborators c
      LEFT JOIN scans s ON c.id = s.collaborator_id
      GROUP BY c.id, c.first_name, c.last_name, c.email, c.phone, c.status, c.created_at
      ORDER BY c.created_at DESC
    `);

    const collaborators = result.rows.map(collab => ({
      id: collab.id,
      name: (collab.first_name + ' ' + (collab.last_name || '')).trim(),
      email: collab.email,
      phone: collab.phone,
      status: collab.status,
      createdAt: collab.created_at,
      stats: {
        totalSignatures: parseInt(collab.total_signatures),
        totalScans: parseInt(collab.total_scans),
        avgQuality: Math.round(parseFloat(collab.avg_quality) * 100),
        lastScan: collab.last_scan
      }
    }));

    console.log('✅ ' + collaborators.length + ' collaborateurs chargés');
    res.json(collaborators);

  } catch (error) {
    console.error('❌ Erreur liste collaborateurs:', error);
    res.status(500).json({ message: 'Erreur chargement collaborateurs' });
  }
});

router.put('/:id/status', verifyAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    
    console.log('🔄 Changement statut collaborateur ' + req.params.id + ' -> ' + status);

    const result = await pool.query(`
      UPDATE collaborators 
      SET status = $1 
      WHERE id = $2 
      RETURNING first_name, last_name, email
    `, [status, req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Collaborateur non trouvé' });
    }

    await pool.query(`
      INSERT INTO admin_logs (admin_id, action, details)
      VALUES ($1, 'CHANGE_USER_STATUS', $2)
    `, [req.admin.id, JSON.stringify({ 
      user_id: req.params.id, 
      user_name: result.rows[0].first_name + ' ' + result.rows[0].last_name,
      new_status: status
    })]);

    res.json({ 
      message: 'Statut collaborateur changé vers ' + status,
      collaborator: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Erreur changement statut:', error);
    res.status(500).json({ message: 'Erreur changement statut' });
  }
});

module.exports = router;