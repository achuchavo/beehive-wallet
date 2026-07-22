-- Migration 005 — address ownership proof (audit #19).
--
-- Adds the single-use, short-lived challenges that a user must sign with their
-- wallet key before an address can be linked to their account. Before this,
-- account_set_address.php accepted any well-formed address, which mattered
-- because main_address doubles as a LOGIN IDENTIFIER (login.php matches
-- `email = ? OR main_address = ?`) and is UNIQUE — so an unverified claim let
-- an attacker both squat a victim's address and turn it into their own handle.
--
-- Apply with a privileged user:
--   mysql -u chavo -p beehive_wallet < docs/migrations/005_address_ownership.sql
--
-- BACK UP FIRST (outside the repo — dumps contain emails and password hashes):
--   mysqldump -u chavo -p beehive_wallet > D:\WebServer\backups\before_005.sql
-- ROLLBACK: DROP TABLE address_challenges;  (it holds only transient nonces)
--           and reset schema_version to 4.

CREATE TABLE IF NOT EXISTS address_challenges (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    -- The address the nonce is bound to. A signature is only ever accepted for
    -- the exact (user, address, action, nonce) tuple it was issued for.
    address VARCHAR(120) NOT NULL,
    chain_key VARCHAR(40) NOT NULL,
    -- 32 random bytes, hex encoded.
    nonce CHAR(64) NOT NULL,
    action VARCHAR(32) NOT NULL DEFAULT 'link-address',
    -- Host the challenge was issued for, so the signed text cannot be replayed
    -- against a different deployment of the same app.
    domain VARCHAR(190) NOT NULL DEFAULT '',
    expires_at DATETIME NOT NULL,
    -- Set the moment a challenge is redeemed; a used nonce is never accepted
    -- again, which is what makes this single-use.
    used_at DATETIME NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_nonce (nonce),
    KEY idx_user_addr (user_id, address),
    KEY idx_expires (expires_at),
    CONSTRAINT fk_challenge_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

INSERT INTO schema_version (version, applied_at)
VALUES (5, NOW())
ON DUPLICATE KEY UPDATE applied_at = VALUES(applied_at);
