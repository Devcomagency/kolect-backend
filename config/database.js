// ========================================
// KOLECT DATABASE - Configuration JavaScript
// ========================================

const { Pool } = require('pg');

console.log('🔍 === DEBUG DATABASE CONFIG ===');
console.log('🔍 DATABASE_URL définie:', !!process.env.DATABASE_URL);
console.log('🔍 DATABASE_URL commence par postgresql:', process.env.DATABASE_URL?.startsWith('postgresql'));
console.log('🔍 NODE_ENV:', process.env.NODE_ENV);

// Configuration de la base de données
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Test de connexion
pool.on('connect', () => {
  console.log('✅ Connexion PostgreSQL établie');
});

pool.on('error', (err) => {
  console.error('❌ Erreur PostgreSQL:', err);
});

module.exports = pool;
