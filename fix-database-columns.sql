-- Ajouter les colonnes manquantes si elles n'existent pas
ALTER TABLE collaborators 
ADD COLUMN IF NOT EXISTS contract_signed BOOLEAN DEFAULT FALSE;

ALTER TABLE collaborators 
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';

-- Mettre à jour les utilisateurs existants
UPDATE collaborators 
SET contract_signed = FALSE 
WHERE contract_signed IS NULL;

UPDATE collaborators 
SET status = 'active' 
WHERE status IS NULL;
