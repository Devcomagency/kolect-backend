const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { verifyAdmin } = require('../../middleware/adminAuth');

// GET /api/admin/verifications/pending - Scans douteux à vérifier
router.get('/pending', verifyAdmin, async (req, res) => {
    try {
        const { limit = 50, offset = 0, doubt_reason } = req.query;
        
        console.log('🔍 Récupération scans douteux...');

        let whereClause = 'WHERE (sv.verification_status IS NULL OR sv.verification_status = \'pending\')';
        const queryParams = [parseInt(limit), parseInt(offset)];
        let paramCount = 2;

        if (doubt_reason && doubt_reason !== 'all') {
            paramCount++;
            whereClause += ` AND ds.doubt_reason = $${paramCount}`;
            queryParams.push(doubt_reason);
        }

        const scans = await pool.query(`
            SELECT 
                ds.*,
                ds.doubt_reason,
                ds.doubt_description,
                COALESCE(ds.first_name || ' ' || ds.last_name, ds.collaborator_email, 'Collaborateur #' || ds.collaborator_id) as collaborator_name,
                sv.id as verification_id,
                sv.verification_status,
                sv.verified_signatures,
                sv.verified_initiative,
                sv.admin_notes,
                sv.verified_at,
                admin_users.name as verified_by_name
            FROM doubtful_scans ds
            LEFT JOIN scan_verifications sv ON ds.id = sv.scan_id
            LEFT JOIN admin_users ON sv.admin_id = admin_users.id
            ${whereClause}
            ORDER BY ds.created_at DESC
            LIMIT $1 OFFSET $2
        `, queryParams);

        // Compter le total pour pagination
        const countResult = await pool.query(`
            SELECT COUNT(*) as total
            FROM doubtful_scans ds
            LEFT JOIN scan_verifications sv ON ds.id = sv.scan_id
            ${whereClause.replace(/\$\d+/g, (match) => {
                const num = parseInt(match.slice(1));
                return num <= 2 ? match : `$${num - 2}`;
            })}
        `, queryParams.slice(2)); // Enlever limit et offset pour le count

        const formattedScans = scans.rows.map(scan => ({
            id: scan.id,
            collaboratorId: scan.collaborator_id,
            collaboratorName: scan.collaborator_name,
            collaboratorEmail: scan.collaborator_email,
            initiative: scan.initiative,
            signatures: scan.signatures,
            quality: Math.round(scan.quality || 0),
            confidence: Math.round(scan.confidence || 0),
            createdAt: scan.created_at,
            
            // Informations sur le doute
            doubtReason: scan.doubt_reason,
            doubtDescription: scan.doubt_description,
            
            // Informations de vérification
            verificationId: scan.verification_id,
            verificationStatus: scan.verification_status || 'pending',
            verifiedSignatures: scan.verified_signatures,
            verifiedInitiative: scan.verified_initiative,
            adminNotes: scan.admin_notes,
            verifiedAt: scan.verified_at,
            verifiedByName: scan.verified_by_name,
            
            // URLs des photos si disponibles
            photoPaths: scan.photo_paths ? JSON.parse(scan.photo_paths) : [],
            analysisData: scan.analysis_data ? JSON.parse(scan.analysis_data) : null
        }));

        console.log(`✅ ${formattedScans.length} scans douteux récupérés`);
        res.json({
            scans: formattedScans,
            total: parseInt(countResult.rows[0].total),
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

    } catch (error) {
        console.error('❌ Erreur scans pending:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// POST /api/admin/verifications/:scanId/verify - Vérifier un scan
router.post('/:scanId/verify', verifyAdmin, async (req, res) => {
    try {
        const { scanId } = req.params;
        const {
            verified_signatures,
            verified_initiative,
            verification_status, // 'approved', 'rejected'
            admin_notes
        } = req.body;
        const adminId = req.admin.id;

        console.log(`✅ Vérification scan ${scanId} par admin ${adminId}`);

        // Validation des données
        if (!verification_status || !['approved', 'rejected'].includes(verification_status)) {
            return res.status(400).json({
                error: 'Status de vérification requis (approved/rejected)'
            });
        }

        if (verification_status === 'approved') {
            if (verified_signatures === undefined || verified_signatures === null) {
                return res.status(400).json({
                    error: 'Nombre de signatures vérifié requis pour approbation'
                });
            }
            if (!verified_initiative || verified_initiative.trim() === '') {
                return res.status(400).json({
                    error: 'Initiative vérifiée requise pour approbation'
                });
            }
        }

        // Récupérer les données originales du scan
        const originalScan = await pool.query(
            'SELECT * FROM scans WHERE id = $1',
            [scanId]
        );

        if (originalScan.rows.length === 0) {
            return res.status(404).json({ error: 'Scan non trouvé' });
        }

        const original = originalScan.rows[0];

        // Upsert verification (insert ou update si existe déjà)
        await pool.query(`
            INSERT INTO scan_verifications (
                scan_id, admin_id, verified_signatures, verified_initiative,
                verification_status, admin_notes, verified_at,
                original_signatures, original_initiative, doubt_reason
            ) 
            VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, 
                (SELECT doubt_reason FROM doubtful_scans WHERE id = $1 LIMIT 1)
            )
            ON CONFLICT (scan_id) 
            DO UPDATE SET
                verified_signatures = $3,
                verified_initiative = $4,
                verification_status = $5,
                admin_notes = $6,
                verified_at = NOW(),
                admin_id = $2
        `, [
            scanId,
            adminId,
            verified_signatures,
            verified_initiative,
            verification_status,
            admin_notes || '',
            original.signatures,
            original.initiative
        ]);

        // Si approuvé, mettre à jour le scan original avec les données vérifiées
        if (verification_status === 'approved') {
            await pool.query(`
                UPDATE scans 
                SET 
                    signatures = $1,
                    initiative = $2,
                    verified = TRUE,
                    verified_at = NOW(),
                    verified_by = $3
                WHERE id = $4
            `, [verified_signatures, verified_initiative, adminId, scanId]);

            console.log(`✅ Scan ${scanId} approuvé et mis à jour`);
        } else {
            // Si rejeté, marquer comme vérifié mais ne pas modifier les données
            await pool.query(`
                UPDATE scans 
                SET 
                    verified = TRUE,
                    verified_at = NOW(),
                    verified_by = $1
                WHERE id = $2
            `, [adminId, scanId]);

            console.log(`❌ Scan ${scanId} rejeté`);
        }

        // Log action admin
        await pool.query(`
            INSERT INTO admin_logs (admin_id, action, target_type, target_id, details)
            VALUES ($1, 'verify_scan', 'scan', $2, $3)
        `, [adminId, scanId, JSON.stringify({
            verification_status,
            verified_signatures,
            verified_initiative,
            admin_notes,
            original_signatures: original.signatures,
            original_initiative: original.initiative
        })]);

        res.json({
            success: true,
            message: verification_status === 'approved'
                ? 'Scan approuvé et mis à jour'
                : 'Scan rejeté'
        });

    } catch (error) {
        console.error('❌ Erreur vérification scan:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// GET /api/admin/verifications/stats - Statistiques des vérifications
router.get('/stats', verifyAdmin, async (req, res) => {
    try {
        console.log('📊 Récupération stats vérifications...');

        const stats = await pool.query(`
            SELECT 
                COUNT(*) FILTER (WHERE sv.verification_status = 'pending' OR sv.verification_status IS NULL) as pending,
                COUNT(*) FILTER (WHERE sv.verification_status = 'approved') as approved,
                COUNT(*) FILTER (WHERE sv.verification_status = 'rejected') as rejected,
                COUNT(*) as total_doubtful,
                
                -- Stats par type de doute
                COUNT(*) FILTER (WHERE ds.doubt_reason = 'low_confidence') as low_confidence,
                COUNT(*) FILTER (WHERE ds.doubt_reason = 'too_many_signatures') as too_many_signatures,
                COUNT(*) FILTER (WHERE ds.doubt_reason = 'poor_quality') as poor_quality,
                COUNT(*) FILTER (WHERE ds.doubt_reason = 'too_few_signatures') as too_few_signatures,
                COUNT(*) FILTER (WHERE ds.doubt_reason = 'null_signatures') as null_signatures,
                
                -- Stats aujourd'hui
                COUNT(*) FILTER (WHERE DATE(ds.created_at) = CURRENT_DATE) as doubtful_today,
                COUNT(*) FILTER (WHERE DATE(sv.verified_at) = CURRENT_DATE) as verified_today
                
            FROM doubtful_scans ds
            LEFT JOIN scan_verifications sv ON ds.id = sv.scan_id
        `);

        // Top admins vérificateurs
        const topVerifiers = await pool.query(`
            SELECT 
                au.name,
                au.email,
                COUNT(sv.id) as verifications_count,
                COUNT(sv.id) FILTER (WHERE sv.verification_status = 'approved') as approved_count,
                COUNT(sv.id) FILTER (WHERE sv.verification_status = 'rejected') as rejected_count
            FROM admin_users au
            JOIN scan_verifications sv ON au.id = sv.admin_id
            WHERE sv.verified_at >= CURRENT_DATE - INTERVAL '30 days'
            GROUP BY au.id, au.name, au.email
            ORDER BY verifications_count DESC
            LIMIT 10
        `);

        // Évolution des vérifications sur 7 derniers jours
        const evolution = await pool.query(`
            SELECT 
                DATE(sv.verified_at) as date,
                COUNT(*) FILTER (WHERE sv.verification_status = 'approved') as approved,
                COUNT(*) FILTER (WHERE sv.verification_status = 'rejected') as rejected
            FROM scan_verifications sv
            WHERE sv.verified_at >= CURRENT_DATE - INTERVAL '7 days'
            GROUP BY DATE(sv.verified_at)
            ORDER BY date ASC
        `);

        const formattedStats = {
            overview: stats.rows[0],
            topVerifiers: topVerifiers.rows,
            evolution: evolution.rows.map(row => ({
                date: row.date,
                approved: parseInt(row.approved) || 0,
                rejected: parseInt(row.rejected) || 0,
                total: (parseInt(row.approved) || 0) + (parseInt(row.rejected) || 0)
            }))
        };

        console.log('✅ Stats vérifications récupérées');
        res.json(formattedStats);

    } catch (error) {
        console.error('❌ Erreur stats vérifications:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// GET /api/admin/verifications/history - Historique des vérifications
router.get('/history', verifyAdmin, async (req, res) => {
    try {
        const { limit = 50, offset = 0, status } = req.query;

        let whereClause = 'WHERE sv.verification_status IS NOT NULL';
        const queryParams = [parseInt(limit), parseInt(offset)];
        let paramCount = 2;

        if (status && ['approved', 'rejected'].includes(status)) {
            paramCount++;
            whereClause += ` AND sv.verification_status = $${paramCount}`;
            queryParams.push(status);
        }

        const history = await pool.query(`
            SELECT 
                sv.*,
                s.collaborator_id,
                s.initiative as original_initiative,
                s.signatures as original_signatures,
                s.quality,
                s.confidence,
                s.created_at as scan_created_at,
                COALESCE(c.first_name || ' ' || c.last_name, c.email, 'Collaborateur #' || s.collaborator_id) as collaborator_name,
                au.name as admin_name,
                au.email as admin_email
            FROM scan_verifications sv
            JOIN scans s ON sv.scan_id = s.id
            LEFT JOIN collaborators c ON s.collaborator_id = c.id OR s.user_id = c.id
            JOIN admin_users au ON sv.admin_id = au.id
            ${whereClause}
            ORDER BY sv.verified_at DESC
            LIMIT $1 OFFSET $2
        `, queryParams);

        const countResult = await pool.query(`
            SELECT COUNT(*) as total
            FROM scan_verifications sv
            ${whereClause.replace(/\$\d+/g, (match) => {
                const num = parseInt(match.slice(1));
                return num <= 2 ? match : `$${num - 2}`;
            })}
        `, queryParams.slice(2));

        const formattedHistory = history.rows.map(item => ({
            id: item.id,
            scanId: item.scan_id,
            collaboratorName: item.collaborator_name,
            
            // Données originales
            originalSignatures: item.original_signatures,
            originalInitiative: item.original_initiative,
            quality: Math.round(item.quality || 0),
            confidence: Math.round(item.confidence || 0),
            
            // Données vérifiées
            verifiedSignatures: item.verified_signatures,
            verifiedInitiative: item.verified_initiative,
            verificationStatus: item.verification_status,
            adminNotes: item.admin_notes,
            
            // Informations admin
            adminName: item.admin_name,
            adminEmail: item.admin_email,
            verifiedAt: item.verified_at,
            
            // Dates
            scanCreatedAt: item.scan_created_at,
            
            // Calcul différences
            signatureDifference: item.verified_signatures - item.original_signatures,
            initiativeChanged: item.verified_initiative !== item.original_initiative
        }));

        res.json({
            history: formattedHistory,
            total: parseInt(countResult.rows[0].total),
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

    } catch (error) {
        console.error('❌ Erreur historique vérifications:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// POST /api/admin/verifications/bulk-verify - Vérification en lot
router.post('/bulk-verify', verifyAdmin, async (req, res) => {
    try {
        const { scanIds, verification_status, admin_notes } = req.body;
        const adminId = req.admin.id;

        console.log(`📋 Vérification en lot de ${scanIds.length} scans`);

        if (!scanIds || scanIds.length === 0) {
            return res.status(400).json({ error: 'Liste de scans requise' });
        }

        if (!verification_status || !['approved', 'rejected'].includes(verification_status)) {
            return res.status(400).json({ error: 'Status invalide' });
        }

        let processed = 0;
        let errors = [];

        for (const scanId of scanIds) {
            try {
                // Pour une vérification en lot, on garde les valeurs originales si approuvé
                if (verification_status === 'approved') {
                    const original = await pool.query('SELECT * FROM scans WHERE id = $1', [scanId]);
                    if (original.rows.length > 0) {
                        await pool.query(`
                            INSERT INTO scan_verifications (
                                scan_id, admin_id, verified_signatures, verified_initiative,
                                verification_status, admin_notes, verified_at,
                                original_signatures, original_initiative
                            ) 
                            VALUES ($1, $2, $3, $4, $5, $6, NOW(), $3, $4)
                            ON CONFLICT (scan_id) 
                            DO UPDATE SET
                                verification_status = $5,
                                admin_notes = $6,
                                verified_at = NOW(),
                                admin_id = $2
                        `, [
                            scanId, adminId,
                            original.rows[0].signatures,
                            original.rows[0].initiative,
                            verification_status,
                            admin_notes || 'Vérification en lot'
                        ]);

                        await pool.query(`
                            UPDATE scans 
                            SET verified = TRUE, verified_at = NOW(), verified_by = $1
                            WHERE id = $2
                        `, [adminId, scanId]);
                    }
                } else {
                    // Rejeté en lot
                    await pool.query(`
                        INSERT INTO scan_verifications (
                            scan_id, admin_id, verification_status, admin_notes, verified_at
                        ) 
                        VALUES ($1, $2, $3, $4, NOW())
                        ON CONFLICT (scan_id) 
                        DO UPDATE SET
                            verification_status = $3,
                            admin_notes = $4,
                            verified_at = NOW(),
                            admin_id = $2
                    `, [scanId, adminId, verification_status, admin_notes || 'Rejet en lot']);

                    await pool.query(`
                        UPDATE scans 
                        SET verified = TRUE, verified_at = NOW(), verified_by = $1
                        WHERE id = $2
                    `, [adminId, scanId]);
                }

                processed++;
            } catch (error) {
                errors.push({ scanId, error: error.message });
            }
        }

        // Log action admin
        await pool.query(`
            INSERT INTO admin_logs (admin_id, action, target_type, target_id, details)
            VALUES ($1, 'bulk_verify_scans', 'scan', NULL, $2)
        `, [adminId, JSON.stringify({
            processed,
            total: scanIds.length,
            verification_status,
            errors: errors.length
        })]);

        console.log(`✅ Vérification en lot terminée: ${processed}/${scanIds.length} traités`);
        res.json({
            success: true,
            processed,
            total: scanIds.length,
            errors,
            message: `${processed} scan(s) traité(s) sur ${scanIds.length}`
        });

    } catch (error) {
        console.error('❌ Erreur vérification en lot:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

module.exports = router;
