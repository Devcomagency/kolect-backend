const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

async function runMigrations() {
  const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
  });

  try {
    console.log('🔄 Début des migrations...');
    
    const sqlPath = path.join(__dirname, '..', 'models', 'database.sql');
    const sqlContent = await fs.readFile(sqlPath, 'utf8');
    
    await pool.query(sqlContent);
    console.log('✅ Tables créées avec succès!');
    
  } catch (error) {
    console.error('❌ Erreur migrations:', error.message);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations();
}

module.exports = runMigrations;
