const { Pool } = require('pg');

// Configuration forcée SSL pour Render
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Test connexion
pool.on('connect', () => {
  console.log('✅ Connexion database SSL réussie');
});

pool.on('error', (err) => {
  console.error('❌ Erreur database:', err.message);
});

module.exports = pool;
