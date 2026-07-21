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
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_email (email),
    UNIQUE KEY uq_main_address (main_address)
) ENGINE = InnoDB;

-- Per-admin feature grants. Super admins implicitly have all features.
CREATE TABLE admin_permissions (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    feature VARCHAR(40) NOT NULL,
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
    service_fee VARCHAR(40) NOT NULL DEFAULT '0',
    fee_collector VARCHAR(120) NOT NULL DEFAULT '',
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
    last_seen_tx_hash VARCHAR(80) NULL,
    last_checked_at DATETIME NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_user_chain_address (user_id, chain_key, address),
    KEY idx_chain (chain_key),
    CONSTRAINT fk_watched_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE wallet_alerts (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    watched_address_id INT UNSIGNED NOT NULL,
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
