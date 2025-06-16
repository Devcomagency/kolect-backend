-- ✅ SCHEMA FINAL KOLECT - Cohérent avec l'application

-- Table des collaborateurs (snake_case pour PostgreSQL)
CREATE TABLE IF NOT EXISTS collaborators (
  id SERIAL PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20),
  password_hash VARCHAR(255) NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  contract_signed BOOLEAN DEFAULT FALSE,
  contract_signed_at TIMESTAMP,
  contract_pdf_url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ✅ MISE À JOUR DES UTILISATEURS EXISTANTS
-- Ajouter les colonnes manquantes si elles n'existent pas
DO $$ 
BEGIN
    -- Ajouter la colonne status si elle n'existe pas
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'collaborators' AND column_name = 'status') THEN
        ALTER TABLE collaborators ADD COLUMN status VARCHAR(20) DEFAULT 'active';
    END IF;
    
    -- Ajouter la colonne contract_signed si elle n'existe pas
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'collaborators' AND column_name = 'contract_signed') THEN
        ALTER TABLE collaborators ADD COLUMN contract_signed BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- ✅ METTRE À JOUR TOUS LES UTILISATEURS EXISTANTS
UPDATE collaborators 
SET status = 'active' 
WHERE status IS NULL OR status = '';

UPDATE collaborators 
SET contract_signed = FALSE 
WHERE contract_signed IS NULL;

-- ✅ MIGRATION DES DONNÉES si colonnes firstName/lastName existent
DO $$ 
BEGIN
    -- Si les colonnes camelCase existent, migrer vers snake_case
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'collaborators' AND column_name = 'firstname') THEN
        UPDATE collaborators SET first_name = firstname WHERE first_name IS NULL;
        ALTER TABLE collaborators DROP COLUMN IF EXISTS firstname;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'collaborators' AND column_name = 'lastname') THEN
        UPDATE collaborators SET last_name = lastname WHERE last_name IS NULL;
        ALTER TABLE collaborators DROP COLUMN IF EXISTS lastname;
    END IF;
    
    -- Migration pour password/password_hash
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'collaborators' AND column_name = 'password') THEN
        UPDATE collaborators SET password_hash = password WHERE password_hash IS NULL;
        ALTER TABLE collaborators DROP COLUMN IF EXISTS password;
    END IF;
END $$;

-- Table des initiatives
CREATE TABLE IF NOT EXISTS initiatives (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  color VARCHAR(7) DEFAULT '#4ECDC4',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table des scans
CREATE TABLE IF NOT EXISTS scans (
  id SERIAL PRIMARY KEY,
  collaborator_id INTEGER REFERENCES collaborators(id),
  initiative_id INTEGER REFERENCES initiatives(id),
  signatures_count INTEGER NOT NULL DEFAULT 0,
  quality_score INTEGER DEFAULT 0,
  confidence_score INTEGER DEFAULT 0,
  photo_url TEXT,
  location TEXT,
  scan_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table des sessions d'auth
CREATE TABLE IF NOT EXISTS auth_sessions (
  id SERIAL PRIMARY KEY,
  collaborator_id INTEGER REFERENCES collaborators(id),
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ✅ INITIATIVES PAR DÉFAUT
INSERT INTO initiatives (name, description, color) 
SELECT 'Commune', 'Initiative pour l''autonomie communale', '#4ECDC4'
WHERE NOT EXISTS (SELECT 1 FROM initiatives WHERE name = 'Commune');

INSERT INTO initiatives (name, description, color) 
SELECT 'Frontière', 'Initiative sur la gestion des frontières', '#44B9A6'
WHERE NOT EXISTS (SELECT 1 FROM initiatives WHERE name = 'Frontière');

INSERT INTO initiatives (name, description, color) 
SELECT 'Forêt', 'Initiative de protection forestière', '#35A085'
WHERE NOT EXISTS (SELECT 1 FROM initiatives WHERE name = 'Forêt');

-- ✅ INDEX POUR LES PERFORMANCES
CREATE INDEX IF NOT EXISTS idx_collaborators_email ON collaborators(email);
CREATE INDEX IF NOT EXISTS idx_collaborators_status ON collaborators(status);
CREATE INDEX IF NOT EXISTS idx_scans_collaborator ON scans(collaborator_id);
CREATE INDEX IF NOT EXISTS idx_scans_date ON scans(scan_date);

-- ✅ VÉRIFICATION FINALE
SELECT 'Migration terminée - Vérification des utilisateurs actifs:' as message;
SELECT id, first_name, last_name, email, status, contract_signed 
FROM collaborators 
WHERE status = 'active' 
ORDER BY created_at DESC;