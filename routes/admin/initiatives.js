const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const pool = require('../../config/database');
const { verifyAdmin } = require('../../middleware/adminAuth');

// Configuration Multer pour upload images initiatives
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const uploadsDir = 'public/uploads/initiatives/';
        try {
            await fs.mkdir(uploadsDir, { recursive: true });
            cb(null, uploadsDir);
        } catch (error) {
            cb(error);
        }
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        cb(null, `initiative-${uniqueSuffix}${extension}`);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Seules les images (JPG, PNG, WEBP) sont autorisées'));
        }
    }
});

// GET /api/admin/initiatives - Liste toutes initiatives avec images
router.get('/', verifyAdmin, async (req, res) => {
    try {
        console.log('🎯 Récupération initiatives admin...');

        const initiatives = await pool.query(`
            SELECT 
                i.*,
                COALESCE(SUM(s.signatures), 0) as signatures_collected_real,
                COUNT(s.id) as scans_count_real,
                COUNT(DISTINCT COALESCE(s.collaborator_id, s.user_id)) as collaborators_count_real,
                ARRAY_AGG(
                    CASE WHEN ii.image_path IS NOT NULL 
                    THEN json_build_object(
                        'id', ii.id,
                        'path', ii.image_path,
                        'type', ii.image_type,
                        'description', ii.description,
                        'is_primary', ii.is_primary,
                        'uploaded_at', ii.created_at
                    ) END
                ) FILTER (WHERE ii.image_path IS NOT NULL) as images
            FROM initiatives i
            LEFT JOIN scans s ON (
                i.name = s.initiative 
                OR LOWER(i.name) = LOWER(s.initiative)
                OR i.id::text = s.initiative
            )
            LEFT JOIN initiative_images ii ON i.id = ii.initiative_id
            WHERE (i.status != 'deleted' OR i.status IS NULL)
            GROUP BY i.id
            ORDER BY i.display_order ASC, i.total_signatures DESC, i.name ASC
        `);

        const formattedInitiatives = initiatives.rows.map(init => ({
            id: init.id,
            name: init.name || 'Initiative sans nom',
            description: init.description || '',
            status: init.status || 'active',
            target: parseInt(init.target_signatures) || 0,
            collected: parseInt(init.signatures_collected_real) || 0,
            progress: init.target_signatures > 0 ?
                Math.min(Math.round((parseInt(init.signatures_collected_real) || 0) / init.target_signatures * 100), 100) : 0,
            deadline: init.deadline,
            isActive: init.is_active !== false,
            displayOrder: parseInt(init.display_order) || 0,
            gptInstructions: init.gpt_instructions || '',
            themeColor: init.theme_color || '#4ECDC4',
            
            // Stats réelles recalculées
            scanCount: parseInt(init.scans_count_real) || 0,
            collaboratorsCount: parseInt(init.collaborators_count_real) || 0,
            
            // Images
            images: init.images || [],
            primaryImage: (init.images || []).find(img => img.is_primary) || null,
            
            createdAt: init.created_at,
            updatedAt: init.updated_at
        }));

        console.log(`✅ ${formattedInitiatives.length} initiatives récupérées`);
        res.json({ initiatives: formattedInitiatives });

    } catch (error) {
        console.error('❌ Erreur récupération initiatives:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// GET /api/admin/initiatives/:id - Détails initiative spécifique
router.get('/:id', verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        const initiative = await pool.query(`
            SELECT 
                i.*,
                ARRAY_AGG(
                    CASE WHEN ii.image_path IS NOT NULL 
                    THEN json_build_object(
                        'id', ii.id,
                        'path', ii.image_path,
                        'type', ii.image_type,
                        'description', ii.description,
                        'is_primary', ii.is_primary,
                        'uploaded_at', ii.created_at
                    ) END
                ) FILTER (WHERE ii.image_path IS NOT NULL) as images
            FROM initiatives i
            LEFT JOIN initiative_images ii ON i.id = ii.initiative_id
            WHERE i.id = $1
            GROUP BY i.id
        `, [id]);

        if (initiative.rows.length === 0) {
            return res.status(404).json({ error: 'Initiative non trouvée' });
        }

        // Stats détaillées pour cette initiative
        const stats = await pool.query(`
            SELECT 
                COUNT(s.id) as total_scans,
                SUM(s.signatures) as total_signatures,
                AVG(s.quality) as avg_quality,
                AVG(s.confidence) as avg_confidence,
                COUNT(DISTINCT COALESCE(s.collaborator_id, s.user_id)) as unique_collaborators,
                MIN(s.created_at) as first_scan,
                MAX(s.created_at) as last_scan
            FROM scans s
            WHERE s.initiative = $1 OR LOWER(s.initiative) = LOWER($1)
        `, [initiative.rows[0].name]);

        const initiativeDetails = {
            ...initiative.rows[0],
            images: initiative.rows[0].images || [],
            stats: stats.rows[0] || {
                total_scans: 0,
                total_signatures: 0,
                avg_quality: 0,
                avg_confidence: 0,
                unique_collaborators: 0,
                first_scan: null,
                last_scan: null
            }
        };

        res.json({ initiative: initiativeDetails });

    } catch (error) {
        console.error('❌ Erreur détails initiative:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// POST /api/admin/initiatives - Créer nouvelle initiative
router.post('/', verifyAdmin, async (req, res) => {
    try {
        const {
            name,
            description,
            deadline,
            target_signatures,
            gpt_instructions,
            theme_color,
            display_order
        } = req.body;
        const adminId = req.admin.id;

        console.log(`➕ Création nouvelle initiative: ${name}`);

        if (!name || name.trim() === '') {
            return res.status(400).json({ error: 'Nom de l\'initiative requis' });
        }

        // Vérifier si le nom existe déjà
        const existing = await pool.query(
            'SELECT id FROM initiatives WHERE LOWER(name) = LOWER($1)',
            [name.trim()]
        );

        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Une initiative avec ce nom existe déjà' });
        }

        const result = await pool.query(`
            INSERT INTO initiatives (
                name, description, deadline, target_signatures, 
                gpt_instructions, theme_color, display_order,
                status, is_active, created_by, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', TRUE, $8, NOW(), NOW())
            RETURNING *
        `, [
            name.trim(),
            description || '',
            deadline || null,
            parseInt(target_signatures) || 1000,
            gpt_instructions || '',
            theme_color || '#4ECDC4',
            parseInt(display_order) || 0,
            adminId
        ]);

        // Log action admin
        await pool.query(`
            INSERT INTO admin_logs (admin_id, action, target_type, target_id, details)
            VALUES ($1, 'create_initiative', 'initiative', $2, $3)
        `, [adminId, result.rows[0].id, JSON.stringify(req.body)]);

        console.log(`✅ Initiative créée: ${result.rows[0].name} (ID: ${result.rows[0].id})`);
        res.json({
            success: true,
            initiative: result.rows[0],
            message: 'Initiative créée avec succès'
        });

    } catch (error) {
        console.error('❌ Erreur création initiative:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// PATCH /api/admin/initiatives/:id - Modifier initiative
router.patch('/:id', verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const {
            name,
            description,
            deadline,
            target_signatures,
            gpt_instructions,
            theme_color,
            display_order
        } = req.body;
        const adminId = req.admin.id;

        console.log(`📝 Modification initiative ID: ${id}`);

        const updates = [];
        const values = [];
        let paramCount = 0;

        if (name !== undefined) {
            paramCount++;
            updates.push(`name = $${paramCount}`);
            values.push(name.trim());
        }
        if (description !== undefined) {
            paramCount++;
            updates.push(`description = $${paramCount}`);
            values.push(description);
        }
        if (deadline !== undefined) {
            paramCount++;
            updates.push(`deadline = $${paramCount}`);
            values.push(deadline);
        }
        if (target_signatures !== undefined) {
            paramCount++;
            updates.push(`target_signatures = $${paramCount}`);
            values.push(parseInt(target_signatures));
        }
        if (gpt_instructions !== undefined) {
            paramCount++;
            updates.push(`gpt_instructions = $${paramCount}`);
            values.push(gpt_instructions);
        }
        if (theme_color !== undefined) {
            paramCount++;
            updates.push(`theme_color = $${paramCount}`);
            values.push(theme_color);
        }
        if (display_order !== undefined) {
            paramCount++;
            updates.push(`display_order = $${paramCount}`);
            values.push(parseInt(display_order));
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'Aucune donnée à mettre à jour' });
        }

        // Ajouter updated_at
        paramCount++;
        updates.push(`updated_at = $${paramCount}`);
        values.push(new Date());

        paramCount++;
        values.push(id);

        const result = await pool.query(`
            UPDATE initiatives 
            SET ${updates.join(', ')}
            WHERE id = $${paramCount}
            RETURNING *
        `, values);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Initiative non trouvée' });
        }

        // Log action admin
        await pool.query(`
            INSERT INTO admin_logs (admin_id, action, target_type, target_id, details)
            VALUES ($1, 'update_initiative', 'initiative', $2, $3)
        `, [adminId, id, JSON.stringify(req.body)]);

        console.log(`✅ Initiative ${id} modifiée par admin ${adminId}`);
        res.json({
            success: true,
            initiative: result.rows[0],
            message: 'Initiative modifiée avec succès'
        });

    } catch (error) {
        console.error('❌ Erreur modification initiative:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// PATCH /api/admin/initiatives/:id/toggle - Activer/Désactiver initiative
router.patch('/:id/toggle', verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const adminId = req.admin.id;

        const result = await pool.query(`
            UPDATE initiatives 
            SET 
                is_active = NOT COALESCE(is_active, TRUE),
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Initiative non trouvée' });
        }

        const newStatus = result.rows[0].is_active ? 'activée' : 'désactivée';
        
        // Log action admin
        await pool.query(`
            INSERT INTO admin_logs (admin_id, action, target_type, target_id, details)
            VALUES ($1, 'toggle_initiative', 'initiative', $2, $3)
        `, [adminId, id, JSON.stringify({ is_active: result.rows[0].is_active })]);

        console.log(`✅ Initiative ${id} ${newStatus} par admin ${adminId}`);
        res.json({
            success: true,
            initiative: result.rows[0],
            message: `Initiative ${newStatus} avec succès`
        });

    } catch (error) {
        console.error('❌ Erreur toggle initiative:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// POST /api/admin/initiatives/:id/images - Upload images pour initiative
router.post('/:id/images', verifyAdmin, upload.array('images', 5), async (req, res) => {
    try {
        const { id } = req.params;
        const { descriptions } = req.body;
        const adminId = req.admin.id;
        
        console.log(`📷 Upload images pour initiative ${id}`);

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'Aucune image fournie' });
        }

        // Vérifier que l'initiative existe
        const initiativeCheck = await pool.query(
            'SELECT id, name FROM initiatives WHERE id = $1',
            [id]
        );

        if (initiativeCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Initiative non trouvée' });
        }

        const insertedImages = [];
        
        for (let i = 0; i < req.files.length; i++) {
            const file = req.files[i];
            const description = descriptions && descriptions[i] ? descriptions[i] : '';
            
            // Définir la première image comme primaire si aucune image primaire n'existe
            const primaryCheck = await pool.query(
                'SELECT COUNT(*) as count FROM initiative_images WHERE initiative_id = $1 AND is_primary = TRUE',
                [id]
            );
            const isPrimary = primaryCheck.rows[0].count === 0 && i === 0;

            const result = await pool.query(`
                INSERT INTO initiative_images (
                    initiative_id, image_path, description, is_primary, uploaded_by, created_at
                ) VALUES ($1, $2, $3, $4, $5, NOW())
                RETURNING *
            `, [
                id,
                `/uploads/initiatives/${file.filename}`,
                description,
                isPrimary,
                adminId
            ]);

            insertedImages.push(result.rows[0]);
        }

        // Log action admin
        await pool.query(`
            INSERT INTO admin_logs (admin_id, action, target_type, target_id, details)
            VALUES ($1, 'upload_initiative_images', 'initiative', $2, $3)
        `, [adminId, id, JSON.stringify({
            images_count: req.files.length,
            filenames: req.files.map(f => f.filename)
        })]);

        console.log(`✅ ${insertedImages.length} images uploadées pour initiative ${id}`);
        res.json({
            success: true,
            images: insertedImages,
            message: `${insertedImages.length} image(s) uploadée(s) avec succès`
        });

    } catch (error) {
        console.error('❌ Erreur upload images:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// DELETE /api/admin/initiatives/:id/images/:imageId - Supprimer image
router.delete('/:id/images/:imageId', verifyAdmin, async (req, res) => {
    try {
        const { id, imageId } = req.params;
        const adminId = req.admin.id;

        // Récupérer info image avant suppression
        const imageInfo = await pool.query(
            'SELECT * FROM initiative_images WHERE id = $1 AND initiative_id = $2',
            [imageId, id]
        );

        if (imageInfo.rows.length === 0) {
            return res.status(404).json({ error: 'Image non trouvée' });
        }

        // Supprimer de la database
        await pool.query(
            'DELETE FROM initiative_images WHERE id = $1',
            [imageId]
        );

        // Supprimer fichier physique
        try {
            const filePath = path.join('public', imageInfo.rows[0].image_path);
            await fs.unlink(filePath);
        } catch (fileError) {
            console.warn('⚠️ Impossible de supprimer le fichier:', fileError.message);
        }

        // Log action admin
        await pool.query(`
            INSERT INTO admin_logs (admin_id, action, target_type, target_id, details)
            VALUES ($1, 'delete_initiative_image', 'initiative', $2, $3)
        `, [adminId, id, JSON.stringify({
            deleted_image: imageInfo.rows[0]
        })]);

        console.log(`✅ Image ${imageId} supprimée de l'initiative ${id}`);
        res.json({
            success: true,
            message: 'Image supprimée avec succès'
        });

    } catch (error) {
        console.error('❌ Erreur suppression image:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// PATCH /api/admin/initiatives/:id/images/:imageId/primary - Définir image primaire
router.patch('/:id/images/:imageId/primary', verifyAdmin, async (req, res) => {
    try {
        const { id, imageId } = req.params;
        const adminId = req.admin.id;

        // Retirer le statut primaire de toutes les images de cette initiative
        await pool.query(
            'UPDATE initiative_images SET is_primary = FALSE WHERE initiative_id = $1',
            [id]
        );

        // Définir la nouvelle image primaire
        const result = await pool.query(
            'UPDATE initiative_images SET is_primary = TRUE WHERE id = $1 AND initiative_id = $2 RETURNING *',
            [imageId, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Image non trouvée' });
        }

        // Log action admin
        await pool.query(`
            INSERT INTO admin_logs (admin_id, action, target_type, target_id, details)
            VALUES ($1, 'set_primary_image', 'initiative', $2, $3)
        `, [adminId, id, JSON.stringify({ image_id: imageId })]);

        console.log(`✅ Image ${imageId} définie comme primaire pour initiative ${id}`);
        res.json({
            success: true,
            image: result.rows[0],
            message: 'Image primaire définie avec succès'
        });

    } catch (error) {
        console.error('❌ Erreur image primaire:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

module.exports = router;
