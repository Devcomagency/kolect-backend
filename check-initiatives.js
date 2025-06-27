// check-initiatives.js - Voir les initiatives et scans existants
require('dotenv').config();
const { Pool } = require('pg');

async function checkExistingInitiatives() {
  console.log('\n🎯 === INITIATIVES EXISTANTES ===\n');

  try {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });

    const client = await pool.connect();

    // 1. INITIATIVES DANS LA TABLE INITIATIVES
    console.log('📋 INITIATIVES DANS TABLE initiatives:');
    const initiatives = await client.query(`
      SELECT id, name, description, status, target_signatures, deadline, created_at
      FROM initiatives 
      ORDER BY created_at DESC
    `);
    
    initiatives.rows.forEach(init => {
      console.log(`   ${init.id}. ${init.name} (${init.status})`);
      console.log(`      Description: ${init.description || 'Aucune'}`);
      console.log(`      Objectif: ${init.target_signatures || 'Non défini'} signatures`);
      console.log(`      Deadline: ${init.deadline || 'Non définie'}`);
      console.log('');
    });

    // 2. INITIATIVES DANS LES SCANS (valeurs uniques)
    console.log('📊 INITIATIVES MENTIONNÉES DANS LES SCANS:');
    const scanInitiatives = await client.query(`
      SELECT 
        COALESCE(initiative, 'NULL') as initiative_name,
        COUNT(*) as scan_count,
        SUM(COALESCE(total_signatures, signatures, 0)) as total_signatures,
        MIN(created_at) as first_scan,
        MAX(created_at) as last_scan
      FROM scans 
      GROUP BY initiative
      ORDER BY scan_count DESC
    `);
    
    scanInitiatives.rows.forEach(init => {
      console.log(`   "${init.initiative_name}": ${init.scan_count} scans, ${init.total_signatures} signatures`);
      console.log(`      Premier scan: ${init.first_scan?.toISOString().split('T')[0] || 'N/A'}`);
      console.log(`      Dernier scan: ${init.last_scan?.toISOString().split('T')[0] || 'N/A'}`);
      console.log('');
    });

    // 3. CORRESPONDANCE entre table initiatives et scans
    console.log('🔗 CORRESPONDANCE TABLE initiatives <-> SCANS:');
    const matching = await client.query(`
      SELECT 
        i.name as initiative_name,
        i.status,
        COUNT(s.id) as matching_scans,
        SUM(COALESCE(s.total_signatures, s.signatures, 0)) as collected_signatures
      FROM initiatives i
      LEFT JOIN scans s ON s.initiative = i.name
      GROUP BY i.id, i.name, i.status
      ORDER BY matching_scans DESC
    `);
    
    matching.rows.forEach(match => {
      console.log(`   "${match.initiative_name}" (${match.status}): ${match.matching_scans} scans → ${match.collected_signatures} signatures`);
    });

    // 4. EXEMPLES DE SCANS RÉCENTS
    console.log('\n📸 DERNIERS SCANS:');
    const recentScans = await client.query(`
      SELECT 
        id,
        initiative,
        COALESCE(total_signatures, signatures, 0) as signatures,
        created_at
      FROM scans 
      ORDER BY created_at DESC 
      LIMIT 5
    `);
    
    recentScans.rows.forEach(scan => {
      console.log(`   Scan ${scan.id}: Initiative "${scan.initiative || 'NULL'}", ${scan.signatures} signatures, ${scan.created_at?.toISOString().split('T')[0]}`);
    });

    client.release();
    await pool.end();

    console.log('\n✅ ANALYSE TERMINÉE');
    console.log('\n🎯 PROCHAINES ÉTAPES SÉCURISÉES:');
    console.log('1. Améliorer table initiatives EXISTANTE (pas de DROP)');
    console.log('2. Ajouter colonnes pour images référence (ALTER ADD)');
    console.log('3. Corriger dashboard avec bonnes colonnes');
    console.log('4. Créer interface upload images initiatives');

  } catch (error) {
    console.error('❌ Erreur:', error.message);
  }
}

checkExistingInitiatives();
