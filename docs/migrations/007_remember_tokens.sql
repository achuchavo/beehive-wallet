-- Migration 007 — persistent "remember me" tokens (audit #18).
--
-- Replaces the old approach, which simply disabled the idle timeout and gave
-- the PRIMARY session a 30-day lifetime: a stolen session id was then valid for
-- a month. Sessions now keep their normal short idle timeout, and a separate
-- long-lived token silently re-establishes one.
--
-- Design: selector + verifier.
--   cookie value = "<selector>:<verifier>"
--   selector  - 16 random bytes (hex), indexed, used ONLY to find the row
--   verifier  - 32 random bytes (hex), never stored; only its SHA-256 is kept
-- Looking up by selector avoids a timing side channel on the secret, and
-- storing only the hash means a database leak does not yield usable cookies.
--
-- Rotation: every successful use issues a fresh verifier. The previous hash is
-- retained for REMEMBER_GRACE_SECONDS so that concurrent requests carrying the
-- same (still valid) cookie are not mistaken for token theft — a browser
-- routinely fires several requests at once.
--
-- Theft detection: a known selector presented with a verifier matching neither
-- the current nor the grace hash means someone replayed a stolen or superseded
-- token, so EVERY token for that user is revoked.
--
-- Apply with a privileged user:
--   mysql -u chavo -p beehive_wallet < docs/migrations/007_remember_tokens.sql
--
-- BACK UP FIRST (outside the repo — dumps contain emails and password hashes):
--   mysqldump -u chavo -p beehive_wallet > D:\WebServer\backups\before_007.sql
-- ROLLBACK: DROP TABLE remember_tokens;  (holds only transient auth tokens —
--           dropping it just signs out anyone using "keep me signed in")
--           and reset schema_version to 6.

CREATE TABLE IF NOT EXISTS remember_tokens (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    -- Public half of the cookie; identifies the row without revealing anything.
    selector CHAR(32) NOT NULL,
    -- SHA-256 of the secret half. The secret itself is never stored.
    verifier_hash CHAR(64) NOT NULL,
    -- Previous verifier, honoured briefly after rotation so concurrent requests
    -- with the same cookie do not look like a replay.
    prev_verifier_hash CHAR(64) NULL,
    rotated_at DATETIME NULL,
    expires_at DATETIME NOT NULL,
    -- Device metadata, so a user/admin can tell sessions apart.
    user_agent VARCHAR(255) NOT NULL DEFAULT '',
    ip VARCHAR(45) NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL,
    last_used_at DATETIME NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_selector (selector),
    KEY idx_user (user_id),
    KEY idx_expires (expires_at),
    CONSTRAINT fk_remember_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

INSERT INTO schema_version (version, applied_at)
VALUES (7, NOW())
ON DUPLICATE KEY UPDATE applied_at = VALUES(applied_at);
