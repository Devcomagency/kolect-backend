const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const pool = require('../config/database');

const router = express.Router();

// =======================================
// 🏠 DASHBOARD STATS - VERSION AMÉLIORÉE
// =======================================

router.get('/dashboard-stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('📊 === RÉCUPÉRATION STATS DASHBOARD ADMIN ===');

    // Stats principales avec vraies données
    const stats = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM collaborators WHERE status = 'active') as active_collaborators,
        (SELECT COUNT(*) FROM scans WHERE DATE(created_at) = CURRENT_DATE) as scans_today,
        (SELECT COUNT(*) FROM scans WHERE created_at >= CURRENT_DATE - INTERVAL '7 days') as scans_week,
        (SELECT COALESCE(SUM(signatures), 0) FROM scans) as total_signatures,
        (SELECT COALESCE(ROUND(AVG(quality), 1), 0) FROM scans WHERE quality > 0) as avg_quality,
        (SELECT COUNT(*) FROM scans WHERE quality < 70 OR signatures > 25 OR signatures < 3) as pending_validation,
        (SELECT COUNT(*) FROM collaborators WHERE contract_signed = TRUE) as signed_contracts,
        (SELECT COUNT(*) FROM initiatives WHERE is_active = TRUE) as active_initiatives
    `);

    // Top performers avec vraies données
    const topPerformers = await pool.query(`
      SELECT 
        c.id, c.first_name, c.last_name, c.email,
        COUNT(s.id) as total_scans,
        COALESCE(SUM(s.signatures), 0) as total_signatures,
        COALESCE(ROUND(AVG(s.quality), 1), 0) as avg_quality
      FROM collaborators c
      LEFT JOIN scans s ON c.id = s.user_id
      WHERE c.status = 'active'
      GROUP BY c.id, c.first_name, c.last_name, c.email
      ORDER BY total_signatures DESC
      LIMIT 5
    `);

    // Activité récente
    const recentActivity = await pool.query(`
      SELECT 
        s.id, s.signatures, s.quality, s.created_at, s.initiative,
        c.first_name, c.last_name
      FROM scans s
      JOIN collaborators c ON s.user_id = c.id
      ORDER BY s.created_at DESC
      LIMIT 10
    `);

    console.log('✅ Stats dashboard récupérées:', {
      activeCollaborators: stats.rows[0].active_collaborators,
      scansToday: stats.rows[0].scans_today,
      totalSignatures: stats.rows[0].total_signatures
    });

    res.json({
      success: true,
      stats: stats.rows[0],
      topPerformers: topPerformers.rows,
      recentActivity: recentActivity.rows
    });
  } catch (error) {
    console.log('❌ Erreur récupération stats dashboard:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// =======================================
// 👥 COLLABORATEURS - VERSION ÉTENDUE
// =======================================

// Liste des collaborateurs (votre version existante améliorée)
router.get('/collaborators', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('👥 === RÉCUPÉRATION LISTE COLLABORATEURS ADMIN ===');
    
    const { page = 1, limit = 20, search = '', status = 'all' } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    let params = [limit, offset];
    let paramIndex = 3;

    // Filtre recherche
    if (search) {
      whereClause += ` AND (c.first_name ILIKE $${paramIndex} OR c.last_name ILIKE $${paramIndex} OR c.email ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Filtre statut
    if (status !== 'all') {
      whereClause += ` AND c.status = $${paramIndex}`;
      params.push(status);
    }

    const result = await pool.query(`
      SELECT
        c.id, c.first_name, c.last_name, c.email, c.phone, c.status,
        c.contract_signed, c.contract_signed_at, c.created_at,
        COUNT(s.id) as total_scans,
        COALESCE(SUM(s.signatures), 0) as total_signatures,
        COALESCE(ROUND(AVG(s.quality), 1), 0) as avg_quality,
        MAX(s.created_at) as last_scan
      FROM collaborators c
      LEFT JOIN scans s ON c.id = s.user_id
      ${whereClause}
      GROUP BY c.id, c.first_name, c.last_name, c.email, c.phone, c.status, c.contract_signed, c.contract_signed_at, c.created_at
      ORDER BY c.created_at DESC
      LIMIT $1 OFFSET $2
    `, params);

    // Count total pour pagination
    const countResult = await pool.query(`
      SELECT COUNT(*) FROM collaborators c ${whereClause.replace(/GROUP BY.*|ORDER BY.*|LIMIT.*/g, '')}
    `, params.slice(2));

    console.log('✅ Collaborateurs récupérés:', result.rows.length);
    
    res.json({
      success: true,
      collaborators: result.rows.map(collab => ({
        id: collab.id,
        firstName: collab.first_name,
        lastName: collab.last_name,
        email: collab.email,
        phone: collab.phone,
        status: collab.status,
        contractSigned: collab.contract_signed,
        contractSignedAt: collab.contract_signed_at,
        joinedAt: collab.created_at,
        totalScans: parseInt(collab.total_scans) || 0,
        totalSignatures: parseInt(collab.total_signatures) || 0,
        avgQuality: parseFloat(collab.avg_quality) || 0,
        lastScan: collab.last_scan
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        totalPages: Math.ceil(countResult.rows[0].count / limit)
      }
    });

  } catch (error) {
    console.error('❌ Erreur admin collaborateurs:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des collaborateurs' });
  }
});

