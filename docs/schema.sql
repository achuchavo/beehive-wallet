-- Beehive Wallet database schema (MySQL).
-- Everything here is PUBLIC data - no keys, no seed material, ever.

CREATE DATABASE IF NOT EXISTS beehive_wallet CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE beehive_wallet;

CREATE TABLE users (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    email VARCHAR(190) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_admin TINYINT(1) NOT NULL DEFAULT 0,
    is_super_admin TINYINT(1) NOT NULL DEFAULT 0,
    is_disabled TINYINT(1) NOT NULL DEFAULT 0,
    main_address VARCHAR(120) NULL,
    -- Migration 006: an address only counts as a login identifier once its
    -- owner has proved control by signing a challenge.
    main_address_verified TINYINT(1) NOT NULL DEFAULT 0,
    -- Migration 009: redact wallet names and amounts from push bodies. New
    -- accounts default to private; migration 009 leaves existing users at 0.
    push_private TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_email (email),
    UNIQUE KEY uq_main_address (main_address)
) ENGINE = InnoDB;

-- Per-admin feature grants. Super admins implicitly have all features at write
-- level and never have rows here.
CREATE TABLE admin_permissions (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    feature VARCHAR(40) NOT NULL,
    -- Migration 010. 1 = read only, 2 = read and write. No row = no access.
    -- Ordered so the anti-escalation check is a numeric comparison.
    level TINYINT UNSIGNED NOT NULL DEFAULT 2,
    PRIMARY KEY (id),
    UNIQUE KEY uq_user_feature (user_id, feature),
    CONSTRAINT fk_perm_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Chain registry (admin-managed). Shared by the app, proxies, and watcher.
CREATE TABLE chains (
    chain_key VARCHAR(40) NOT NULL PRIMARY KEY,
    chain_id VARCHAR(60) NOT NULL,
    chain_name VARCHAR(80) NOT NULL,
    bech32_prefix VARCHAR(20) NOT NULL,
    denom VARCHAR(40) NOT NULL,
    display_denom VARCHAR(20) NOT NULL,
    decimals INT NOT NULL DEFAULT 6,
    coin_type INT NOT NULL DEFAULT 118,
    gas_price VARCHAR(40) NOT NULL,
    explorer_tx_url VARCHAR(200) NOT NULL DEFAULT '',
    explorer_validator_url VARCHAR(200) NOT NULL DEFAULT '',
    beehive_validator VARCHAR(80) NOT NULL DEFAULT '',
    beehive_moniker VARCHAR(80) NOT NULL DEFAULT '',
    -- Fee bundled into a delegation to a validator outside chain_free_validators,
    -- charged only under the 'allowlist_paid' policy. Base units, as a string.
    service_fee VARCHAR(40) NOT NULL DEFAULT '0',
    fee_collector VARCHAR(120) NOT NULL DEFAULT '',
    -- Migration 013. What this APP offers for staking:
    --   all             every validator, no fee (chain_free_validators ignored)
    --   allowlist       only the listed validators, at any price
    --   allowlist_paid  listed are free, others bundle service_fee
    -- Governs the app, not the chain: a delegation is a user-signed transaction,
    -- so nobody is stopped from staking elsewhere with another wallet.
    staking_policy VARCHAR(16) NOT NULL DEFAULT 'all',
    coingecko_id VARCHAR(60) NOT NULL DEFAULT '',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0
) ENGINE = InnoDB;

-- Multiple LCD/RPC endpoints per chain, tried in priority order (failover).
CREATE TABLE chain_endpoints (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    chain_key VARCHAR(40) NOT NULL,
    kind VARCHAR(10) NOT NULL,
    url VARCHAR(200) NOT NULL,
    priority INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    PRIMARY KEY (id),
    CONSTRAINT fk_endpoint_chain FOREIGN KEY (chain_key) REFERENCES chains (chain_key) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE watched_addresses (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    chain_key VARCHAR(40) NOT NULL,
    address VARCHAR(120) NOT NULL,
    label VARCHAR(80) NOT NULL DEFAULT '',
    alarm_enabled TINYINT(1) NOT NULL DEFAULT 1,
    -- Which transactions raise an alarm: sent | received | both | unbond.
    alarm_type VARCHAR(12) NOT NULL DEFAULT 'both',
    last_seen_tx_hash VARCHAR(80) NULL,
    last_seen_received_tx VARCHAR(80) NULL,
    last_seen_unbond_tx VARCHAR(80) NULL,
    last_checked_at DATETIME NULL,
    -- Migration 011: paid-alert entitlement. watch_payments is the source of
    -- truth; these are written in the same transaction and cached here because
    -- the watcher reads every row every cycle.
    -- free | paid. No third "grandfathered" state: a cap only gates the next
    -- add, so watches that predate one keep working and occupy free slots.
    tier VARCHAR(12) NOT NULL DEFAULT 'free',
    -- NULL for free watches and for perpetual one_time purchases.
    paid_until DATETIME NULL,
    -- active | lapsed. Lapsed is PAUSED, never deleted.
    payment_state VARCHAR(12) NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_user_chain_address (user_id, chain_key, address),
    KEY idx_chain (chain_key),
    KEY idx_tier_paid_until (tier, paid_until),
    CONSTRAINT fk_watched_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE wallet_alerts (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    watched_address_id INT UNSIGNED NOT NULL,
    -- What happened: sent | received | unbond.
    kind VARCHAR(12) NOT NULL DEFAULT 'sent',
    tx_hash VARCHAR(80) NOT NULL,
    amount VARCHAR(40) NOT NULL DEFAULT '',
    denom VARCHAR(40) NOT NULL DEFAULT '',
    recipient VARCHAR(120) NOT NULL DEFAULT '',
    detected_at DATETIME NOT NULL,
    is_read TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uq_address_tx (watched_address_id, tx_hash),
    KEY idx_detected (detected_at),
    CONSTRAINT fk_alert_watched FOREIGN KEY (watched_address_id)
        REFERENCES watched_addresses (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Admin-set site-wide banner. Latest active, non-expired row is shown.
CREATE TABLE announcements (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    message VARCHAR(300) NOT NULL,
    severity VARCHAR(10) NOT NULL DEFAULT 'info',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    expires_at DATETIME NULL,
    created_by INT UNSIGNED NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id)
) ENGINE = InnoDB;

-- Phase 2: web push subscriptions (one row per browser/device).
CREATE TABLE push_subscriptions (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    endpoint VARCHAR(500) NOT NULL,
    p256dh VARCHAR(200) NOT NULL,
    auth_key VARCHAR(100) NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_endpoint (endpoint(191)),
    CONSTRAINT fk_push_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Generic key/value settings (global feature flags, etc.).
CREATE TABLE app_settings (
    setting_key VARCHAR(60) NOT NULL,
    setting_value VARCHAR(255) NOT NULL DEFAULT '',
    updated_at DATETIME NULL,
    PRIMARY KEY (setting_key)
) ENGINE = InnoDB;

-- Validator uptime alert subscriptions (paid, admin-authorized).
CREATE TABLE uptime_subscriptions (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    chain_key VARCHAR(40) NOT NULL,
    validator_address VARCHAR(120) NOT NULL,
    moniker VARCHAR(120) NOT NULL DEFAULT '',
    status VARCHAR(12) NOT NULL DEFAULT 'pending',
    authorized_until DATETIME NULL,
    miss_threshold INT UNSIGNED NOT NULL DEFAULT 50,
    frequency_minutes INT UNSIGNED NOT NULL DEFAULT 360,
    snooze_until DATETIME NULL,
    last_missed INT UNSIGNED NOT NULL DEFAULT 0,
    last_down_state TINYINT(1) NOT NULL DEFAULT 0,
    last_alert_at DATETIME NULL,
    approved_by INT UNSIGNED NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_user_validator (user_id, chain_key, validator_address),
    KEY idx_status (status),
    CONSTRAINT fk_uptime_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Uptime notifications raised by the watcher.
CREATE TABLE uptime_alerts (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    subscription_id INT UNSIGNED NOT NULL,
    kind VARCHAR(12) NOT NULL DEFAULT 'down',
    missed_blocks INT UNSIGNED NOT NULL DEFAULT 0,
    detected_at DATETIME NOT NULL,
    is_read TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    KEY idx_detected (detected_at),
    CONSTRAINT fk_uptimealert_sub FOREIGN KEY (subscription_id)
        REFERENCES uptime_subscriptions (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- ===========================================================================
-- Added by migration 004 (second audit). Kept in sync with
-- docs/migrations/004_audit_findings.sql, which is the authoritative source
-- for an already-deployed database. This file is the fresh-install schema.
-- ===========================================================================

-- Login/registration rate limiting (common.php record_attempt).
CREATE TABLE login_attempts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    ip VARCHAR(45) NOT NULL,
    identifier VARCHAR(190) NOT NULL DEFAULT '',
    kind VARCHAR(20) NOT NULL DEFAULT 'login',
    success TINYINT(1) NOT NULL DEFAULT 0,
    attempted_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    KEY idx_ip_kind_time (ip, kind, success, attempted_at),
    KEY idx_identifier_kind_time (identifier, kind, success, attempted_at),
    KEY idx_attempted_at (attempted_at)
) ENGINE = InnoDB;

-- Validators exempt from the service fee (admin-managed).
CREATE TABLE chain_free_validators (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    chain_key VARCHAR(40) NOT NULL,
    valoper VARCHAR(120) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_chain_valoper (chain_key, valoper),
    KEY idx_chain (chain_key)
) ENGINE = InnoDB;

-- Shared fallback for proxy rate limiting when APCu is unavailable.
CREATE TABLE rate_counters (
    scope VARCHAR(64) NOT NULL,
    bucket INT UNSIGNED NOT NULL,
    hits INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (scope, bucket),
    KEY idx_bucket (bucket)
) ENGINE = InnoDB;

-- Audit trail for administrator account changes.
CREATE TABLE admin_audit_log (
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

-- Applied-migration marker.
CREATE TABLE schema_version (
    version INT UNSIGNED NOT NULL,
    applied_at DATETIME NOT NULL,
    PRIMARY KEY (version)
) ENGINE = InnoDB;

-- ===========================================================================
-- Added by migration 005 — address ownership proofs.
-- ===========================================================================

-- Single-use, short-lived challenges a user signs to prove they control an
-- address before it can be linked (main_address doubles as a login identifier).
CREATE TABLE address_challenges (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    address VARCHAR(120) NOT NULL,
    chain_key VARCHAR(40) NOT NULL,
    nonce CHAR(64) NOT NULL,
    action VARCHAR(32) NOT NULL DEFAULT 'link-address',
    -- Host the challenge was issued for, so a signature cannot be replayed
    -- against a different deployment of the same app.
    domain VARCHAR(190) NOT NULL DEFAULT '',
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_nonce (nonce),
    KEY idx_user_addr (user_id, address),
    KEY idx_expires (expires_at),
    CONSTRAINT fk_challenge_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- ===========================================================================
-- Added by migration 007 — persistent "remember me" tokens.
-- ===========================================================================

-- Selector + verifier. The selector finds the row; only a SHA-256 of the
-- verifier is stored, so a database leak yields no usable cookie. Every use
-- rotates the verifier, and the previous hash is honoured briefly so concurrent
-- requests carrying the same cookie are not mistaken for token theft.
CREATE TABLE remember_tokens (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    selector CHAR(32) NOT NULL,
    verifier_hash CHAR(64) NOT NULL,
    prev_verifier_hash CHAR(64) NULL,
    rotated_at DATETIME NULL,
    expires_at DATETIME NOT NULL,
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

-- ===========================================================================
-- Added by migration 011 — paid address alerts.
--
-- Still non-custodial: the user signs and broadcasts a normal transfer to an
-- admin-configured address, and the server only records that it VERIFIED that
-- transfer on chain. Nothing here holds funds or keys.
-- ===========================================================================

-- Per-chain pricing. NO ROW = unmetered (only the global watch_limit applies),
-- which is the shipped default - a chain is opted in deliberately.
CREATE TABLE chain_alert_pricing (
    chain_key VARCHAR(40) NOT NULL,
    alerts_enabled TINYINT(1) NOT NULL DEFAULT 1,
    -- Free allowance for THIS chain, counted per chain.
    free_cap INT UNSIGNED NOT NULL DEFAULT 2,
    -- BASE UNITS as a decimal string, never a number: 200 MED is '200000000'
    -- umed and an 18-decimal chain would overflow a 64-bit int.
    fee_amount VARCHAR(40) NOT NULL DEFAULT '0',
    -- Must equal chains.denom; matched against the transaction EXACTLY, so an
    -- IBC lookalike cannot pass as the real denom.
    fee_denom VARCHAR(40) NOT NULL DEFAULT '',
    -- Empty or invalid makes the paid tier UNAVAILABLE, never free.
    collect_address VARCHAR(120) NOT NULL DEFAULT '',
    -- one_time | weekly | monthly. A string so adding a cadence is an
    -- application change, not a migration.
    cadence VARCHAR(12) NOT NULL DEFAULT 'one_time',
    grace_days INT UNSIGNED NOT NULL DEFAULT 0,
    updated_by INT UNSIGNED NULL,
    updated_at DATETIME NULL,
    PRIMARY KEY (chain_key),
    CONSTRAINT fk_alertprice_chain FOREIGN KEY (chain_key)
        REFERENCES chains (chain_key) ON DELETE CASCADE
) ENGINE = InnoDB;

-- A locked quote plus the memo code that binds a payment to one account.
-- Transaction hashes are PUBLIC, so without that binding anyone could submit
-- another user's fee payment and consume it. The stored price also means an
-- admin edit cannot move a quote under someone mid-payment.
CREATE TABLE watch_payment_intents (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    chain_key VARCHAR(40) NOT NULL,
    kind VARCHAR(8) NOT NULL DEFAULT 'new',
    -- Advisory for kind='new' (the entitlement is per user+chain); enforced
    -- for kind='renew' via watch_id.
    address VARCHAR(120) NOT NULL DEFAULT '',
    watch_id INT UNSIGNED NULL,
    memo_code VARCHAR(24) NOT NULL,
    fee_amount VARCHAR(40) NOT NULL,
    fee_denom VARCHAR(40) NOT NULL,
    collect_address VARCHAR(120) NOT NULL,
    cadence VARCHAR(12) NOT NULL,
    expires_at DATETIME NOT NULL,
    consumed_at DATETIME NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_memo_code (memo_code),
    KEY idx_user_chain (user_id, chain_key),
    KEY idx_expires (expires_at),
    CONSTRAINT fk_intent_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Append-only ledger of verified payments.
CREATE TABLE watch_payments (
    -- Nullable + SET NULL: deleting an account must not erase the record that a
    -- transaction hash was already spent.
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NULL,
    chain_key VARCHAR(40) NOT NULL,
    tx_hash VARCHAR(80) NOT NULL,
    watched_address_id INT UNSIGNED NULL,
    -- What was actually received. Overpayment is kept, not credited.
    amount VARCHAR(40) NOT NULL,
    denom VARCHAR(40) NOT NULL,
    -- Snapshots, so a later admin edit cannot rewrite history.
    collect_address VARCHAR(120) NOT NULL,
    fee_amount VARCHAR(40) NOT NULL,
    cadence VARCHAR(12) NOT NULL,
    memo_code VARCHAR(24) NOT NULL DEFAULT '',
    paid_from VARCHAR(120) NOT NULL DEFAULT '',
    height BIGINT UNSIGNED NOT NULL DEFAULT 0,
    tx_time DATETIME NULL,
    period_start DATETIME NOT NULL,
    -- NULL = perpetual (one_time cadence).
    paid_until DATETIME NULL,
    verified_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    -- THE CONSUME. Deliberately NOT scoped by user_id - a per-user key would
    -- let two accounts each claim the same payment. It is also what makes
    -- verification race-free without locking: concurrent submits of one hash
    -- resolve to one INSERT winner and one duplicate-key error.
    UNIQUE KEY uq_chain_tx (chain_key, tx_hash),
    KEY idx_user (user_id),
    KEY idx_watch (watched_address_id),
    KEY idx_paid_until (paid_until),
    CONSTRAINT fk_payment_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_payment_watch FOREIGN KEY (watched_address_id)
        REFERENCES watched_addresses (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- This file is the FRESH-INSTALL snapshot and already contains every object
-- through migration 013, so a new database is stamped at 13 and no migration
-- needs to be replayed against it.
--
-- NOTE for 012: login_attempts.kind is VARCHAR(20) below, which is what
-- migration 012 exists to repair on databases where the table predated
-- migration 004 and was created narrower. A fresh install from this file is
-- already correct.
INSERT INTO schema_version (version, applied_at) VALUES (13, NOW());
