-- Validator uptime alerts: paid (admin-authorized), super-admin gated,
-- missed-block early warning via the slashing signing_infos endpoint.

-- Generic key/value settings (global feature flags, etc.).
CREATE TABLE IF NOT EXISTS app_settings (
    setting_key VARCHAR(60) NOT NULL,
    setting_value VARCHAR(255) NOT NULL DEFAULT '',
    updated_at DATETIME NULL,
    PRIMARY KEY (setting_key)
) ENGINE = InnoDB;

-- Feature off until a super admin turns it on.
INSERT IGNORE INTO app_settings (setting_key, setting_value, updated_at)
VALUES ('uptime_alerts_enabled', '0', NOW());

-- One row per user+validator the user asked to monitor.
CREATE TABLE IF NOT EXISTS uptime_subscriptions (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    chain_key VARCHAR(40) NOT NULL,
    validator_address VARCHAR(120) NOT NULL,      -- valoper...
    moniker VARCHAR(120) NOT NULL DEFAULT '',
    status VARCHAR(12) NOT NULL DEFAULT 'pending', -- pending | approved | denied
    authorized_until DATETIME NULL,                -- NULL = indefinite (when approved)
    miss_threshold INT UNSIGNED NOT NULL DEFAULT 50,   -- missed blocks that count as "down"
    frequency_minutes INT UNSIGNED NOT NULL DEFAULT 360, -- re-alert cadence while down
    snooze_until DATETIME NULL,
    last_missed INT UNSIGNED NOT NULL DEFAULT 0,   -- last observed missed_blocks_counter
    last_down_state TINYINT(1) NOT NULL DEFAULT 0, -- 1 = was down at last check
    last_alert_at DATETIME NULL,
    approved_by INT UNSIGNED NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_user_validator (user_id, chain_key, validator_address),
    KEY idx_status (status),
    CONSTRAINT fk_uptime_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Uptime notifications raised by the watcher.
CREATE TABLE IF NOT EXISTS uptime_alerts (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    subscription_id INT UNSIGNED NOT NULL,
    kind VARCHAR(12) NOT NULL DEFAULT 'down',      -- down | recovered
    missed_blocks INT UNSIGNED NOT NULL DEFAULT 0,
    detected_at DATETIME NOT NULL,
    is_read TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    KEY idx_detected (detected_at),
    CONSTRAINT fk_uptimealert_sub FOREIGN KEY (subscription_id)
        REFERENCES uptime_subscriptions (id) ON DELETE CASCADE
) ENGINE = InnoDB;
