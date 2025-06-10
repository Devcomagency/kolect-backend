const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const pool = require('../config/database');

const router = express.Router();

// Dashboard global pour l'admin
router.get('/dashboard', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Statistiques générales
    const generalStatsQuery = `
      SELECT 
        (SELECT COUNT(*) FROM collaborators WHERE status = 'active') as active_collaborators,
        (SELECT COUNT(*) FROM collaborators WHERE contract_signed = true) as signed_contracts,
        (SELECT COUNT(*) FROM scans) as total_scans,
        (SELECT COALESCE(SUM(valid_signatures), 0) FROM scans) as total_valid_signatures,
        (SELECT COALESCE(SUM(rejected_signatures), 0) FROM scans) as total_rejected_signatures,
        (SELECT COUNT(*) FROM initiatives WHERE is_active = true) as active_initiatives
    `;
    
    const generalResult = await pool.query(generalStatsQuery);
    const generalStats = generalResult.rows[0];
    
    res.json({
      generalStats: {
        activeCollaborators: parseInt(generalStats.active_collaborators),
        signedContracts: parseInt(generalStats.signed_contracts),
        totalScans: parseInt(generalStats.total_scans),
        totalValidSignatures: parseInt(generalStats.total_valid_signatures),
        totalRejectedSignatures: parseInt(generalStats.total_rejected_signatures),
        activeInitiatives: parseInt(generalStats.active_initiatives)
      }
    });

  } catch (error) {
    console.error('Erreur dashboard:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération du dashboard' });
  }
});

// Statistiques par collaborateur (admin uniquement)
router.get('/collaborators', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const statsQuery = `
      SELECT 
        c.id,
        c.first_name,
        c.last_name,
        c.email,
        c.status,
        c.contract_signed,
        c.created_at,
        COUNT(s.id) as total_scans,
        COALESCE(SUM(s.valid_signatures), 0) as total_valid,
        COALESCE(SUM(s.rejected_signatures), 0) as total_rejected,
        COALESCE(SUM(s.total_signatures), 0) as total_signatures
      FROM collaborators c
      LEFT JOIN scans s ON c.id = s.collaborator_id
      WHERE c.status = 'active'
      GROUP BY c.id, c.first_name, c.last_name, c.email, c.status, c.contract_signed, c.created_at
      ORDER BY total_valid DESC
    `;
    
    const result = await pool.query(statsQuery);
    
    res.json({
      collaborators: result.rows.map(row => ({
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        status: row.status,
        contractSigned: row.contract_signed,
        joinedAt: row.created_at,
        stats: {
          totalScans: parseInt(row.total_scans),
          totalValid: parseInt(row.total_valid),
          totalRejected: parseInt(row.total_rejected),
          totalSignatures: parseInt(row.total_signatures)
        }
      }))
    });

  } catch (error) {
    console.error('Erreur stats collaborateurs:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des statistiques' });
  }
});

// Statistiques par initiative
router.get('/initiatives', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const statsQuery = `
      SELECT 
        i.id,
        i.name,
        i.description,
        i.color,
        i.created_at,
        COALESCE(SUM(s.valid_signatures), 0) as total_valid,
        COALESCE(SUM(s.rejected_signatures), 0) as total_rejected,
        COALESCE(SUM(s.total_signatures), 0) as total_signatures,
        COUNT(DISTINCT s.collaborator_id) as active_collectors,
        COUNT(s.id) as total_scans
      FROM initiatives i
      LEFT JOIN scans s ON i.id = s.initiative_id
      WHERE i.is_active = TRUE
      GROUP BY i.id, i.name, i.description, i.color, i.created_at
      ORDER BY total_valid DESC
    `;
    
    const result = await pool.query(statsQuery);
    
    const initiatives = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      color: row.color,
      createdAt: row.created_at,
      stats: {
        totalValid: parseInt(row.total_valid),
        totalRejected: parseInt(row.total_rejected),
        totalSignatures: parseInt(row.total_signatures),
        activeCollectors: parseInt(row.active_collectors),
        totalScans: parseInt(row.total_scans),
        validationRate: row.total_signatures > 0 ? 
          Math.round((row.total_valid / row.total_signatures) * 100) : 0
      }
    }));
    
    res.json({ initiatives });

  } catch (error) {
    console.error('Erreur stats initiatives:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des statistiques initiatives' });
  }
});

module.exports = router;
