-- Migration 009 — private push notifications (audit #13).
--
-- Push alerts currently put the wallet LABEL and the exact AMOUNT into the
-- notification body, e.g. "1250.5 MED left Savings wallet". On a phone that is
-- rendered on the lock screen, readable by anyone holding the device without
-- unlocking it - a balance-movement and holdings disclosure to shoulder
-- surfers, and a targeting signal.
--
-- push_private = 1 replaces the body with a generic one that names no wallet
-- and no amount. The alert list inside the app is unchanged; only what leaves
-- the server for the push service is redacted.
--
-- DEFAULT: 1 (private).
--
-- Existing rows are deliberately backfilled to 0, NOT 1. Anyone who already
-- enabled push chose it under the current behaviour, and silently making their
-- notifications less informative is a surprise change to something they set up
-- on purpose. New accounts get the safer default; existing users can opt in
-- from Alarms. If you would rather be strict than continuous, run:
--   UPDATE users SET push_private = 1;
--
-- Apply with a privileged user:
--   mysql -u chavo -p beehive_wallet < docs/migrations/009_push_privacy.sql
--
-- BACK UP FIRST (dumps contain emails and password hashes):
--   mysqldump -u chavo -p beehive_wallet > D:\WebServer\backups\before_009.sql
-- ROLLBACK: ALTER TABLE users DROP COLUMN push_private;  and set schema_version to 8.
--           No data is lost - the column only affects notification wording.

ALTER TABLE users
    ADD COLUMN push_private TINYINT(1) NOT NULL DEFAULT 1
    COMMENT 'Redact wallet names and amounts from push notification bodies';

-- Preserve the behaviour existing users already opted into. See above.
UPDATE users SET push_private = 0 WHERE created_at < NOW();

INSERT INTO schema_version (version, applied_at)
VALUES (9, NOW())
ON DUPLICATE KEY UPDATE applied_at = VALUES(applied_at);
