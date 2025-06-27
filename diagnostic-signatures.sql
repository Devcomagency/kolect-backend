-- ==========================================
-- KOLECT ADMIN - DIAGNOSTIC & CORRECTIONS DATABASE
-- Exécutez ce script pour diagnostiquer et corriger les problèmes
-- ==========================================

-- 1. DIAGNOSTIC STRUCTURE TABLES EXISTANTES
SELECT 'STRUCTURE TABLE SCANS' as diagnostic;
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'scans' 
ORDER BY ordinal_position;

SELECT 'STRUCTURE TABLE COLLABORATORS' as diagnostic;
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'collaborators' 
ORDER BY ordinal_position;

SELECT 'STRUCTURE TABLE INITIATIVES' as diagnostic;
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'initiatives' 
ORDER BY ordinal_position;

-- 2. DIAGNOSTIC DONNÉES SIGNATURES (PROBLÈME IDENTIFIÉ)
SELECT 'ANALYSE SIGNATURES - PROBLÈME ACTUEL' as diagnostic;
SELECT 
    initiative,
    COUNT(*) as nb_scans,
    SUM(signatures) as sum_signatures_col,
    SUM(total_signatures) as sum_total_signatures_col,
    SUM(COALESCE(total_signatures, signatures, 0)) as sum_current_method,
    AVG(signatures) as avg_signatures,
    MAX(signatures) as max_signatures,
    MIN(signatures) as min_signatures
FROM scans 
GROUP BY initiative
ORDER BY sum_current_method DESC;

-- Totaux globaux
SELECT 'TOTAUX GLOBAUX ACTUELS' as diagnostic;
SELECT 
    COUNT(*) as total_scans,
    SUM(signatures) as total_signatures_col,
    SUM(total_signatures) as total_total_signatures_col,
    SUM(COALESCE(total_signatures, signatures, 0)) as total_current_method
FROM scans;

-- 3. CORRECTIONS & NOUVELLES TABLES POUR FONCTIONNALITÉS

-- Table pour vérifications manuelles
CREATE TABLE IF NOT EXISTS scan_verifications (
    id SERIAL PRIMARY KEY,
    scan_id INTEGER REFERENCES scans(id) ON DELETE CASCADE,
    admin_id INTEGER REFERENCES admin_users(id),
    original_signatures INTEGER,
    verified_signatures INTEGER, 
    original_initiative VARCHAR(100),
    verified_initiative VARCHAR(100),
    verification_status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected
    admin_notes TEXT,
    doubt_reason VARCHAR(50), -- low_confidence, too_many, poor_quality, etc.
    verified_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(scan_id)
);

-- Index pour performance
CREATE INDEX IF NOT EXISTS idx_scan_verifications_status ON scan_verifications(verification_status);
CREATE INDEX IF NOT EXISTS idx_scan_verifications_admin ON scan_verifications(admin_id);