// Actions sur collaborateur
router.post('/collaborator/:id/action', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { action, reason } = req.body;

    console.log(`👤 === ACTION COLLABORATEUR ${id} ===`);
    console.log('Action:', action, 'Raison:', reason);

    // Vérifier que le collaborateur existe
    const userCheck = await pool.query('SELECT * FROM collaborators WHERE id = $1', [id]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Collaborateur non trouvé' });
    }

    switch (action) {
      case 'suspend':
        await pool.query(
          'UPDATE collaborators SET status = $1, updated_at = NOW() WHERE id = $2',
          ['suspended', id]
        );
        break;
      
      case 'activate':
        await pool.query(
          'UPDATE collaborators SET status = $1, updated_at = NOW() WHERE id = $2',
          ['active', id]
        );
        break;
      
      case 'delete':
        await pool.query(
          'UPDATE collaborators SET status = $1, updated_at = NOW() WHERE id = $2',
          ['deleted', id]
        );
        break;

      default:
        return res.status(400).json({ error: 'Action invalide' });
    }

    console.log(`✅ Collaborateur ${id} ${action === 'suspend' ? 'suspendu' : action === 'activate' ? 'activé' : 'supprimé'}`);

    res.json({
      success: true,
      message: `Collaborateur ${action === 'suspend' ? 'suspendu' : action === 'activate' ? 'activé' : 'supprimé'} avec succès`
    });
  } catch (error) {
    console.log('❌ Erreur action collaborateur:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// =======================================
// 🔍 VALIDATION SCANS
// =======================================

// Scans en attente de validation
router.get('/pending-scans', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('🔍 === RÉCUPÉRATION SCANS EN ATTENTE ===');

    const pendingScans = await pool.query(`
      SELECT 
        s.*,
        c.first_name, c.last_name, c.email,
        CASE 
          WHEN s.quality < 70 AND s.signatures > 25 THEN 'Qualité faible + trop de signatures'
          WHEN s.quality < 70 AND s.signatures < 3 THEN 'Qualité faible + peu de signatures'
          WHEN s.quality < 70 THEN 'Qualité faible (<70%)'
          WHEN s.signatures > 25 THEN 'Trop de signatures (>25)'
          WHEN s.signatures < 3 THEN 'Peu de signatures (<3)'
          ELSE 'Scan suspect'
        END as validation_reason
      FROM scans s
      JOIN collaborators c ON s.user_id = c.id
      WHERE s.quality < 70 OR s.signatures > 25 OR s.signatures < 3
      ORDER BY s.created_at DESC
      LIMIT 50
    `);

    console.log('✅ Scans en attente:', pendingScans.rows.length);

    res.json({
      success: true,
      pendingScans: pendingScans.rows
    });
  } catch (error) {
    console.log('❌ Erreur récupération scans en attente:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Valider un scan
router.post('/validate-scan/:scanId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { scanId } = req.params;
    const { action, correctedSignatures, adminNotes } = req.body;

    console.log(`🔍 === VALIDATION SCAN ${scanId} ===`);
    console.log('Action:', action);

    // Ajouter colonne validation_status si elle n'existe pas
    try {
      await pool.query('ALTER TABLE scans ADD COLUMN IF NOT EXISTS validation_status VARCHAR(20)');
      await pool.query('ALTER TABLE scans ADD COLUMN IF NOT EXISTS validated_by INTEGER');
      await pool.query('ALTER TABLE scans ADD COLUMN IF NOT EXISTS validated_at TIMESTAMP');
      await pool.query('ALTER TABLE scans ADD COLUMN IF NOT EXISTS validator_notes TEXT');
    } catch (alterError) {
      // Ignore si les colonnes existent déjà
    }

    let updateQuery;
    let params;

    switch (action) {
      case 'approve':
        updateQuery = `
          UPDATE scans 
          SET validation_status = 'approved', validated_by = $1, validated_at = NOW()
          WHERE id = $2
        `;
        params = [req.user.id, scanId];
        break;
      
      case 'reject':
        updateQuery = `
          UPDATE scans 
          SET validation_status = 'rejected', validated_by = $1, validated_at = NOW(), 
              validator_notes = $3
          WHERE id = $2
        `;
        params = [req.user.id, scanId, adminNotes || 'Rejeté par admin'];
        break;
      
      case 'correct':
        updateQuery = `
          UPDATE scans 
          SET signatures = $1, validation_status = 'corrected', validated_by = $2, 
              validated_at = NOW(), validator_notes = $4
          WHERE id = $3
        `;
        params = [correctedSignatures, req.user.id, scanId, adminNotes || 'Corrigé par admin'];
        break;

      default:
        return res.status(400).json({ error: 'Action invalide' });
    }

    const result = await pool.query(updateQuery, params);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Scan non trouvé' });
    }

    console.log(`✅ Scan ${scanId} ${action === 'approve' ? 'approuvé' : action === 'reject' ? 'rejeté' : 'corrigé'}`);

    res.json({
      success: true,
      message: `Scan ${action === 'approve' ? 'approuvé' : action === 'reject' ? 'rejeté' : 'corrigé'} avec succès`
    });
  } catch (error) {
    console.log('❌ Erreur validation scan:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// =======================================
// 📊 ANALYTICS AVANCÉES
// =======================================

router.get('/analytics', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('📊 === RÉCUPÉRATION ANALYTICS ===');

    // Analytics par période
    const dailyStats = await pool.query(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as scans_count,
        COALESCE(SUM(signatures), 0) as signatures_count,
        COALESCE(ROUND(AVG(quality), 1), 0) as avg_quality
      FROM scans 
      WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);

    // Analytics par initiative
    const initiativeStats = await pool.query(`
      SELECT 
        initiative,
        COUNT(*) as scans_count,
        COALESCE(SUM(signatures), 0) as signatures_count,
        COALESCE(ROUND(AVG(quality), 1), 0) as avg_quality
      FROM scans 
      WHERE initiative IS NOT NULL
      GROUP BY initiative
      ORDER BY signatures_count DESC
    `);

    console.log('✅ Analytics récupérées');

    res.json({
      success: true,
      analytics: {
        daily: dailyStats.rows,
        initiatives: initiativeStats.rows
      }
    });
  } catch (error) {
    console.log('❌ Erreur récupération analytics:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// =======================================
// 📄 EXPORTS
// =======================================

// Export CSV collaborateurs
router.get('/export/collaborators', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('📄 === EXPORT CSV COLLABORATEURS ===');

    const collaborators = await pool.query(`
      SELECT 
        c.id, c.first_name, c.last_name, c.email, c.phone,
        c.status, c.contract_signed, c.created_at,
        COUNT(s.id) as total_scans,
        COALESCE(SUM(s.signatures), 0) as total_signatures,
        COALESCE(ROUND(AVG(s.quality), 1), 0) as avg_quality
      FROM collaborators c
      LEFT JOIN scans s ON c.id = s.user_id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `);

    // Générer le CSV
    const csvHeader = 'ID,Prénom,Nom,Email,Téléphone,Statut,Contrat signé,Date création,Total scans,Total signatures,Qualité moyenne\n';
    const csvRows = collaborators.rows.map(user =>
      `${user.id},"${user.first_name}","${user.last_name}","${user.email}","${user.phone || ''}","${user.status}","${user.contract_signed ? 'Oui' : 'Non'}","${user.created_at}",${user.total_scans},${user.total_signatures},${user.avg_quality}`
    ).join('\n');

    const csvContent = csvHeader + csvRows;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="kolect_collaborateurs.csv"');
    res.send('\ufeff' + csvContent); // BOM pour UTF-8
  } catch (error) {
    console.log('❌ Erreur export CSV:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// =======================================
// 📊 STATISTIQUES GLOBALES (votre version existante)
// =======================================

router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const collaboratorsResult = await pool.query('SELECT COUNT(*) FROM collaborators WHERE status = $1', ['active']);
    const contractsResult = await pool.query('SELECT COUNT(*) FROM collaborators WHERE contract_signed = TRUE');
    
    // Initiatives existantes ou par défaut
    let initiativesCount = 3; // Par défaut
    try {
      const initiativesResult = await pool.query('SELECT COUNT(*) FROM initiatives WHERE is_active = TRUE');
      initiativesCount = parseInt(initiativesResult.rows[0].count);
    } catch (err) {
      // Table initiatives n'existe peut-être pas
    }

    // Vraies données de scans
    const scansResult = await pool.query('SELECT COUNT(*) FROM scans');
    const signaturesResult = await pool.query('SELECT COALESCE(SUM(signatures), 0) FROM scans');
    
    res.json({
      stats: {
        activeCollaborators: parseInt(collaboratorsResult.rows[0].count),
        signedContracts: parseInt(contractsResult.rows[0].count),
        activeInitiatives: initiativesCount,
        totalScans: parseInt(scansResult.rows[0].count),
        totalValidSignatures: parseInt(signaturesResult.rows[0].coalesce)
      }
    });

  } catch (error) {
    console.error('Erreur stats admin:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des statistiques' });
  }
});

module.exports = router;
