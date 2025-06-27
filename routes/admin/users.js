const express = require('express');
const pool = require('../../config/database');
const { verifyAdmin } = require('../../middleware/adminAuth');
const router = express.Router();

// GET /api/admin/users - Liste collaborateurs avec stats
router.get('/', verifyAdmin, async (req, res) => {
  try {
    console.log('👥 Récupération collaborateurs admin...');

    const collaborators = await pool.query(`
      SELECT 
        cs.id,
        cs.first_name,
        cs.last_name,
        cs.email,
        cs.phone,
        cs.status,
        cs.is_active,
        cs.suspended,
        cs.suspension_reason,
        cs.contract_type,
        cs.id_document_type,
        cs.created_at,
        cs.hire_date,
        cs.total_scans,
        cs.total_signatures,
        ROUND(cs.avg_quality, 1) as avg_quality,
        ROUND(cs.avg_confidence, 1) as avg_confidence,
        cs.last_scan_date,
        cs.initiatives_worked,
        cs.scans_last_7_days,
        cs.scans_last_30_days,
        cs.signature_ranking
      FROM collaborator_stats cs
      WHERE cs.status != 'deleted' OR cs.status IS NULL
      ORDER BY cs.total_signatures DESC
    `);

    const formattedCollaborators = collaborators.rows.map(collab => ({
      id: collab.id,
      name: `${collab.first_name || ''} ${collab.last_name || ''}`.trim() || 'Nom manquant',
      firstName: collab.first_name,
      lastName: collab.last_name,
      email: collab.email,
      phone: collab.phone,
      status: collab.status || 'active',
      isActive: collab.is_active,
      suspended: collab.suspended || false,
      suspensionReason: collab.suspension_reason,
      contractType: collab.contract_type,
      idDocumentType: collab.id_document_type,
      createdAt: collab.created_at,
      hireDate: collab.hire_date,
      scanCount: parseInt(collab.total_scans) || 0,
      signatures: parseInt(collab.total_signatures) || 0,
      avgQuality: parseFloat(collab.avg_quality) || 0,
      avgConfidence: parseFloat(collab.avg_confidence) || 0,
      lastScan: collab.last_scan_date,
      initiativesWorked: parseInt(collab.initiatives_worked) || 0,
      scansLast7Days: parseInt(collab.scans_last_7_days) || 0,
      scansLast30Days: parseInt(collab.scans_last_30_days) || 0,
      ranking: parseInt(collab.signature_ranking) || 0
    }));

    console.log(`✅ ${formattedCollaborators.length} collaborateurs récupérés`);
    res.json(formattedCollaborators);

  } catch (error) {
    console.error('❌ Erreur récupération collaborateurs:', error);
    res.status(500).json({
      message: 'Erreur récupération collaborateurs',
      debug: error.message
    });
  }
});

