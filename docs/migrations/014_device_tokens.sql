-- Migration 014 — device tokens for the native iOS/Android apps.
--
-- WHY A NEW CREDENTIAL AT ALL
-- The native shell runs the same web bundle inside a WebView, but the WebView's
-- origin is https://localhost (Android) or capacitor://localhost (iOS) — it can
-- never be the API's own origin, because Capacitor's local server claims every
-- path on whatever host it is given. So every API call from the app is
-- cross-origin, and neither cookie survives that: the session cookie is
-- SameSite=Strict and the "remember me" cookie is Lax.
--
-- Rather than loosen those (which would weaken CSRF protection for the web),
-- native clients present a bearer token in an Authorization header. A header
-- credential is not ambient — no third-party page can attach it — so the
-- same-origin gate that protects the cookie path is simply not needed on the
-- token path. The two paths stay independent; the web's posture is unchanged.
--
-- Design: selector + verifier, exactly as migration 007 established.
--   token value = "bh1_<selector>.<verifier>"
--   selector  - 16 random bytes (hex), indexed, used ONLY to find the row
--   verifier  - 32 random bytes (hex), never stored; only its SHA-256 is kept
-- The bh1_ prefix makes a leaked token recognisable in a log and leaves room to
-- version the scheme.
--
-- DELIBERATE DIFFERENCE FROM remember_tokens: no rotation.
-- remember_tokens rotates its verifier on every use because a cookie can be
-- lifted off disk and replayed, and rotation turns a replay into a detectable
-- event. A device token lives in the iOS Keychain / Android Keystore instead,
-- where rotation buys much less — if that store is readable the attacker has
-- the device — while costing a real lockout path: a dropped response leaves the
-- client holding a verifier the server has already replaced. The controls here
-- are hardware-backed storage, a sliding expiry, and revocability.
--
-- SCOPE: these tokens are NOT admin-capable. admin_context() returns no
-- privileges for a bearer-authenticated request, so a stolen device token
-- cannot reach the admin surface. Administration happens on the web.
--
-- NOT A WALLET CREDENTIAL. This authenticates to the alarm/watcher backend
-- only. It cannot move funds, cannot decrypt a seed phrase, and never touches
-- key material — the server still stores no private keys of any kind.
--
-- Apply with a privileged user:
--   mysql -u chavo -p beehive_wallet < docs/migrations/014_device_tokens.sql
--
-- BACK UP FIRST (outside the repo — dumps contain emails and password hashes):
--   mysqldump -u chavo -p beehive_wallet > D:\WebServer\backups\before_014.sql
-- ROLLBACK: DROP TABLE device_tokens;  (holds only transient auth tokens —
--           dropping it just signs out the mobile apps) and reset
--           schema_version to 13.

CREATE TABLE IF NOT EXISTS device_tokens (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    -- Public half of the token; identifies the row without revealing anything.
    selector CHAR(32) NOT NULL,
    -- SHA-256 of the secret half. The secret itself is never stored.
    verifier_hash CHAR(64) NOT NULL,
    -- Which app presented it. Recorded so a future "Devices" screen can name
    -- the entries, and so push registration can be tied to a device row.
    platform ENUM('ios', 'android') NOT NULL,
    -- User-recognisable label ("Pixel 8"), best effort from the client.
    device_name VARCHAR(64) NOT NULL DEFAULT '',
    app_version VARCHAR(32) NOT NULL DEFAULT '',
    -- Sliding: pushed forward on each use, so an app opened monthly stays
    -- signed in while one abandoned for a quarter has to re-authenticate.
    expires_at DATETIME NOT NULL,
    ip VARCHAR(45) NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL,
    last_used_at DATETIME NULL,
    -- Set instead of deleting, so a revoked token can be told apart from one
    -- that never existed when investigating.
    revoked_at DATETIME NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_selector (selector),
    KEY idx_user (user_id),
    KEY idx_expires (expires_at),
    CONSTRAINT fk_device_token_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

INSERT INTO schema_version (version, applied_at)
VALUES (14, NOW())
ON DUPLICATE KEY UPDATE applied_at = VALUES(applied_at);
