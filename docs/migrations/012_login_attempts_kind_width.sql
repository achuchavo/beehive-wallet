-- Migration 012 — widen login_attempts.kind to match its declared schema.
--
-- THE BUG: address_challenge.php records an attempt with kind
-- 'address_challenge' (17 characters). On a database where the column is
-- narrower than that, MySQL strict mode raises
--     SQLSTATE[22001] 1406 Data too long for column 'kind'
-- which is an uncaught PDOException, so PHP returns an empty 500 body and the
-- browser reports "Unexpected end of JSON input". The practical symptom is that
-- linking a wallet address fails with an unreadable error.
--
-- WHY THE DRIFT: migration 004 creates login_attempts with VARCHAR(20) using
-- CREATE TABLE IF NOT EXISTS. On any deployment where the table already existed
-- - created by hand before 004 was written, with VARCHAR(12) - the IF NOT
-- EXISTS matched and the wider definition was never applied. The file and the
-- database have disagreed ever since, silently, because nothing recorded a kind
-- longer than 'register' until address ownership proofs were added in 005.
--
-- This is why the column is widened here rather than the string shortened: the
-- schema files already say 20, the code was written against 20, and only the
-- deployed column is wrong.
--
-- record_attempt() now also truncates the kind to the column width, so a future
-- kind longer than this can never take an endpoint offline the same way.
--
-- Apply with a privileged user:
--   mysql -u chavo -p beehive_wallet < docs/migrations/012_login_attempts_kind_width.sql
--
-- BACK UP FIRST (outside the repo — dumps contain emails and password hashes):
--   mysqldump -u chavo -p beehive_wallet > D:\WebServer\backups\before_012.sql
-- ROLLBACK: none needed. Widening a column loses nothing, and narrowing it
--           again would only restore the fault.

-- Idempotent: only touched when the column is not already wide enough, so this
-- is safe to run against a database that was created correctly from
-- docs/schema.sql.
SET @needs_widening := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'login_attempts'
      AND COLUMN_NAME = 'kind'
      AND CHARACTER_MAXIMUM_LENGTH < 20
);
SET @sql := IF(@needs_widening = 1,
    'ALTER TABLE login_attempts MODIFY COLUMN kind VARCHAR(20) NOT NULL DEFAULT ''login''',
    'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Same class of drift, found while checking whether the one above was alone.
-- chain_free_validators.valoper is VARCHAR(120) in 004 and docs/schema.sql but
-- VARCHAR(80) on a database where the table predated that file. It is not
-- currently breaking anything - a valoper address is about 51-59 characters, so
-- 80 has been enough - but it is the same IF NOT EXISTS trap waiting on a chain
-- with a longer bech32 prefix, and widening costs nothing.
SET @needs_widening := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'chain_free_validators'
      AND COLUMN_NAME = 'valoper'
      AND CHARACTER_MAXIMUM_LENGTH < 120
);
SET @sql := IF(@needs_widening = 1,
    'ALTER TABLE chain_free_validators MODIFY COLUMN valoper VARCHAR(120) NOT NULL',
    'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- NOT changed here, on purpose: login_attempts.id is INT UNSIGNED on the same
-- deployments where docs/schema.sql says BIGINT UNSIGNED. Altering a
-- primary key rewrites the table, and the ceiling is ~4.3 billion rows against
-- a table that record_attempt() prunes daily, so the risk of the fix exceeds
-- the risk of the drift. Recorded here so it is known rather than forgotten.

INSERT INTO schema_version (version, applied_at)
VALUES (12, NOW())
ON DUPLICATE KEY UPDATE applied_at = VALUES(applied_at);
