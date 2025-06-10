const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const pool = require('../config/database');

const router = express.Router();

// Liste des collaborateurs (admin seulement)
router.get('/collaborators', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id, first_name, last_name, email, phone, status, 
        contract_signed, contract_signed_at, created_at
      FROM collaborators 
      ORDER BY created_at DESC
    `);
    
    res.json({
      collaborators: result.rows.map(collab => ({
        id: collab.id,
        firstName: collab.first_name,
        lastName: collab.last_name,
        email: collab.email,
        phone: collab.phone,
        status: collab.status,
        contractSigned: collab.contract_signed,
        contractSignedAt: collab.contract_signed_at,
        joinedAt: collab.created_at
      }))
    });

  } catch (error) {
    console.error('Erreur admin collaborateurs:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des collaborateurs' });
  }
});

// Statistiques globales
router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const collaboratorsResult = await pool.query('SELECT COUNT(*) FROM collaborators WHERE status = $1', ['active']);
    const contractsResult = await pool.query('SELECT COUNT(*) FROM collaborators WHERE contract_signed = TRUE');
    const initiativesResult = await pool.query('SELECT COUNT(*) FROM initiatives WHERE is_active = TRUE');
    
    res.json({
      stats: {
        activeCollaborators: parseInt(collaboratorsResult.rows[0].count),
        signedContracts: parseInt(contractsResult.rows[0].count),
        activeInitiatives: parseInt(initiativesResult.rows[0].count),
        totalScans: Math.floor(Math.random() * 1000) + 500, // Simulation
        totalValidSignatures: Math.floor(Math.random() * 10000) + 5000 // Simulation
      }
    });

  } catch (error) {
    console.error('Erreur stats admin:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des statistiques' });
  }
});

module.exports = router;
