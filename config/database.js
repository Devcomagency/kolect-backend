-- ========================================
-- KOLECT DATABASE - SCRIPT COMPLET 2025
-- ========================================

-- Supprimer les tables existantes si elles existent (dans le bon ordre pour éviter les erreurs de contraintes)
DROP TRIGGER IF EXISTS trigger_update_scan_stats ON scans;
DROP FUNCTION IF EXISTS update_scan_stats();
DROP TABLE IF EXISTS scan_stats CASCADE;
DROP TABLE IF EXISTS scans CASCADE;
DROP TABLE IF EXISTS auth_sessions CASCADE;
DROP TABLE IF EXISTS initiatives CASCADE;
DROP TABLE IF EXISTS collaborators CASCADE;

-- ========================================
-- TABLE DES COLLABORATEURS
-- ========================================
CREATE TABLE collaborators (
  id SERIAL PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20),
  password_hash VARCHAR(255) NOT NULL,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  contract_signed BOOLEAN DEFAULT FALSE,
  contract_signed_at TIMESTAMP,
  contract_pdf_url TEXT,
  
  -- Paramètres utilisateur
  profile_picture_url TEXT,
  birth_date DATE,
  address TEXT,
  city VARCHAR(100),
  postal_code VARCHAR(10),
  country VARCHAR(50) DEFAULT 'Suisse',
  
  -- Métadonnées
  last_login_at TIMESTAMP,
  email_verified BOOLEAN DEFAULT FALSE,
  email_verified_at TIMESTAMP,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index pour performance
CREATE INDEX idx_collaborators_email ON collaborators(email);
CREATE INDEX idx_collaborators_status ON collaborators(status);
CREATE INDEX idx_collaborators_created_at ON collaborators(created_at);

