-- KOLECT V1 - MATCHING SYSTEM DATABASE MIGRATION

-- Extension UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table pour les détails des signatures individuelles
CREATE TABLE IF NOT EXISTS signature_details (
    id SERIAL PRIMARY KEY,
    scan_id INTEGER REFERENCES scans(id) ON DELETE CASCADE,
    signature_name VARCHAR(200),
    is_valid BOOLEAN DEFAULT NULL,
    invalid_reason TEXT,
    signature_image_path TEXT,
    validated_by INTEGER,
    validation_date TIMESTAMP DEFAULT NOW(),
    ephemeral_token VARCHAR(500),
    ephemeral_token_expiry TIMESTAMP,
    view_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Index pour performance
CREATE INDEX IF NOT EXISTS idx_signature_details_scan_id ON signature_details(scan_id);
CREATE INDEX IF NOT EXISTS idx_signature_details_valid ON signature_details(is_valid) WHERE is_valid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signature_details_token ON signature_details(ephemeral_token, ephemeral_token_expiry) WHERE ephemeral_token IS NOT NULL;

-- Ajout colonnes table scans pour matching
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'scans' AND column_name = 'scan_type') THEN
        ALTER TABLE scans ADD COLUMN scan_type VARCHAR(20) DEFAULT 'FIELD_COLLECTION';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'scans' AND column_name = 'validated_signatures') THEN
        ALTER TABLE scans ADD COLUMN validated_signatures INTEGER DEFAULT 0;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'scans' AND column_name = 'rejected_signatures') THEN
        ALTER TABLE scans ADD COLUMN rejected_signatures INTEGER DEFAULT 0;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'scans' AND column_name = 'original_field_scan_id') THEN
        ALTER TABLE scans ADD COLUMN original_field_scan_id INTEGER REFERENCES scans(id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'scans' AND column_name = 'matching_confidence') THEN
        ALTER TABLE scans ADD COLUMN matching_confidence INTEGER DEFAULT 0;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'scans' AND column_name = 'collaborator_name') THEN
        ALTER TABLE scans ADD COLUMN collaborator_name VARCHAR(200);
    END IF;
END
$$;

-- Contraintes
ALTER TABLE scans ADD CONSTRAINT IF NOT EXISTS scans_scan_type_check
    CHECK (scan_type IN ('FIELD_COLLECTION', 'VALIDATION'));
ALTER TABLE scans ADD CONSTRAINT IF NOT EXISTS scans_confidence_check
    CHECK (matching_confidence >= 0 AND matching_confidence <= 100);

-- Index pour le matching
CREATE INDEX IF NOT EXISTS idx_scans_type ON scans(scan_type);
CREATE INDEX IF NOT EXISTS idx_scans_collaborator_name ON scans(collaborator_name) WHERE collaborator_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scans_matching ON scans(collaborator_name, initiative, signatures, scan_type);

-- Table pour les logs de matching
CREATE TABLE IF NOT EXISTS matching_logs (
    id SERIAL PRIMARY KEY,
    validation_scan_id INTEGER REFERENCES scans(id),
    field_scan_id INTEGER REFERENCES scans(id),
    matching_score INTEGER CHECK (matching_score >= 0 AND matching_score <= 100),
    matching_criteria JSONB,
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VALIDATED', 'REJECTED', 'MANUAL')),
    admin_action VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW(),
    processed_at TIMESTAMP,
    processed_by INTEGER
);

-- Index logs matching
CREATE INDEX IF NOT EXISTS idx_matching_logs_validation_scan ON matching_logs(validation_scan_id);
CREATE INDEX IF NOT EXISTS idx_matching_logs_field_scan ON matching_logs(field_scan_id);
CREATE INDEX IF NOT EXISTS idx_matching_logs_status ON matching_logs(status);

-- Function pour nettoyer les tokens expirés
CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    UPDATE signature_details
    SET ephemeral_token = NULL, ephemeral_token_expiry = NULL
    WHERE ephemeral_token_expiry < NOW() AND ephemeral_token IS NOT NULL;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
