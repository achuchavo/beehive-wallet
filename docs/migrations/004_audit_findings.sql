-- Migration 004 — schema completeness + tables required by the second audit.
--
-- Forward-only and idempotent where MySQL allows it. Nothing here drops or
-- rewrites existing data. Apply with a privileged user (the app user is
-- DML-only and cannot run DDL):
--
--   mysql -u chavo -p beehive_wallet < docs/migrations/004_audit_findings.sql
--
-- BACK UP FIRST:  mysqldump -u chavo -p beehive_wallet > backup_before_004.sql
-- ROLLBACK: restore that dump. The CREATE TABLEs below can also simply be
-- dropped (they hold only transient/audit data), but do NOT drop columns added
-- to `chains` without checking the app version first.

-- ---------------------------------------------------------------------------
-- 1. login_attempts — used by common.php (record_attempt / count_recent_failures)
--    for login + registration rate limiting, and by admin_overview.php.
--    Was missing from schema.sql entirely, so a fresh install broke on login.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_attempts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    ip VARCHAR(45) NOT NULL,
    identifier VARCHAR(190) NOT NULL DEFAULT '',
    kind VARCHAR(20) NOT NULL DEFAULT 'login',
    success TINYINT(1) NOT NULL DEFAULT 0,
    attempted_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    -- Supports count_recent_failures() on both columns without a scan.
    KEY idx_ip_kind_time (ip, kind, success, attempted_at),
    KEY idx_identifier_kind_time (identifier, kind, success, attempted_at),
    KEY idx_attempted_at (attempted_at)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- 2. chain_free_validators — validators that carry no service fee, managed by
--    admin_free_validator_add/remove.php.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chain_free_validators (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    chain_key VARCHAR(40) NOT NULL,
    valoper VARCHAR(120) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_chain_valoper (chain_key, valoper),
    KEY idx_chain (chain_key)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- 3. chains.coingecko_id — price lookup id, read by the app/price endpoint.
--    MySQL has no "ADD COLUMN IF NOT EXISTS", so this is guarded dynamically.
-- ---------------------------------------------------------------------------
SET @col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chains' AND COLUMN_NAME = 'coingecko_id'
);
SET @sql := IF(@col = 0,
    'ALTER TABLE chains ADD COLUMN coingecko_id VARCHAR(60) NOT NULL DEFAULT ''''',
    'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- 4. rate_counters — shared fallback for the proxy rate limiter when APCu is
--    unavailable (audit #4). The live PHP runtime has no APCu, so without this
--    table proxy rate limiting was effectively disabled.
--    `scope` is 'all' or 'ip_<addr>'; `bucket` is floor(unixtime/60).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_counters (
    scope VARCHAR(64) NOT NULL,
    bucket INT UNSIGNED NOT NULL,
    hits INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (scope, bucket),
    -- Lets the opportunistic pruner delete old buckets cheaply.
    KEY idx_bucket (bucket)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- 5. admin_audit_log — trail for administrator account changes (audit #1).
--    Writes are best-effort: audit_admin_action() logs to the PHP error log if
--    this table is absent, so the app keeps working before this migration runs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    actor_user_id INT UNSIGNED NULL,
    target_user_id INT UNSIGNED NULL,
    action VARCHAR(40) NOT NULL,
    detail VARCHAR(255) NOT NULL DEFAULT '',
    ip VARCHAR(45) NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    KEY idx_actor (actor_user_id),
    KEY idx_target (target_user_id),
    KEY idx_created (created_at)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- 6. schema_version — lets the app detect an under-migrated database.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_version (
    version INT UNSIGNED NOT NULL,
    applied_at DATETIME NOT NULL,
    PRIMARY KEY (version)
) ENGINE = InnoDB;

INSERT INTO schema_version (version, applied_at)
VALUES (4, NOW())
ON DUPLICATE KEY UPDATE applied_at = VALUES(applied_at);