-- ========================================
-- TABLE DES INITIATIVES
-- ========================================
CREATE TABLE initiatives (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  title VARCHAR(200),
  description TEXT,
  color VARCHAR(7) DEFAULT '#4ECDC4',
  icon VARCHAR(10) DEFAULT '🌿',
  
  -- Objectifs
  target_signatures INTEGER DEFAULT 100000,
  collected_signatures INTEGER DEFAULT 0,
  deadline DATE,
  
  -- Statut
  is_active BOOLEAN DEFAULT TRUE,
  priority INTEGER DEFAULT 1,
  
  -- Métadonnées
  website_url TEXT,
  contact_email VARCHAR(255),
  legal_text TEXT,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index pour performance
CREATE INDEX idx_initiatives_active ON initiatives(is_active);
CREATE INDEX idx_initiatives_name ON initiatives(name);

-- ========================================
-- TABLE DES SESSIONS D'AUTHENTIFICATION
-- ========================================
CREATE TABLE auth_sessions (
  id SERIAL PRIMARY KEY,
  collaborator_id INTEGER REFERENCES collaborators(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  device_info TEXT,
  ip_address INET,
  user_agent TEXT,
  expires_at TIMESTAMP NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index pour performance
CREATE INDEX idx_auth_sessions_collaborator ON auth_sessions(collaborator_id);
CREATE INDEX idx_auth_sessions_token ON auth_sessions(token_hash);
CREATE INDEX idx_auth_sessions_expires ON auth_sessions(expires_at);

-- ========================================
-- TABLE DES SCANS DE SIGNATURES
-- ========================================
CREATE TABLE scans (
  id SERIAL PRIMARY KEY,
  collaborator_id INTEGER REFERENCES collaborators(id) ON DELETE CASCADE,
  initiative_id INTEGER REFERENCES initiatives(id),
  photo_id VARCHAR(255) NOT NULL,
  
  -- Données d'analyse IA
  signatures_count INTEGER NOT NULL DEFAULT 0 CHECK (signatures_count >= 0),
  quality_score INTEGER CHECK (quality_score >= 0 AND quality_score <= 100),
  confidence_score INTEGER CHECK (confidence_score >= 0 AND confidence_score <= 100),
  
  -- Métadonnées de l'initiative
  initiative_name VARCHAR(100),
  
  -- Gestion des doublons
  is_duplicate BOOLEAN DEFAULT FALSE,
  duplicate_of INTEGER REFERENCES scans(id),
  duplicate_confidence INTEGER DEFAULT 0,
  
  -- Géolocalisation (optionnel)
  location_lat DECIMAL(10, 8),
  location_lng DECIMAL(11, 8),
  location_name VARCHAR(255),
  location_accuracy DECIMAL(8, 2),
  
  -- Image et données techniques
  image_base64 TEXT, -- Stockage temporaire de l'image
  image_url TEXT,    -- URL finale de l'image uploadée
  image_size INTEGER,
  image_width INTEGER,
  image_height INTEGER,
  image_format VARCHAR(10) DEFAULT 'JPEG',
  
  -- Données techniques du scan
  device_info TEXT,
  app_version VARCHAR(20),
  processing_time_ms INTEGER,
  
  -- Statuts et validation
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'validated', 'rejected', 'duplicate', 'under_review')),
  validated_by INTEGER REFERENCES collaborators(id),
  validated_at TIMESTAMP,
  validation_note TEXT,
  rejection_reason TEXT,
  
  -- Points et gamification
  points_awarded INTEGER DEFAULT 0,
  quality_bonus INTEGER DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index pour performance optimisée
CREATE INDEX idx_scans_collaborator ON scans(collaborator_id);
CREATE INDEX idx_scans_initiative ON scans(initiative_id);
CREATE INDEX idx_scans_status ON scans(status);
CREATE INDEX idx_scans_created_at ON scans(created_at DESC);
CREATE INDEX idx_scans_validated_at ON scans(validated_at);
CREATE INDEX idx_scans_duplicate ON scans(is_duplicate);
CREATE INDEX idx_scans_signatures_count ON scans(signatures_count);

-- Index composite pour les requêtes fréquentes
CREATE INDEX idx_scans_collaborator_status_created ON scans(collaborator_id, status, created_at DESC);
CREATE INDEX idx_scans_initiative_status_created ON scans(initiative_id, status, created_at DESC);

-- ========================================
-- TABLE DES STATISTIQUES EN TEMPS RÉEL
-- ========================================
CREATE TABLE scan_stats (
  id SERIAL PRIMARY KEY,
  collaborator_id INTEGER REFERENCES collaborators(id) ON DELETE CASCADE,
  
  -- Totaux généraux
  total_scans INTEGER DEFAULT 0,
  total_signatures INTEGER DEFAULT 0,
  total_points INTEGER DEFAULT 0,
  
  -- Qualité
  average_quality DECIMAL(5,2) DEFAULT 0,
  best_quality_score INTEGER DEFAULT 0,
  
  -- Scans par période
  scans_today INTEGER DEFAULT 0,
  scans_this_week INTEGER DEFAULT 0,
  scans_this_month INTEGER DEFAULT 0,
  scans_this_year INTEGER DEFAULT 0,
  
  -- Signatures par période
  signatures_today INTEGER DEFAULT 0,
  signatures_this_week INTEGER DEFAULT 0,
  signatures_this_month INTEGER DEFAULT 0,
  signatures_this_year INTEGER DEFAULT 0,
  
  -- Points par période
  points_today INTEGER DEFAULT 0,
  points_this_week INTEGER DEFAULT 0,
  points_this_month INTEGER DEFAULT 0,
  points_this_year INTEGER DEFAULT 0,
  
  -- Meilleur scan
  best_scan_signatures INTEGER DEFAULT 0,
  best_scan_date DATE,
  best_scan_id INTEGER REFERENCES scans(id),
  
  -- Streaks et achievements
  current_streak_days INTEGER DEFAULT 0,
  longest_streak_days INTEGER DEFAULT 0,
  
  -- Timestamps
  last_scan_at TIMESTAMP,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(collaborator_id)
);

-- Index pour performance
CREATE INDEX idx_scan_stats_collaborator ON scan_stats(collaborator_id);
CREATE INDEX idx_scan_stats_total_signatures ON scan_stats(total_signatures DESC);
CREATE INDEX idx_scan_stats_total_points ON scan_stats(total_points DESC);

-- ========================================
-- TRIGGERS ET FONCTIONS AUTOMATIQUES
-- ========================================

-- Fonction pour mettre à jour automatiquement updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers pour updated_at
CREATE TRIGGER trigger_collaborators_updated_at
  BEFORE UPDATE ON collaborators
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_initiatives_updated_at
  BEFORE UPDATE ON initiatives
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_scans_updated_at
  BEFORE UPDATE ON scans
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Fonction pour mise à jour automatique des statistiques
CREATE OR REPLACE FUNCTION update_scan_stats()
RETURNS TRIGGER AS $$
DECLARE
  scan_points INTEGER;
  today_date DATE := CURRENT_DATE;
BEGIN
  -- Calculer les points pour ce scan
  scan_points := NEW.signatures_count * 2;
  IF NEW.quality_score >= 90 THEN
    scan_points := scan_points + FLOOR(NEW.signatures_count * 0.5);
  END IF;
  
  -- Mettre à jour les points dans le scan
  UPDATE scans SET points_awarded = scan_points WHERE id = NEW.id;
  
  -- Mise à jour des statistiques
  INSERT INTO scan_stats (
    collaborator_id, total_scans, total_signatures, total_points,
    average_quality, best_quality_score, scans_today, signatures_today,
    points_today, best_scan_signatures, best_scan_date, best_scan_id,
    last_scan_at, last_updated
  )
  VALUES (
    NEW.collaborator_id, 1, NEW.signatures_count, scan_points,
    NEW.quality_score, NEW.quality_score, 1, NEW.signatures_count,
    scan_points, NEW.signatures_count, today_date, NEW.id,
    NEW.created_at, CURRENT_TIMESTAMP
  )
  ON CONFLICT (collaborator_id) DO UPDATE SET
    total_scans = scan_stats.total_scans + 1,
    total_signatures = scan_stats.total_signatures + NEW.signatures_count,
    total_points = scan_stats.total_points + scan_points,
    average_quality = (
      (scan_stats.average_quality * scan_stats.total_scans + NEW.quality_score) /
      (scan_stats.total_scans + 1)
    ),
    best_quality_score = GREATEST(scan_stats.best_quality_score, NEW.quality_score),
    
    -- Mise à jour quotidienne
    scans_today = CASE
      WHEN DATE(scan_stats.last_updated) = today_date
      THEN scan_stats.scans_today + 1
      ELSE 1
    END,
    signatures_today = CASE
      WHEN DATE(scan_stats.last_updated) = today_date
      THEN scan_stats.signatures_today + NEW.signatures_count
      ELSE NEW.signatures_count
    END,
    points_today = CASE
      WHEN DATE(scan_stats.last_updated) = today_date
      THEN scan_stats.points_today + scan_points
      ELSE scan_points
    END,
    
    -- Mise à jour hebdomadaire (approximative)
    scans_this_week = CASE
      WHEN scan_stats.last_updated > CURRENT_DATE - INTERVAL '7 days'
      THEN scan_stats.scans_this_week + 1
      ELSE 1
    END,
    signatures_this_week = CASE
      WHEN scan_stats.last_updated > CURRENT_DATE - INTERVAL '7 days'
      THEN scan_stats.signatures_this_week + NEW.signatures_count
      ELSE NEW.signatures_count
    END,
    points_this_week = CASE
      WHEN scan_stats.last_updated > CURRENT_DATE - INTERVAL '7 days'
      THEN scan_stats.points_this_week + scan_points
      ELSE scan_points
    END,
    
    -- Mise à jour mensuelle (approximative)
    scans_this_month = CASE
      WHEN scan_stats.last_updated > CURRENT_DATE - INTERVAL '30 days'
      THEN scan_stats.scans_this_month + 1
      ELSE 1
    END,
    signatures_this_month = CASE
      WHEN scan_stats.last_updated > CURRENT_DATE - INTERVAL '30 days'
      THEN scan_stats.signatures_this_month + NEW.signatures_count
      ELSE NEW.signatures_count
    END,
    points_this_month = CASE
      WHEN scan_stats.last_updated > CURRENT_DATE - INTERVAL '30 days'
      THEN scan_stats.points_this_month + scan_points
      ELSE scan_points
    END,
    
    -- Meilleur scan
    best_scan_signatures = CASE
      WHEN NEW.signatures_count > scan_stats.best_scan_signatures
      THEN NEW.signatures_count
      ELSE scan_stats.best_scan_signatures
    END,
    best_scan_date = CASE
      WHEN NEW.signatures_count > scan_stats.best_scan_signatures
      THEN today_date
      ELSE scan_stats.best_scan_date
    END,
    best_scan_id = CASE
      WHEN NEW.signatures_count > scan_stats.best_scan_signatures
      THEN NEW.id
      ELSE scan_stats.best_scan_id
    END,
    
    last_scan_at = NEW.created_at,
    last_updated = CURRENT_TIMESTAMP;

  -- Mettre à jour le compteur global de l'initiative
  UPDATE initiatives
  SET collected_signatures = collected_signatures + NEW.signatures_count
  WHERE id = NEW.initiative_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Créer le trigger pour les statistiques
CREATE TRIGGER trigger_update_scan_stats
  AFTER INSERT ON scans
  FOR EACH ROW
  WHEN (NEW.status != 'rejected')
  EXECUTE FUNCTION update_scan_stats();

-- ========================================
-- INSERTION DES DONNÉES INITIALES
-- ========================================

-- Initiatives par défaut avec données complètes
INSERT INTO initiatives (name, title, description, color, icon, target_signatures, deadline, priority) VALUES
('Forêt', 'Protection des Forêts Suisses', 'Initiative populaire pour la protection et la préservation des forêts en Suisse contre l''urbanisation excessive', '#2E7D32', '🌲', 100000, '2025-12-31', 1),
('Commune', 'Autonomie Communale Renforcée', 'Initiative pour renforcer l''autonomie des communes suisses en matière de décisions locales', '#1976D2', '🏘️', 75000, '2025-10-15', 2),
('Frontière', 'Gestion Démocratique des Frontières', 'Initiative pour une gestion plus démocratique et transparente des politiques frontalières', '#7B1FA2', '🗺️', 50000, '2025-08-30', 3)
ON CONFLICT (name) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  color = EXCLUDED.color,
  icon = EXCLUDED.icon,
  target_signatures = EXCLUDED.target_signatures,
  deadline = EXCLUDED.deadline,
  priority = EXCLUDED.priority,
  updated_at = CURRENT_TIMESTAMP;

-- ========================================
-- VUES UTILES POUR LE BACKOFFICE
-- ========================================

-- Vue des statistiques globales
CREATE OR REPLACE VIEW global_stats AS
SELECT
  COUNT(DISTINCT c.id) as total_collaborators,
  COUNT(DISTINCT s.id) as total_scans,
  SUM(s.signatures_count) as total_signatures,
  SUM(s.points_awarded) as total_points,
  AVG(s.quality_score) as average_quality,
  COUNT(DISTINCT s.id) FILTER (WHERE s.created_at >= CURRENT_DATE) as scans_today,
  SUM(s.signatures_count) FILTER (WHERE s.created_at >= CURRENT_DATE) as signatures_today,
  COUNT(DISTINCT s.id) FILTER (WHERE s.created_at >= CURRENT_DATE - INTERVAL '7 days') as scans_this_week,
  SUM(s.signatures_count) FILTER (WHERE s.created_at >= CURRENT_DATE - INTERVAL '7 days') as signatures_this_week
FROM collaborators c
LEFT JOIN scans s ON c.id = s.collaborator_id AND s.status != 'rejected';

-- Vue du leaderboard
CREATE OR REPLACE VIEW leaderboard AS
SELECT
  c.id,
  c.first_name,
  c.last_name,
  c.email,
  COALESCE(ss.total_scans, 0) as total_scans,
  COALESCE(ss.total_signatures, 0) as total_signatures,
  COALESCE(ss.total_points, 0) as total_points,
  COALESCE(ss.average_quality, 0) as average_quality,
  ROW_NUMBER() OVER (ORDER BY COALESCE(ss.total_signatures, 0) DESC) as rank
FROM collaborators c
LEFT JOIN scan_stats ss ON c.id = ss.collaborator_id
WHERE c.status = 'active'
ORDER BY total_signatures DESC;

-- Vue des statistiques par initiative
CREATE OR REPLACE VIEW initiative_stats AS
SELECT
  i.id,
  i.name,
  i.title,
  i.color,
  i.target_signatures,
  i.collected_signatures,
  i.deadline,
  COUNT(s.id) as total_scans,
  COUNT(DISTINCT s.collaborator_id) as unique_collaborators,
  AVG(s.quality_score) as average_quality,
  SUM(s.signatures_count) as signatures_from_scans,
  (i.collected_signatures * 100.0 / i.target_signatures) as completion_percentage
FROM initiatives i
LEFT JOIN scans s ON i.id = s.initiative_id AND s.status = 'validated'
GROUP BY i.id, i.name, i.title, i.color, i.target_signatures, i.collected_signatures, i.deadline
ORDER BY completion_percentage DESC;

-- ========================================
-- POLITIQUE DE NETTOYAGE AUTOMATIQUE
-- ========================================

-- Fonction pour nettoyer les anciennes sessions expirées
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS void AS $$
BEGIN
  DELETE FROM auth_sessions
  WHERE expires_at < CURRENT_TIMESTAMP
  OR (created_at < CURRENT_TIMESTAMP - INTERVAL '30 days' AND is_active = false);
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- COMMENTAIRES ET DOCUMENTATION
-- ========================================

COMMENT ON TABLE collaborators IS 'Table des collaborateurs/collecteurs de signatures';
COMMENT ON TABLE initiatives IS 'Table des initiatives/pétitions disponibles';
COMMENT ON TABLE scans IS 'Table des scans de signatures réalisés par les collaborateurs';
COMMENT ON TABLE scan_stats IS 'Table des statistiques en temps réel par collaborateur';
COMMENT ON TABLE auth_sessions IS 'Table des sessions d''authentification actives';

COMMENT ON COLUMN scans.quality_score IS 'Score de qualité de l''image (0-100) déterminé par l''IA';
COMMENT ON COLUMN scans.confidence_score IS 'Niveau de confiance de l''IA dans l''analyse (0-100)';
COMMENT ON COLUMN scans.points_awarded IS 'Points attribués pour ce scan (calculé automatiquement)';
COMMENT ON COLUMN scans.is_duplicate IS 'Indique si ce scan est identifié comme un doublon';

-- ========================================
-- PERMISSIONS ET SÉCURITÉ
-- ========================================

-- Ces commandes sont à adapter selon votre environnement
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kolect_app_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kolect_app_user;

-- ========================================
-- VÉRIFICATION FINALE
-- ========================================

-- Afficher un résumé des tables créées
SELECT
  schemaname,
  tablename,
  hasindexes,
  hastriggers
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('collaborators', 'initiatives', 'scans', 'scan_stats', 'auth_sessions')
ORDER BY tablename;

-- Message de confirmation
DO $$
BEGIN
  RAISE NOTICE '🎉 Base de données Kolect initialisée avec succès !';
  RAISE NOTICE '📊 Tables créées : collaborators, initiatives, scans, scan_stats, auth_sessions';
  RAISE NOTICE '🔧 Triggers automatiques activés pour les statistiques';
  RAISE NOTICE '📈 Vues créées : global_stats, leaderboard, initiative_stats';
  RAISE NOTICE '✅ Prêt pour la production !';
END $$;
