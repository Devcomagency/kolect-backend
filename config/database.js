const { Pool } = require('pg');

// Configuration database avec SSL pour Render
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Gestion des erreurs de connexion
pool.on('error', (err) => {
  console.error('🚨 Erreur pool database:', err);
});

// Test de connexion au démarrage
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Erreur connexion initiale database:', err.message);
  } else {
    console.log('✅ Database connectée avec succès');
    release();
  }
});

module.exports = pool;
