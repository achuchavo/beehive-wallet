-- Migration 016 — uptime alerts judge RECENT signing, not the whole window.
--
-- missed_blocks_counter is a sliding window over the chain's entire
-- signed_blocks_window (thousands of blocks), so after an outage it stays
-- above the miss threshold for many hours while the validator is already
-- signing perfectly again. The watcher kept re-alerting "missing blocks" on
-- that stale history, and the recovery alert - which waited for the counter
-- to drain - never came.
--
-- The watcher now uses the counter's DELTA between polls: an increase means
-- blocks were missed since the last poll (actively down), no increase means
-- everything since the last poll was signed. Recovery fires once there have
-- been no new misses for ~100 blocks' worth of time; stable_since records
-- when that quiet streak started. NULL = no streak in progress.
--
-- Apply with a privileged user:
--   mysql -u chavo -p beehive_wallet < docs/migrations/016_uptime_recent_window.sql
--
-- BACK UP FIRST (dumps contain emails and password hashes):
--   mysqldump -u chavo -p beehive_wallet > D:\WebServer\backups\before_016.sql
-- ROLLBACK: ALTER TABLE uptime_subscriptions DROP COLUMN stable_since;
--           and reset schema_version to 15. Nothing is lost - the column only
--           times a pending recovery alert.

ALTER TABLE uptime_subscriptions
    ADD COLUMN stable_since DATETIME NULL
        COMMENT 'Start of the current no-new-missed-blocks streak while down; NULL = none'
        AFTER last_alert_at;

INSERT INTO schema_version (version, applied_at)
VALUES (16, NOW())
ON DUPLICATE KEY UPDATE applied_at = VALUES(applied_at);
