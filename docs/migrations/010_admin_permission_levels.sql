-- Migration 010 — per-feature READ / READ+WRITE admin grants.
--
-- Until now admin_permissions was pure membership: a row for (user, feature)
-- meant FULL access to that feature, and there was no way to let someone see
-- the chain registry or the uptime queue without also letting them change it.
--
-- `level` makes the grant ordered rather than boolean:
--     0  none   (no row is the normal way to express this)
--     1  read    can view the feature's data, every mutation refused
--     2  write   read + mutate (what a row has always meant)
--
-- Ordered on purpose. The anti-escalation rule in admin_role_update.php is a
-- numeric comparison - an admin may never grant a level above their own - and
-- that is far harder to get subtly wrong than a set of string cases.
--
-- DEFAULT: 2. Every existing row therefore keeps EXACTLY the access it has
-- today; this migration takes nothing away from anyone. The matching PHP
-- change is deliberately shaped the same way: require_permission()'s $need
-- defaults to PERM_WRITE, so every pre-existing call site keeps its current
-- meaning and no endpoint can be silently weakened by the refactor.
--
-- Super admins are unaffected: they never had rows here. admin_context()
-- synthesises write on every feature for them.
--
-- Apply with a privileged user:
--   mysql -u chavo -p beehive_wallet < docs/migrations/010_admin_permission_levels.sql
--
-- BACK UP FIRST (outside the repo — dumps contain emails and password hashes):
--   mysqldump -u chavo -p beehive_wallet > D:\WebServer\backups\before_010.sql
-- ROLLBACK: ALTER TABLE admin_permissions DROP COLUMN level;  and reset
--           schema_version to 9. No grant is lost - dropping the column
--           returns every row to its historical "full access" meaning.

-- MySQL has no "ADD COLUMN IF NOT EXISTS", so this is guarded dynamically to
-- stay idempotent (same idiom as 004 and 006).
SET @col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'admin_permissions'
      AND COLUMN_NAME = 'level'
);
SET @sql := IF(@col = 0,
    'ALTER TABLE admin_permissions ADD COLUMN level TINYINT UNSIGNED NOT NULL DEFAULT 2
     COMMENT ''1 = read only, 2 = read and write''',
    'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Belt and braces for a re-run against rows written before the default existed,
-- and a repair for any junk value: an out-of-range level must not be read as
-- "more than write". Levels are also clamped on READ in PHP for the same
-- reason watch_limit() clamps there - this table is editable by anyone with
-- database access, and the application must not trust it blindly.
UPDATE admin_permissions SET level = 2 WHERE level NOT IN (1, 2);

INSERT INTO schema_version (version, applied_at)
VALUES (10, NOW())
ON DUPLICATE KEY UPDATE applied_at = VALUES(applied_at);
