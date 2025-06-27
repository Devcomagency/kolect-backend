// upgrade-initiatives.js - Amélioration SÉCURISÉE de la table initiatives
require('dotenv').config();
const { Pool } = require('pg');

async function safeUpgradeInitiatives() {
  console.log('\n🔧 === AMÉLIORATION SÉCURISÉE TABLE INITIATIVES ===\n');

  try {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });

    const client = await pool.connect();

    console.log('💾 BACKUP - Affichage données actuelles...');
    const backup = await client.query('SELECT * FROM initiatives ORDER BY id');
    backup.rows.forEach(init => {
      console.log(`   ${init.id}. ${init.name} - ${init.status} (créé: ${init.created_at?.toISOString().split('T')[0]})`);
    });

    console.log('\n🔧 AJOUT COLONNES POUR IMAGES RÉFÉRENCE (si pas existantes)...');

    // Ajouter colonne pour images de référence (SÉCURISÉ)
    await client.query(`
      ALTER TABLE initiatives 
      ADD COLUMN IF NOT EXISTS reference_images JSONB DEFAULT '[]'::jsonb;
    `);
    console.log('✅ Colonne reference_images ajoutée');

    // Ajouter colonne contexte GPT (SÉCURISÉ)
    await client.query(`
      ALTER TABLE initiatives 
      ADD COLUMN IF NOT EXISTS gpt_context TEXT;
    `);
    console.log('✅ Colonne gpt_context ajoutée');

    // Ajouter mots-clés (SÉCURISÉ)
    await client.query(`
      ALTER TABLE initiatives 
      ADD COLUMN IF NOT EXISTS keywords TEXT[];
    `);
    console.log('✅ Colonne keywords ajoutée');

    // Ajouter couleur theme (SÉCURISÉ)
    await client.query(`
      ALTER TABLE initiatives 
      ADD COLUMN IF NOT EXISTS theme_color VARCHAR(10) DEFAULT '#4ECDC4';
    `);
    console.log('✅ Colonne theme_color ajoutée');

    // Ajouter stats calculées (SÉCURISÉ)
    await client.query(`
      ALTER TABLE initiatives 
      ADD COLUMN IF NOT EXISTS total_signatures INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS total_scans INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS active_collaborators INTEGER DEFAULT 0;
    `);
    console.log('✅ Colonnes stats ajoutées');

    console.log('\n📊 CALCUL STATS POUR INITIATIVES EXISTANTES...');

    // Recalculer les stats pour chaque initiative existante
    const initiatives = await client.query('SELECT id, name FROM initiatives');
    
    for (const init of initiatives.rows) {
      const stats = await client.query(`
        SELECT 
          COUNT(*) as total_scans,
          SUM(COALESCE(total_signatures, signatures, 0)) as total_signatures,
          COUNT(DISTINCT COALESCE(collaborator_id, user_id)) as active_collaborators
        FROM scans 
        WHERE initiative = $1
      `, [init.name]);

      const { total_scans, total_signatures, active_collaborators } = stats.rows[0];

      await client.query(`
        UPDATE initiatives 
        SET 
          total_signatures = $1,
          total_scans = $2,
          active_collaborators = $3,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $4
      `, [
        parseInt(total_signatures) || 0,
        parseInt(total_scans) || 0,
        parseInt(active_collaborators) || 0,
        init.id
      ]);

      console.log(`   ${init.name}: ${total_signatures} signatures, ${total_scans} scans, ${active_collaborators} collaborateurs`);
    }

    console.log('\n✅ STRUCTURE FINALE:');
    const finalStructure = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'initiatives'
      ORDER BY ordinal_position;
    `);
    
    finalStructure.rows.forEach(col => {
      console.log(`   ${col.column_name}: ${col.data_type}`);
    });

    console.log('\n📋 DONNÉES PRÉSERVÉES:');
    const finalData = await client.query(`
      SELECT id, name, status, total_signatures, total_scans, active_collaborators 
      FROM initiatives 
      ORDER BY id
    `);
    
    finalData.rows.forEach(init => {
      console.log(`   ${init.id}. ${init.name} - ${init.total_signatures} signatures (${init.total_scans} scans)`);
    });

    client.release();
    await pool.end();

    console.log('\n🎉 UPGRADE TERMINÉ AVEC SUCCÈS !');
    console.log('✅ Toutes les données existantes préservées');
    console.log('✅ Nouvelles colonnes ajoutées');
    console.log('✅ Stats recalculées');

  } catch (error) {
    console.error('❌ Erreur upgrade:', error.message);
    console.error('💡 Les données existantes sont préservées');
  }
}

safeUpgradeInitiatives();
