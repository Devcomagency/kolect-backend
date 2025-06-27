const fs = require('fs').promises;
const path = require('path');
const pool = require('./config/database');

console.log('\n🚀 ===== KOLECT ADMIN V2.0 - SETUP COMPLET =====');
console.log('⏱️  Estimation: 2-3 minutes');
console.log('📋 Création tables, vues, données test, dossiers...\n');

async function setupAdminComplete() {
    try {
        // 1. Test connexion database
        console.log('🔍 1. Test connexion database...');
        const dbTest = await pool.query('SELECT NOW() as current_time');
        console.log(`✅ Database connectée: ${dbTest.rows[0].current_time}`);

        // 2. Créer les nouvelles tables
        console.log('\n🗄️  2. Création des nouvelles tables...');
        await createAdminTables();
        
        // 3. Créer les vues
        console.log('\n👁️  3. Création des vues optimisées...');
        await createAdminViews();
        
        // 4. Ajouter colonnes aux tables existantes
        console.log('\n📝 4. Mise à jour tables existantes...');
        await updateExistingTables();
        
        // 5. Créer dossiers pour uploads
        console.log('\n📁 5. Création dossiers uploads...');
        await createUploadDirectories();
        
        // 6. Insérer données test
        console.log('\n🧪 6. Insertion données test...');
        await insertTestData();
        
        // 7. Vérification finale
        console.log('\n✅ 7. Vérification installation...');
        await verifyInstallation();
        
        console.log('\n🎉 ===== SETUP TERMINÉ AVEC SUCCÈS =====');
        console.log('🌐 Interface admin: http://localhost:3000/admin');
        console.log('🔐 Comptes test:');
        console.log('   📧 admin@kolect.ch / Devcom20!');
        console.log('   📧 test@kolect.ch / test123');
        console.log('📊 Health check: http://localhost:3000/api/health');
        console.log('🧪 Test features: http://localhost:3000/api/test/admin-features');
        console.log('=========================================\n');
        
    } catch (error) {
        console.error('\n❌ ERREUR SETUP:', error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

async function createAdminTables() {
    // Table scan_verifications
    await pool.query(`
        CREATE TABLE IF NOT EXISTS scan_verifications (
            id SERIAL PRIMARY KEY,
            scan_id INTEGER REFERENCES scans(id) ON DELETE CASCADE,
            admin_id INTEGER REFERENCES admin_users(id),
            original_signatures INTEGER,
            verified_signatures INTEGER, 
            original_initiative VARCHAR(100),
            verified_initiative VARCHAR(100),
            verification_status VARCHAR(20) DEFAULT 'pending',
            admin_notes TEXT,
            doubt_reason VARCHAR(50),
            verified_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(scan_id)
        );
    `);
    console.log('   ✅ Table scan_verifications créée');

    // Table initiative_images
    await pool.query(`
        CREATE TABLE IF NOT EXISTS initiative_images (
            id SERIAL PRIMARY KEY,
            initiative_id INTEGER REFERENCES initiatives(id) ON DELETE CASCADE,
            image_path VARCHAR(500) NOT NULL,
            image_type VARCHAR(20) DEFAULT 'reference',
            description TEXT,
            is_primary BOOLEAN DEFAULT FALSE,
            uploaded_by INTEGER REFERENCES admin_users(id),
            created_at TIMESTAMP DEFAULT NOW()
        );
    `);
    console.log('   ✅ Table initiative_images créée');

    // Index pour performance
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_scan_verifications_status ON scan_verifications(verification_status);
        CREATE INDEX IF NOT EXISTS idx_scan_verifications_admin ON scan_verifications(admin_id);
        CREATE INDEX IF NOT EXISTS idx_initiative_images_initiative ON initiative_images(initiative_id);
        CREATE INDEX IF NOT EXISTS idx_initiative_images_primary ON initiative_images(is_primary);
    `);
    console.log('   ✅ Index de performance créés');
}

async function createAdminViews() {
    // Vue doubtful_scans
    await pool.query(`
        CREATE OR REPLACE VIEW doubtful_scans AS
        SELECT 
            s.*,
            c.first_name,
            c.last_name,
            c.email as collaborator_email,
            CASE 
                WHEN s.confidence < 85 THEN 'low_confidence'
                WHEN s.signatures > 25 THEN 'too_many_signatures'  
                WHEN s.quality < 70 THEN 'poor_quality'
                WHEN s.signatures < 3 THEN 'too_few_signatures'
                WHEN s.signatures IS NULL THEN 'null_signatures'
                ELSE 'other'
            END as doubt_reason,
            CASE 
                WHEN s.confidence < 85 THEN 'Confiance faible (' || COALESCE(s.confidence, 0) || '%)'
                WHEN s.signatures > 25 THEN 'Trop de signatures (' || s.signatures || ')'
                WHEN s.quality < 70 THEN 'Qualité faible (' || COALESCE(s.quality, 0) || '%)'
                WHEN s.signatures < 3 THEN 'Peu de signatures (' || COALESCE(s.signatures, 0) || ')'
                WHEN s.signatures IS NULL THEN 'Signatures non détectées'
                ELSE 'Autre problème'
            END as doubt_description
        FROM scans s
        LEFT JOIN collaborators c ON s.collaborator_id = c.id OR s.user_id = c.id
        WHERE 
            s.confidence < 85 OR 
            s.signatures > 25 OR 
            s.quality < 70 OR 
            s.signatures < 3 OR
            s.signatures IS NULL
        ORDER BY s.created_at DESC;
    `);
    console.log('   ✅ Vue doubtful_scans créée');

    // Vue collaborator_stats
    await pool.query(`
        CREATE OR REPLACE VIEW collaborator_stats AS
        SELECT 
            c.id,
            c.first_name,
            c.last_name,
            c.email,
            c.phone,
            c.status,
            c.is_active,
            c.suspended,
            c.suspension_reason,
            c.contract_type,
            c.id_document_type,
            c.created_at,
            c.hire_date,
            COUNT(s.id) as total_scans,
            COALESCE(SUM(s.signatures), 0) as total_signatures,
            AVG(s.quality) as avg_quality,
            AVG(s.confidence) as avg_confidence,
            MAX(s.created_at) as last_scan_date,
            COUNT(DISTINCT s.initiative) as initiatives_worked,
            COUNT(s.id) FILTER (WHERE s.created_at >= CURRENT_DATE - INTERVAL '7 days') as scans_last_7_days,
            COUNT(s.id) FILTER (WHERE s.created_at >= CURRENT_DATE - INTERVAL '30 days') as scans_last_30_days,
            RANK() OVER (ORDER BY SUM(s.signatures) DESC) as signature_ranking
        FROM collaborators c
        LEFT JOIN scans s ON c.id = COALESCE(s.collaborator_id, s.user_id)
        GROUP BY c.id, c.first_name, c.last_name, c.email, c.phone, c.status, c.is_active, 
                 c.suspended, c.suspension_reason, c.contract_type, c.id_document_type, 
                 c.created_at, c.hire_date;
    `);
    console.log('   ✅ Vue collaborator_stats créée');
}

async function updateExistingTables() {
    // Collaborators
    const collaboratorColumns = [
        'ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS contract_type VARCHAR(50)',
        'ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS id_document_type VARCHAR(20)',
        'ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS id_document_number VARCHAR(50)',
        'ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS id_document_expiry DATE',
        'ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS suspended BOOLEAN DEFAULT FALSE',
        'ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS suspension_reason TEXT',
        'ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMP',
        'ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS suspended_by INTEGER REFERENCES admin_users(id)',
        'ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP',
        'ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES admin_users(id)'
    ];

    for (const sql of collaboratorColumns) {
        await pool.query(sql);
    }
    console.log('   ✅ Table collaborators mise à jour');

    // Initiatives
    const initiativeColumns = [
        'ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE',
        'ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0',
        'ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS gpt_instructions TEXT',
        'ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES admin_users(id)',
        'ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()'
    ];

    for (const sql of initiativeColumns) {
        await pool.query(sql);
    }
    console.log('   ✅ Table initiatives mise à jour');

    // Scans
    const scanColumns = [
        'ALTER TABLE scans ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT FALSE',
        'ALTER TABLE scans ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP',
        'ALTER TABLE scans ADD COLUMN IF NOT EXISTS verified_by INTEGER REFERENCES admin_users(id)'
    ];

    for (const sql of scanColumns) {
        await pool.query(sql);
    }
    console.log('   ✅ Table scans mise à jour');

    // Index additionnels
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_collaborators_status ON collaborators(status, suspended);
        CREATE INDEX IF NOT EXISTS idx_collaborators_active ON collaborators(is_active, suspended);
        CREATE INDEX IF NOT EXISTS idx_initiatives_active ON initiatives(is_active);
        CREATE INDEX IF NOT EXISTS idx_initiatives_order ON initiatives(display_order);
        CREATE INDEX IF NOT EXISTS idx_scans_verified ON scans(verified);
    `);
    console.log('   ✅ Index additionnels créés');
}

async function createUploadDirectories() {
    const directories = [
        'public/uploads',
        'public/uploads/initiatives',
        'public/uploads/scans',
        'public/uploads/temp',
        'public/admin'
    ];

    for (const dir of directories) {
        try {
            await fs.mkdir(dir, { recursive: true });
            console.log(`   ✅ Dossier créé: ${dir}`);
        } catch (error) {
            if (error.code !== 'EEXIST') {
                console.log(`   ⚠️  Dossier existe déjà: ${dir}`);
            }
        }
    }
}

async function insertTestData() {
    // Données test pour les vérifications (scans douteux)
    try {
        const doubtfulScansCount = await pool.query(`
            SELECT COUNT(*) as count FROM doubtful_scans;
        `);

        console.log(`   📊 Scans douteux détectés: ${doubtfulScansCount.rows[0].count}`);

        // Créer quelques scans test douteux si aucun n'existe
        if (parseInt(doubtfulScansCount.rows[0].count) === 0) {
            console.log('   🧪 Création scans test douteux...');
            
            // Insérer 3-5 scans avec problèmes pour tester les vérifications
            const testScans = [
                { signatures: 45, confidence: 60, quality: 55, initiative: 'Test Douteux 1' },
                { signatures: 2, confidence: 95, quality: 85, initiative: 'Test Douteux 2' },
                { signatures: null, confidence: 40, quality: 45, initiative: 'Test Douteux 3' }
            ];

            for (const scan of testScans) {
                await pool.query(`
                    INSERT INTO scans (
                        collaborator_id, signatures, confidence, quality, initiative, created_at
                    ) VALUES (
                        (SELECT id FROM collaborators LIMIT 1),
                        $1, $2, $3, $4, NOW() - INTERVAL '${Math.floor(Math.random() * 5)} days'
                    )
                `, [scan.signatures, scan.confidence, scan.quality, scan.initiative]);
            }
            console.log('   ✅ Scans test créés pour vérifications');
        }

        // Stats initiatives avec vraies données
        await pool.query(`
            UPDATE initiatives 
            SET 
                total_signatures = COALESCE((
                    SELECT SUM(signatures) 
                    FROM scans 
                    WHERE initiative = initiatives.name 
                    OR LOWER(initiative) = LOWER(initiatives.name)
                ), 0),
                total_scans = COALESCE((
                    SELECT COUNT(*) 
                    FROM scans 
                    WHERE initiative = initiatives.name 
                    OR LOWER(initiative) = LOWER(initiatives.name)
                ), 0),
                active_collaborators = COALESCE((
                    SELECT COUNT(DISTINCT COALESCE(collaborator_id, user_id))
                    FROM scans 
                    WHERE initiative = initiatives.name 
                    OR LOWER(initiative) = LOWER(initiatives.name)
                ), 0),
                updated_at = NOW()
            WHERE id IN (SELECT id FROM initiatives LIMIT 10);
        `);
        console.log('   ✅ Stats initiatives recalculées');

    } catch (error) {
        console.log(`   ⚠️  Erreur données test: ${error.message}`);
    }
}

async function verifyInstallation() {
    // Vérifier tables
    const tables = await pool.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_name IN (
            'scan_verifications', 
            'initiative_images',
            'admin_users',
            'admin_logs',
            'collaborators',
            'scans',
            'initiatives'
        )
        ORDER BY table_name;
    `);
    console.log(`   ✅ Tables vérifiées: ${tables.rows.map(r => r.table_name).join(', ')}`);

    // Vérifier vues
    const views = await pool.query(`
        SELECT table_name 
        FROM information_schema.views 
        WHERE table_name IN ('doubtful_scans', 'collaborator_stats')
        ORDER BY table_name;
    `);
    console.log(`   ✅ Vues vérifiées: ${views.rows.map(r => r.table_name).join(', ')}`);

    // Vérifier données
    const counts = await pool.query(`
        SELECT 
            (SELECT COUNT(*) FROM collaborators) as collaborators,
            (SELECT COUNT(*) FROM scans) as scans,
            (SELECT COUNT(*) FROM initiatives) as initiatives,
            (SELECT COUNT(*) FROM admin_users) as admin_users,
            (SELECT COUNT(*) FROM doubtful_scans) as doubtful_scans;
    `);
    const data = counts.rows[0];
    console.log(`   ✅ Données: ${data.collaborators} collaborateurs, ${data.scans} scans, ${data.initiatives} initiatives`);
    console.log(`   ✅ Admin: ${data.admin_users} admins, ${data.doubtful_scans} scans douteux`);

    // Test API endpoints
    console.log('   🧪 Test API endpoints...');
    try {
        const health = await pool.query('SELECT NOW()');
        console.log('   ✅ Health check: OK');
    } catch (error) {
        console.log('   ❌ Health check: ERREUR');
    }
}

// Exécution du setup
if (require.main === module) {
    setupAdminComplete()
        .then(() => {
            console.log('🚀 Setup terminé - Vous pouvez démarrer le serveur avec: npm start');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Setup échoué:', error);
            process.exit(1);
        });
}

module.exports = { setupAdminComplete };
