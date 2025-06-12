const { Pool } = require('pg');

// === LOGS DEBUG ===
console.log('🔍 === DEBUG DATABASE CONFIG ===');
console.log('🔍 DATABASE_URL définie:', !!process.env.DATABASE_URL);
console.log('🔍 DATABASE_URL commence par postgresql:', process.env.DATABASE_URL?.startsWith('postgresql'));
console.log('🔍 NODE_ENV:', process.env.NODE_ENV);

// Afficher une partie de l'URL (sans le mot de passe)
if (process.env.DATABASE_URL) {
  const urlParts = process.env.DATABASE_URL.split('@');
  if (urlParts.length > 1) {
    console.log('🔍 Database host:', urlParts[1]);
  }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.on('connect', () => {
  console.log('✅ Connexion PostgreSQL établie');
});

pool.on('error', (err) => {
  console.error('❌ Erreur PostgreSQL:', err);
});

module.exports = pool;
