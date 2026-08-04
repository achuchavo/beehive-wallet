-- Migration 017 — the uptime window gets a baseline, so "missed blocks" means
-- missed RECENTLY, not ever.
--
-- 016 made the watcher judge recent signing by the counter's delta between
-- polls. That killed the stale-backlog re-alerts, but it made the opposite
-- mistake: with an old outage still holding the counter over the threshold,
-- a SINGLE newly missed block read as "down" - recovered at 10:26, down
-- again at 10:32, for one block. Occasional single misses are normal.
--
-- The unit of judgement is now a ~10-minute tumbling window (about 100
-- blocks): stable_since marks when the current window opened, and
-- window_start_missed records the counter at that moment. The subscription's
-- miss_threshold now means "this many blocks missed within the current
-- window" - i.e. per ~100 recent blocks - which is what it always looked
-- like it meant. Down fires when the window accumulates that many new
-- misses; recovered fires when a window closes with at most threshold/5 new
-- misses while the subscription was down. In between, silence.
--
-- Apply with a privileged user:
--   mysql -u chavo -p beehive_wallet < docs/migrations/017_uptime_window_baseline.sql
--
-- BACK UP FIRST (dumps contain emails and password hashes):
--   mysqldump -u chavo -p beehive_wallet > D:\WebServer\backups\before_017.sql
-- ROLLBACK: ALTER TABLE uptime_subscriptions DROP COLUMN window_start_missed;
--           and reset schema_version to 16. Nothing is lost - the column only
--           anchors the current measuring window.

ALTER TABLE uptime_subscriptions
    ADD COLUMN window_start_missed INT UNSIGNED NULL
        COMMENT 'missed_blocks_counter when the current measuring window (stable_since) opened'
        AFTER stable_since;

INSERT INTO schema_version (version, applied_at)
VALUES (17, NOW())
ON DUPLICATE KEY UPDATE applied_at = VALUES(applied_at);