// GET /api/admin/users/:id/details - Détails complets collaborateur
router.get('/:id/details', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🔍 Détails collaborateur ID: ${id}`);

    // Informations principales
    const collaborator = await pool.query(`
      SELECT * FROM collaborator_stats WHERE id = $1
    `, [id]);

    if (collaborator.rows.length === 0) {
      return res.status(404).json({ error: 'Collaborateur non trouvé' });
    }

    // Historique des scans
    const scanHistory = await pool.query(`
      SELECT 
        s.id,
        s.initiative,
        s.signatures,
        s.quality,
        s.confidence,
        s.created_at,
        CASE 
          WHEN sv.verification_status IS NOT NULL 
          THEN sv.verification_status 
          ELSE 'unverified' 
        END as verification_status
      FROM scans s
      LEFT JOIN scan_verifications sv ON s.id = sv.scan_id
      WHERE s.collaborator_id = $1 OR s.user_id = $1
      ORDER BY s.created_at DESC
      LIMIT 50
    `, [id]);

    // Scans par initiative
    const scansByInitiative = await pool.query(`
      SELECT 
        initiative,
        COUNT(*) as scan_count,
        SUM(signatures) as total_signatures,
        AVG(quality) as avg_quality,
        MAX(created_at) as last_scan
      FROM scans
      WHERE (collaborator_id = $1 OR user_id = $1) AND initiative IS NOT NULL
      GROUP BY initiative
      ORDER BY total_signatures DESC
    `, [id]);

    const collaboratorDetails = {
      ...collaborator.rows[0],
      scanHistory: scanHistory.rows.map(scan => ({
        id: scan.id,
        initiative: scan.initiative,
        signatures: scan.signatures,
        quality: Math.round(scan.quality || 0),
        confidence: Math.round(scan.confidence || 0),
        createdAt: scan.created_at,
        verificationStatus: scan.verification_status
      })),
      scansByInitiative: scansByInitiative.rows.map(init => ({
        initiative: init.initiative,
        scanCount: parseInt(init.scan_count),
        totalSignatures: parseInt(init.total_signatures) || 0,
        avgQuality: Math.round(parseFloat(init.avg_quality) || 0),
        lastScan: init.last_scan
      }))
    };

    res.json({ collaborator: collaboratorDetails });

  } catch (error) {
    console.error('❌ Erreur détails collaborateur:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/admin/users/:id/suspend - Suspendre collaborateur
router.patch('/:id/suspend', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminId = req.admin.id;

    console.log(`⚠️ Suspension collaborateur ID: ${id}, raison: ${reason}`);

    if (!reason || reason.trim() === '') {
      return res.status(400).json({ error: 'Raison de suspension requise' });
    }

    await pool.query(`
      UPDATE collaborators 
      SET 
        suspended = TRUE,
        suspension_reason = $1,
        suspended_at = NOW(),
        suspended_by = $2
      WHERE id = $3
    `, [reason.trim(), adminId, id]);

    // Log action admin
    await pool.query(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id, details)
      VALUES ($1, 'suspend_user', 'collaborator', $2, $3)
    `, [adminId, id, JSON.stringify({ reason: reason.trim() })]);

    console.log(`✅ Collaborateur ${id} suspendu par admin ${adminId}`);
    res.json({
      success: true,
      message: 'Collaborateur suspendu avec succès'
    });

  } catch (error) {
    console.error('❌ Erreur suspension:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/admin/users/:id/unsuspend - Réactiver collaborateur
router.patch('/:id/unsuspend', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.admin.id;

    console.log(`✅ Réactivation collaborateur ID: ${id}`);

    await pool.query(`
      UPDATE collaborators 
      SET 
        suspended = FALSE,
        suspension_reason = NULL,
        suspended_at = NULL,
        suspended_by = NULL
      WHERE id = $1
    `, [id]);

    // Log action admin
    await pool.query(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id, details)
      VALUES ($1, 'unsuspend_user', 'collaborator', $2, $3)
    `, [adminId, id, JSON.stringify({})]);

    console.log(`✅ Collaborateur ${id} réactivé par admin ${adminId}`);
    res.json({
      success: true,
      message: 'Collaborateur réactivé avec succès'
    });

  } catch (error) {
    console.error('❌ Erreur réactivation:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/admin/users/:id - Supprimer collaborateur (soft delete)
router.delete('/:id', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.admin.id;

    console.log(`🗑️ Suppression collaborateur ID: ${id}`);

    // Soft delete - conserver les données pour historique
    await pool.query(`
      UPDATE collaborators 
      SET 
        status = 'deleted',
        is_active = FALSE,
        deleted_at = NOW(),
        deleted_by = $1
      WHERE id = $2
    `, [adminId, id]);

    // Log action admin
    await pool.query(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id, details)
      VALUES ($1, 'delete_user', 'collaborator', $2, $3)
    `, [adminId, id, JSON.stringify({})]);

    console.log(`✅ Collaborateur ${id} supprimé par admin ${adminId}`);
    res.json({
      success: true,
      message: 'Collaborateur supprimé avec succès'
    });

  } catch (error) {
    console.error('❌ Erreur suppression:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/admin/users/:id/update - Mettre à jour infos collaborateur
router.patch('/:id/update', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      firstName,
      lastName,
      email,
      phone,
      contractType,
      idDocumentType,
      idDocumentNumber,
      idDocumentExpiry
    } = req.body;
    const adminId = req.admin.id;

    console.log(`📝 Mise à jour collaborateur ID: ${id}`);

    const updates = [];
    const values = [];
    let paramCount = 0;

    if (firstName !== undefined) {
      paramCount++;
      updates.push(`first_name = $${paramCount}`);
      values.push(firstName);
    }
    if (lastName !== undefined) {
      paramCount++;
      updates.push(`last_name = $${paramCount}`);
      values.push(lastName);
    }
    if (email !== undefined) {
      paramCount++;
      updates.push(`email = $${paramCount}`);
      values.push(email);
    }
    if (phone !== undefined) {
      paramCount++;
      updates.push(`phone = $${paramCount}`);
      values.push(phone);
    }
    if (contractType !== undefined) {
      paramCount++;
      updates.push(`contract_type = $${paramCount}`);
      values.push(contractType);
    }
    if (idDocumentType !== undefined) {
      paramCount++;
      updates.push(`id_document_type = $${paramCount}`);
      values.push(idDocumentType);
    }
    if (idDocumentNumber !== undefined) {
      paramCount++;
      updates.push(`id_document_number = $${paramCount}`);
      values.push(idDocumentNumber);
    }
    if (idDocumentExpiry !== undefined) {
      paramCount++;
      updates.push(`id_document_expiry = $${paramCount}`);
      values.push(idDocumentExpiry);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Aucune donnée à mettre à jour' });
    }

    paramCount++;
    values.push(id);

    await pool.query(`
      UPDATE collaborators 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
    `, values);

    // Log action admin
    await pool.query(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id, details)
      VALUES ($1, 'update_user', 'collaborator', $2, $3)
    `, [adminId, id, JSON.stringify(req.body)]);

    console.log(`✅ Collaborateur ${id} mis à jour par admin ${adminId}`);
    res.json({
      success: true,
      message: 'Collaborateur mis à jour avec succès'
    });

  } catch (error) {
    console.error('❌ Erreur mise à jour:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/admin/users/stats/overview - Vue d'ensemble collaborateurs
router.get('/stats/overview', verifyAdmin, async (req, res) => {
  try {
    const overview = await pool.query(`
      SELECT 
        COUNT(*) as total_collaborators,
        COUNT(*) FILTER (WHERE is_active = TRUE) as active_collaborators,
        COUNT(*) FILTER (WHERE suspended = TRUE) as suspended_collaborators,
        COUNT(*) FILTER (WHERE status = 'deleted') as deleted_collaborators,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') as new_this_month,
        AVG(total_signatures) as avg_signatures_per_user,
        MAX(total_signatures) as max_signatures,
        SUM(total_signatures) as total_signatures_all
      FROM collaborator_stats
    `);

    const topPerformers = await pool.query(`
      SELECT first_name, last_name, total_signatures, signature_ranking
      FROM collaborator_stats 
      WHERE total_signatures > 0
      ORDER BY total_signatures DESC
      LIMIT 5
    `);

    res.json({
      overview: overview.rows[0],
      topPerformers: topPerformers.rows
    });

  } catch (error) {
    console.error('❌ Erreur stats overview:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
