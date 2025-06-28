-- Rollback migration matching system
BEGIN;

DROP TABLE IF EXISTS matching_logs CASCADE;
DROP TABLE IF EXISTS signature_details CASCADE;
DROP FUNCTION IF EXISTS cleanup_expired_tokens() CASCADE;

-- Suppression colonnes ajoutées à scans
ALTER TABLE scans DROP COLUMN IF EXISTS scan_type;
ALTER TABLE scans DROP COLUMN IF EXISTS validated_signatures;
ALTER TABLE scans DROP COLUMN IF EXISTS rejected_signatures;
ALTER TABLE scans DROP COLUMN IF EXISTS original_field_scan_id;
ALTER TABLE scans DROP COLUMN IF EXISTS matching_confidence;
ALTER TABLE scans DROP COLUMN IF EXISTS collaborator_name;

COMMIT;