-- Table pour images initiatives
CREATE TABLE IF NOT EXISTS initiative_images (
    id SERIAL PRIMARY KEY,
    initiative_id INTEGER REFERENCES initiatives(id) ON DELETE CASCADE,
    image_path VARCHAR(500) NOT NULL,
    image_type VARCHAR(20) DEFAULT 'reference', -- 'reference', 'example' 
    description TEXT,
    is_primary BOOLEAN DEFAULT FALSE,
    uploaded_by INTEGER REFERENCES admin_users(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Index pour performance
CREATE INDEX IF NOT EXISTS idx_initiative_images_initiative ON initiative_images(initiative_id);
CREATE INDEX IF NOT EXISTS idx_initiative_images_primary ON initiative_images(is_primary);

-- Améliorer table collaborators pour gestion complète
ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS contract_type VARCHAR(50);
ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS id_document_type VARCHAR(20); -- 'passport', 'id_card', 'driver_license'
ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS id_document_number VARCHAR(50);
ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS id_document_expiry DATE;
ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS suspended BOOLEAN DEFAULT FALSE;
ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS suspension_reason TEXT;
ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMP;
ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS suspended_by INTEGER REFERENCES admin_users(id);
ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES admin_users(id);

-- Index pour performance gestion collaborateurs
CREATE INDEX IF NOT EXISTS idx_collaborators_status ON collaborators(status, suspended);
CREATE INDEX IF NOT EXISTS idx_collaborators_active ON collaborators(is_active, suspended);

-- Améliorer table initiatives
ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;
ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS gpt_instructions TEXT; -- Instructions spécifiques pour GPT-4
ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES admin_users(id);
ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Index pour performance initiatives  
CREATE INDEX IF NOT EXISTS idx_initiatives_active ON initiatives(is_active);
CREATE INDEX IF NOT EXISTS idx_initiatives_order ON initiatives(display_order);

-- Vue pour scans douteux (pour vérifications manuelles)
CREATE OR REPLACE VIEW doubtful_scans AS
SELECT 
    s.*,
    c.first_name,
    c.last_name,
    c.email as collaborator_email,
    CASE 
        WHEN s.confidence < 85 THEN 'low_confidence'
        WHEN s.signatures > 25 THEN 'too_many_signatures'  
        WHEN s.quality < 70 THEN 'poor_quality'
        WHEN s.signatures < 3 THEN 'too_few_signatures'
        WHEN s.signatures IS NULL THEN 'null_signatures'
        ELSE 'other'
    END as doubt_reason,
    CASE 
        WHEN s.confidence < 85 THEN 'Confiance faible (' || COALESCE(s.confidence, 0) || '%)'
        WHEN s.signatures > 25 THEN 'Trop de signatures (' || s.signatures || ')'
        WHEN s.quality < 70 THEN 'Qualité faible (' || COALESCE(s.quality, 0) || '%)'
        WHEN s.signatures < 3 THEN 'Peu de signatures (' || COALESCE(s.signatures, 0) || ')'
        WHEN s.signatures IS NULL THEN 'Signatures non détectées'
        ELSE 'Autre problème'
    END as doubt_description
FROM scans s
LEFT JOIN collaborators c ON s.collaborator_id = c.id OR s.user_id = c.id
WHERE 
    s.confidence < 85 OR 
    s.signatures > 25 OR 
    s.quality < 70 OR 
    s.signatures < 3 OR
    s.signatures IS NULL
ORDER BY s.created_at DESC;

-- Vue pour stats collaborateurs enrichies
CREATE OR REPLACE VIEW collaborator_stats AS
SELECT 
    c.id,
    c.first_name,
    c.last_name,
    c.email,
    c.phone,
    c.status,
    c.is_active,
    c.suspended,
    c.suspension_reason,
    c.contract_type,
    c.id_document_type,
    c.created_at,
    c.hire_date,
    COUNT(s.id) as total_scans,
    COALESCE(SUM(s.signatures), 0) as total_signatures,
    AVG(s.quality) as avg_quality,
    AVG(s.confidence) as avg_confidence,
    MAX(s.created_at) as last_scan_date,
    COUNT(DISTINCT s.initiative) as initiatives_worked,
    COUNT(s.id) FILTER (WHERE s.created_at >= CURRENT_DATE - INTERVAL '7 days') as scans_last_7_days,
    COUNT(s.id) FILTER (WHERE s.created_at >= CURRENT_DATE - INTERVAL '30 days') as scans_last_30_days,
    RANK() OVER (ORDER BY SUM(s.signatures) DESC) as signature_ranking
FROM collaborators c
LEFT JOIN scans s ON c.id = COALESCE(s.collaborator_id, s.user_id)
GROUP BY c.id, c.first_name, c.last_name, c.email, c.phone, c.status, c.is_active, 
         c.suspended, c.suspension_reason, c.contract_type, c.id_document_type, 
         c.created_at, c.hire_date;

-- 4. VÉRIFIER LES NOUVELLES STRUCTURES
SELECT 'VÉRIFICATION NOUVELLES TABLES' as diagnostic;
SELECT 
    table_name,
    CASE WHEN table_name IN (
        'scan_verifications', 
        'initiative_images'
    ) THEN '✅ CRÉÉE' ELSE '❌ MANQUANTE' END as status
FROM information_schema.tables 
WHERE table_name IN ('scan_verifications', 'initiative_images', 'doubtful_scans', 'collaborator_stats')
ORDER BY table_name;

-- 5. COMPTER SCANS DOUTEUX
SELECT 'SCANS DOUTEUX DÉTECTÉS' as diagnostic;
SELECT 
    doubt_reason,
    COUNT(*) as count,
    doubt_description
FROM doubtful_scans 
GROUP BY doubt_reason, doubt_description
ORDER BY count DESC;

-- 6. STATS FINALES
SELECT 'STATS FINALES APRÈS CORRECTIONS' as diagnostic;
SELECT 
    'Total scans' as metric,
    COUNT(*) as value
FROM scans
UNION ALL
SELECT 
    'Scans douteux',
    COUNT(*)
FROM doubtful_scans
UNION ALL  
SELECT 
    'Collaborateurs actifs',
    COUNT(*)
FROM collaborators 
WHERE is_active = TRUE AND (suspended = FALSE OR suspended IS NULL)
UNION ALL
SELECT 
    'Initiatives actives', 
    COUNT(*)
FROM initiatives
WHERE is_active = TRUE OR is_active IS NULL;

COMMIT;
