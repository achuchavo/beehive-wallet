-- Migration 006 — mark linked addresses as verified, and force re-verification
-- of anything linked before ownership proofs existed (follow-up to audit #19).
--
-- Every existing main_address was set WITHOUT proof of control, so all rows
-- start at main_address_verified = 0. That is the forced re-verification: the
-- address is preserved (nothing is deleted), but until the owner proves control
-- by signing a challenge it no longer counts as a login identifier.
--
-- Apply with a privileged user:
--   mysql -u chavo -p beehive_wallet < docs/migrations/006_address_verified_flag.sql
--
-- BACK UP FIRST (outside the repo — dumps contain emails and password hashes):
--   mysqldump -u chavo -p beehive_wallet > D:\WebServer\backups\before_006.sql
-- ROLLBACK: ALTER TABLE users DROP COLUMN main_address_verified;
--           and reset schema_version to 5.

-- MySQL has no "ADD COLUMN IF NOT EXISTS", so this is guarded dynamically to
-- stay idempotent.
SET @col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'main_address_verified'
);
SET @sql := IF(@col = 0,
    'ALTER TABLE users ADD COLUMN main_address_verified TINYINT(1) NOT NULL DEFAULT 0',
    'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Belt and braces: anything already linked is explicitly marked unverified.
UPDATE users SET main_address_verified = 0 WHERE main_address IS NOT NULL;

-- An address that is not set cannot be "verified".
UPDATE users SET main_address_verified = 0 WHERE main_address IS NULL;

INSERT INTO schema_version (version, applied_at)
VALUES (6, NOW())
ON DUPLICATE KEY UPDATE applied_at = VALUES(applied_at);
