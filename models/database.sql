-- Table des collaborateurs
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

-- Table des initiatives
CREATE TABLE IF NOT EXISTS initiatives (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  color VARCHAR(7) DEFAULT '#4ECDC4',
  is_active BOOLEAN DEFAULT TRUE,
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

-- Initiatives par défaut
INSERT INTO initiatives (name, description, color) 
SELECT 'Commune', 'Initiative pour l''autonomie communale', '#4ECDC4'
WHERE NOT EXISTS (SELECT 1 FROM initiatives WHERE name = 'Commune');

INSERT INTO initiatives (name, description, color) 
SELECT 'Frontière', 'Initiative sur la gestion des frontières', '#44B9A6'
WHERE NOT EXISTS (SELECT 1 FROM initiatives WHERE name = 'Frontière');

INSERT INTO initiatives (name, description, color) 
SELECT 'Forêt', 'Initiative de protection forestière', '#35A085'
WHERE NOT EXISTS (SELECT 1 FROM initiatives WHERE name = 'Forêt');
