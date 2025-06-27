// check-database.js - Diagnostic complet de la database
require('dotenv').config();
const { Pool } = require('pg');

async function checkExistingStructure() {
  console.log('\n🔍 === DIAGNOSTIC DATABASE KOLECT ===\n');

  try {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });

    const client = await pool.connect();

    // 1. LISTER TOUTES LES TABLES
    console.log('📋 TABLES EXISTANTES:');
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);
    
    tables.rows.forEach(table => {
      console.log(`   ✅ ${table.table_name}`);
    });

    // 2. STRUCTURE DE CHAQUE TABLE IMPORTANTE
    const importantTables = ['collaborators', 'scans', 'initiatives', 'admin_users'];
    
    for (const tableName of importantTables) {
      const tableExists = tables.rows.find(t => t.table_name === tableName);
      
      if (tableExists) {
        console.log(`\n📊 STRUCTURE TABLE "${tableName}"`);
        
        const columns = await client.query(`
          SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_name = $1
          ORDER BY ordinal_position;
        `, [tableName]);
        
        columns.rows.forEach(col => {
          console.log(`   ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : ''}`);
        });
        
        // Compter les lignes
        const count = await client.query(`SELECT COUNT(*) FROM ${tableName}`);
        console.log(`   📊 Nombre de lignes: ${count.rows[0].count}`);
        
      } else {
        console.log(`\n❌ TABLE "${tableName}" N'EXISTE PAS`);
      }
    }

    // 3. VÉRIFIER LES FICHIERS ROUTES EXISTANTS
    console.log('\n📁 VÉRIFICATION FICHIERS ROUTES:');
    const fs = require('fs');
    const path = require('path');
    
    const routesDir = './routes/admin';
    if (fs.existsSync(routesDir)) {
      const files = fs.readdirSync(routesDir);
      files.forEach(file => {
        console.log(`   ✅ ${file}`);
      });
    } else {
      console.log('   ❌ Dossier routes/admin n\'existe pas');
    }

    // 4. EXEMPLES DE DONNÉES
    console.log('\n📊 ÉCHANTILLON DONNÉES:');
    
    if (tables.rows.find(t => t.table_name === 'scans')) {
      const sampleScans = await client.query(`
        SELECT initiative_name, signatures_detected, created_at 
        FROM scans 
        ORDER BY created_at DESC 
        LIMIT 3
      `);
      
      console.log('   📸 Derniers scans:');
      sampleScans.rows.forEach(scan => {
        console.log(`     - Initiative: ${scan.initiative_name || 'NULL'}, Signatures: ${scan.signatures_detected}`);
      });
    }

    client.release();
    await pool.end();

    console.log('\n✅ DIAGNOSTIC TERMINÉ - Prêt pour modifications sécurisées');

  } catch (error) {
    console.error('❌ Erreur diagnostic:', error.message);
  }
}

checkExistingStructure();
