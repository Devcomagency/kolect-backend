const { Pool } = require('pg');
const bcrypt = require('bcrypt');

// URL publique Railway PostgreSQL
const DATABASE_URL = 'postgresql://postgres:HkhhUEadnSkLExRcpoFcszqpAEWgKcnu@switchyard.proxy.rlwy.net:30057/railway';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    require: true,
    rejectUnauthorized: false
  }
});

async function setupDatabase() {
  console.log('🔄 Création tables Railway PostgreSQL...');
  
  try {
    // Créer table collaborators
    await pool.query(`
      CREATE TABLE IF NOT EXISTS collaborators (
        id SERIAL PRIMARY KEY,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        phone VARCHAR(20),
        password_hash VARCHAR(255) NOT NULL,
        contract_signed BOOLEAN DEFAULT FALSE,
        contract_signed_at TIMESTAMP,
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Table collaborators créée');

    // Créer table initiatives
    await pool.query(`
      CREATE TABLE IF NOT EXISTS initiatives (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        description TEXT,
        color VARCHAR(7) DEFAULT '#4ECDC4',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Table initiatives créée');

    // Créer table scans
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scans (
        id SERIAL PRIMARY KEY,
        collaborator_id INTEGER REFERENCES collaborators(id),
        initiative_id INTEGER REFERENCES initiatives(id),
        image_url TEXT NOT NULL,
        image_hash VARCHAR(64),
        valid_signatures INTEGER DEFAULT 0,
        rejected_signatures INTEGER DEFAULT 0,
        total_signatures INTEGER DEFAULT 0,
        ocr_confidence DECIMAL(3,2) DEFAULT 0.0,
        status VARCHAR(20) DEFAULT 'processing',
        needs_review BOOLEAN DEFAULT FALSE,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Table scans créée');

    // Insérer initiatives
    await pool.query(`
      INSERT INTO initiatives (name, description, color) VALUES
      ('Commune', 'Initiative pour l''autonomie communale', '#4ECDC4'),
      ('Frontière', 'Initiative sur la gestion des frontières', '#44B9A6'),
      ('Forêt', 'Initiative de protection forestière', '#35A085')
      ON CONFLICT (name) DO NOTHING;
    `);
    console.log('✅ Initiatives créées');

    // Insérer utilisateurs
    const hashedPassword = await bcrypt.hash('password123', 10);
    
    await pool.query(`
      INSERT INTO collaborators (first_name, last_name, email, password_hash, contract_signed) VALUES
      ('Jean', 'Dupont', 'jean@kolect.com', $1, true),
      ('Marie', 'Martin', 'marie@kolect.com', $1, true),
      ('Admin', 'Kolect', 'admin@kolect.com', $1, true)
      ON CONFLICT (email) DO NOTHING;
    `, [hashedPassword]);
    console.log('✅ Utilisateurs créés');

    console.log('🎉 BASE DE DONNÉES RAILWAY CONFIGURÉE !');
    console.log('👤 jean@kolect.com / password123');
    console.log('👤 marie@kolect.com / password123');
    console.log('👤 admin@kolect.com / password123');
    console.log('🎯 Initiatives : Commune, Frontière, Forêt');
    
  } catch (error) {
    console.error('❌ Erreur:', error);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

setupDatabase();
