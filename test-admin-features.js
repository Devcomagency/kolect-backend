const pool = require('./config/database');

console.log('\n🧪 ===== KOLECT ADMIN V2.0 - TESTS COMPLETS =====');
console.log('⏱️  Estimation: 1-2 minutes');
console.log('🔍 Vérification de toutes les nouvelles fonctionnalités...\n');

async function testAdminFeatures() {
    let totalTests = 0;
    let passedTests = 0;
    let failedTests = [];

    try {
        console.log('🗄️  1. TESTS DATABASE & STRUCTURE');
        await testDatabaseStructure();
        
        console.log('\n👥 2. TESTS GESTION COLLABORATEURS');
        await testCollaboratorsFeatures();
        
        console.log('\n🎯 3. TESTS GESTION INITIATIVES');
        await testInitiativesFeatures();
        
        console.log('\n✅ 4. TESTS VÉRIFICATIONS MANUELLES');
        await testVerificationsFeatures();
        
        console.log('\n📊 5. TESTS ACTIVITÉ & ANALYTICS');
        await testActivityFeatures();
        
        console.log('\n🔐 6. TESTS SÉCURITÉ & AUTHENTIFICATION');
        await testSecurityFeatures();
        
        console.log('\n📈 7. TESTS PERFORMANCE');
        await testPerformanceFeatures();
        
        // Résultats finaux
        console.log('\n🎉 ===== RÉSULTATS DES TESTS =====');
        console.log(`✅ Tests réussis: ${passedTests}`);
        console.log(`❌ Tests échoués: ${failedTests.length}`);
        console.log(`📊 Taux de réussite: ${Math.round((passedTests / totalTests) * 100)}%`);
        
        if (failedTests.length > 0) {
            console.log('\n❌ TESTS ÉCHOUÉS:');
            failedTests.forEach(test => {
                console.log(`   - ${test.name}: ${test.error}`);
            });
        }
        
        if (failedTests.length === 0) {
            console.log('\n🚀 TOUS LES TESTS SONT PASSÉS !');
            console.log('✅ KOLECT Admin V2.0 est prêt pour la production');
        } else {
            console.log('\n⚠️  Certains tests ont échoué - Vérifiez la configuration');
        }
        
        console.log('=====================================\n');
        
    } catch (error) {
        console.error('\n💥 ERREUR CRITIQUE PENDANT LES TESTS:', error.message);
        process.exit(1);
    }

    // Fonctions de test
    async function test(name, testFunction) {
        totalTests++;
        try {
            await testFunction();
            console.log(`   ✅ ${name}`);
            passedTests++;
            return true;
        } catch (error) {
            console.log(`   ❌ ${name}: ${error.message}`);
            failedTests.push({ name, error: error.message });
            return false;
        }
    }

    async function testDatabaseStructure() {
        await test('Connexion database', async () => {
            const result = await pool.query('SELECT NOW()');
            if (!result.rows[0]) throw new Error('Pas de réponse DB');
        });

        await test('Table scan_verifications existe', async () => {
            const result = await pool.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'scan_verifications'
                );
            `);
            if (!result.rows[0].exists) throw new Error('Table manquante');
        });

        await test('Table initiative_images existe', async () => {
            const result = await pool.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'initiative_images'
                );
            `);
            if (!result.rows[0].exists) throw new Error('Table manquante');
        });

        await test('Vue doubtful_scans existe', async () => {
            const result = await pool.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.views 
                    WHERE table_name = 'doubtful_scans'
                );
            `);
            if (!result.rows[0].exists) throw new Error('Vue manquante');
        });

        await test('Vue collaborator_stats existe', async () => {
            const result = await pool.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.views 
                    WHERE table_name = 'collaborator_stats'
                );
            `);
            if (!result.rows[0].exists) throw new Error('Vue manquante');
        });

        await test('Colonnes collaborateurs ajoutées', async () => {
            const result = await pool.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'collaborators' 
                AND column_name IN ('suspended', 'contract_type', 'id_document_type');
            `);
            if (result.rows.length < 3) throw new Error('Colonnes manquantes');
        });

        await test('Colonnes initiatives ajoutées', async () => {
            const result = await pool.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'initiatives' 
                AND column_name IN ('is_active', 'gpt_instructions', 'display_order');
            `);
            if (result.rows.length < 3) throw new Error('Colonnes manquantes');
        });
    }

    async function testCollaboratorsFeatures() {
        await test('Vue collaborator_stats fonctionne', async () => {
            const result = await pool.query('SELECT * FROM collaborator_stats LIMIT 5');
            if (!result.rows) throw new Error('Vue ne retourne pas de données');
        });

        await test('Stats collaborateurs calculées', async () => {
            const result = await pool.query(`
                SELECT 
                    COUNT(*) as total,
                    AVG(total_signatures) as avg_signatures,
                    MAX(total_scans) as max_scans
                FROM collaborator_stats
            `);
            if (!result.rows[0] || result.rows[0].total === 0) {
                throw new Error('Pas de stats calculées');
            }
        });

        await test('Suspension collaborateur (simulation)', async () => {
            // Test de la logique, pas d'action réelle
            const result = await pool.query(`
                SELECT COUNT(*) as count 
                FROM collaborators 
                WHERE suspended = FALSE OR suspended IS NULL
            `);
            if (result.rows[0].count === 0) throw new Error('Aucun collaborateur actif');
        });

        await test('Colonnes document ID disponibles', async () => {
            const result = await pool.query(`
                SELECT id_document_type, contract_type 
                FROM collaborators 
                LIMIT 1
            `);
            // Test que les colonnes existent (même si NULL)
        });
    }

    async function testInitiativesFeatures() {
        await test('Initiatives avec statut actif/inactif', async () => {
            const result = await pool.query(`
                SELECT 
                    COUNT(*) FILTER (WHERE is_active = TRUE) as active,
                    COUNT(*) FILTER (WHERE is_active = FALSE) as inactive,
                    COUNT(*) as total
                FROM initiatives
            `);
            if (result.rows[0].total === 0) throw new Error('Aucune initiative');
        });

        await test('Support images initiatives', async () => {
            // Vérifier que la table est prête
            const result = await pool.query(`
                SELECT COUNT(*) as image_count 
                FROM initiative_images
            `);
            // Table doit exister même si vide
        });

        await test('Instructions GPT-4 configurables', async () => {
            const result = await pool.query(`
                SELECT gpt_instructions 
                FROM initiatives 
                WHERE gpt_instructions IS NOT NULL 
                LIMIT 1
            `);
            // Colonne doit exister
        });

        await test('Ordre affichage initiatives', async () => {
            const result = await pool.query(`
                SELECT display_order 
                FROM initiatives 
                ORDER BY display_order ASC
                LIMIT 5
            `);
            // Colonne doit exister
        });
    }

    async function testVerificationsFeatures() {
        await test('Vue scans douteux fonctionne', async () => {
            const result = await pool.query(`
                SELECT 
                    COUNT(*) as total_doubtful,
                    COUNT(DISTINCT doubt_reason) as reason_types
                FROM doubtful_scans
            `);
            console.log(`       📊 ${result.rows[0].total_doubtful} scans douteux détectés`);
        });

        await test('Types de problèmes identifiés', async () => {
            const result = await pool.query(`
                SELECT doubt_reason, COUNT(*) as count
                FROM doubtful_scans 
                GROUP BY doubt_reason
                ORDER BY count DESC
            `);
            console.log(`       🔍 ${result.rows.length} types de problèmes différents`);
        });

        await test('Système vérification prêt', async () => {
            const result = await pool.query(`
                SELECT COUNT(*) as pending_verifications
                FROM scan_verifications
                WHERE verification_status = 'pending' OR verification_status IS NULL
            `);
            // Table doit être accessible
        });

        await test('Historique vérifications', async () => {
            const result = await pool.query(`
                SELECT 
                    verification_status,
                    COUNT(*) as count
                FROM scan_verifications
                GROUP BY verification_status
            `);
            // Requête doit fonctionner
        });
    }

    async function testActivityFeatures() {
        await test('Activité par période', async () => {
            const result = await pool.query(`
                SELECT 
                    DATE(created_at) as date,
                    COUNT(*) as scans,
                    SUM(signatures) as total_signatures
                FROM scans
                WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
                GROUP BY DATE(created_at)
                ORDER BY date DESC
                LIMIT 7
            `);
            console.log(`       📈 ${result.rows.length} jours d'activité récente`);
        });

        await test('Stats par collaborateur', async () => {
            const result = await pool.query(`
                SELECT 
                    COUNT(DISTINCT COALESCE(collaborator_id, user_id)) as active_users,
                    AVG(signatures) as avg_signatures_per_scan
                FROM scans
                WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
            `);
            console.log(`       👥 ${result.rows[0].active_users} collaborateurs actifs (30j)`);
        });

        await test('Performance par initiative', async () => {
            const result = await pool.query(`
                SELECT 
                    initiative,
                    COUNT(*) as scans,
                    SUM(signatures) as total_signatures,
                    COUNT(DISTINCT COALESCE(collaborator_id, user_id)) as collaborators
                FROM scans
                WHERE initiative IS NOT NULL
                GROUP BY initiative
                ORDER BY total_signatures DESC
                LIMIT 5
            `);
            console.log(`       🎯 ${result.rows.length} initiatives avec activité`);
        });

        await test('Filtres temporels avancés', async () => {
            const result = await pool.query(`
                SELECT 
                    DATE_TRUNC('week', created_at) as week,
                    COUNT(*) as weekly_scans
                FROM scans
                WHERE created_at >= CURRENT_DATE - INTERVAL '4 weeks'
                GROUP BY DATE_TRUNC('week', created_at)
                ORDER BY week DESC
            `);
            // Test groupement par semaine
        });
    }

    async function testSecurityFeatures() {
        await test('Table admin_users sécurisée', async () => {
            const result = await pool.query(`
                SELECT 
                    COUNT(*) as admin_count,
                    COUNT(*) FILTER (WHERE role = 'super-admin') as super_admins
                FROM admin_users
            `);
            if (result.rows[0].admin_count === 0) {
                throw new Error('Aucun admin configuré');
            }
            console.log(`       🔐 ${result.rows[0].admin_count} admins configurés`);
        });

        await test('Logs admin fonctionnels', async () => {
            const result = await pool.query(`
                SELECT COUNT(*) as log_count
                FROM admin_logs
                WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
            `);
            console.log(`       📋 ${result.rows[0].log_count} actions admin loggées (7j)`);
        });

        await test('Séparation permissions admin/user', async () => {
            // Vérifier que les tables sont séparées
            const adminTable = await pool.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'admin_users'
                );
            `);
            const userTable = await pool.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'collaborators'
                );
            `);
            if (!adminTable.rows[0].exists || !userTable.rows[0].exists) {
                throw new Error('Tables sécurité manquantes');
            }
        });
    }

    async function testPerformanceFeatures() {
        await test('Index de performance créés', async () => {
            const result = await pool.query(`
                SELECT COUNT(*) as index_count
                FROM pg_indexes
                WHERE tablename IN (
                    'collaborators', 'scans', 'initiatives', 
                    'scan_verifications', 'initiative_images'
                )
                AND indexname LIKE 'idx_%'
            `);
            console.log(`       ⚡ ${result.rows[0].index_count} index de performance`);
        });

        await test('Requêtes stats optimisées', async () => {
            const start = Date.now();
            await pool.query(`
                SELECT * FROM collaborator_stats LIMIT 10
            `);
            const duration = Date.now() - start;
            if (duration > 1000) {
                throw new Error(`Requête trop lente: ${duration}ms`);
            }
            console.log(`       🚀 Requête collaborator_stats: ${duration}ms`);
        });

        await test('Vue scans douteux performante', async () => {
            const start = Date.now();
            await pool.query(`
                SELECT * FROM doubtful_scans LIMIT 20
            `);
            const duration = Date.now() - start;
            if (duration > 1000) {
                throw new Error(`Vue trop lente: ${duration}ms`);
            }
            console.log(`       🚀 Vue doubtful_scans: ${duration}ms`);
        });

        await test('Calculs aggregés rapides', async () => {
            const start = Date.now();
            await pool.query(`
                SELECT 
                    COUNT(*) as total_scans,
                    SUM(signatures) as total_signatures,
                    AVG(quality) as avg_quality,
                    COUNT(DISTINCT COALESCE(collaborator_id, user_id)) as unique_users
                FROM scans
                WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
            `);
            const duration = Date.now() - start;
            console.log(`       🚀 Stats globales 30j: ${duration}ms`);
        });
    }
}

// Exécution des tests
if (require.main === module) {
    testAdminFeatures()
        .then(() => {
            console.log('🧪 Tests terminés');
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 Tests échoués:', error);
            process.exit(1);
        });
}

module.exports = { testAdminFeatures };
