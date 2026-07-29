-- Migration 011 — paid address alerts (per-chain free cap + on-chain fee).
--
-- NON-CUSTODIAL, unchanged: nothing here holds funds or keys. A "payment" is a
-- normal transfer the USER signs and broadcasts to an address the admin
-- configured. All this schema does is record that the server VERIFIED such a
-- transfer on chain and which watch it unlocked.
--
-- Three tables rather than columns on `chains`:
--   * the whole feature rolls back by dropping three tables, leaving the chain
--     registry - and the audited admin_chain_save.php path - untouched;
--   * a consumed-payment ledger needs its own unique key to be race-free;
--   * an intent needs its own row to lock a quote and carry a memo code.
--
-- NO PRICING ROWS ARE INSERTED. A chain with no chain_alert_pricing row is
-- "unmetered", which is byte-for-byte today's behaviour (the global
-- app_settings.watch_limit still applies). Nobody is charged, capped or locked
-- out by applying this migration; the admin opts a chain in deliberately.
--
-- Apply with a privileged user:
--   mysql -u chavo -p beehive_wallet < docs/migrations/011_paid_address_alerts.sql
--
-- BACK UP FIRST (outside the repo — dumps contain emails and password hashes):
--   mysqldump -u chavo -p beehive_wallet > D:\WebServer\backups\before_011.sql
-- ROLLBACK: DROP TABLE watch_payments, watch_payment_intents, chain_alert_pricing;
--           ALTER TABLE watched_addresses
--               DROP COLUMN tier, DROP COLUMN paid_until, DROP COLUMN payment_state;
--           and reset schema_version to 10.
--           Every watch reverts to the free/unmetered behaviour and keeps
--           working. NOTE: this discards the record of which transaction
--           hashes have been consumed, so keep the dump above.

-- ---------------------------------------------------------------------------
-- Per-chain pricing. One row per chain, or no row at all (= unmetered).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chain_alert_pricing (
    chain_key VARCHAR(40) NOT NULL,
    -- Master switch for address alerts on this chain. 0 blocks NEW watches;
    -- it never deletes or hides the ones users already have.
    alerts_enabled TINYINT(1) NOT NULL DEFAULT 1,
    -- How many addresses a user may watch on THIS chain for free. Counted per
    -- chain, so a Medibloc cap does not consume a Chihuahua allowance.
    free_cap INT UNSIGNED NOT NULL DEFAULT 2,
    -- Fee in BASE UNITS as a decimal string, never a number: 200 MED is
    -- '200000000' umed, and an 18-decimal chain would overflow a 64-bit int.
    -- Compared with the string helpers in security_lib.php - no floats anywhere
    -- on the money path.
    fee_amount VARCHAR(40) NOT NULL DEFAULT '0',
    -- Must equal chains.denom for this chain; validated when the admin saves.
    -- Compared against the transaction with an EXACT string match, so an IBC
    -- lookalike denom cannot pass as the real one.
    fee_denom VARCHAR(40) NOT NULL DEFAULT '',
    -- Where the user sends the fee. If this is empty or not a valid bech32
    -- account for the chain, the paid tier is UNAVAILABLE - never free. Taking
    -- money to an address nobody controls is the one outcome worth failing on.
    collect_address VARCHAR(120) NOT NULL DEFAULT '',
    -- one_time | weekly | monthly. Deliberately a string, not an enum: adding
    -- 'quarterly' should be an application change, not a schema migration.
    cadence VARCHAR(12) NOT NULL DEFAULT 'one_time',
    -- Days a lapsed recurring watch keeps running after paid_until passes,
    -- before the watcher pauses it. 0 = pause immediately.
    grace_days INT UNSIGNED NOT NULL DEFAULT 0,
    updated_by INT UNSIGNED NULL,
    updated_at DATETIME NULL,
    PRIMARY KEY (chain_key),
    CONSTRAINT fk_alertprice_chain FOREIGN KEY (chain_key)
        REFERENCES chains (chain_key) ON DELETE CASCADE
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- Payment intents: a quote, locked, with the memo code that binds a payment to
-- one account.
-- ---------------------------------------------------------------------------
--
-- Two jobs, both load-bearing:
--
-- 1. THE MEMO CODE. Transaction hashes are PUBLIC. Without binding, anyone
--    watching the chain can see another user's fee payment and submit that hash
--    first - the unique key below would then hand them someone else's payment.
--    The code is issued to one account, so a third party cannot produce a
--    transaction carrying it. (watch_payment_submit.php also accepts a payment
--    whose SENDER is an address the user has already proved they control, for
--    the user who paid from their linked wallet and forgot the memo.)
--
-- 2. THE PRICE SNAPSHOT. The admin may change the fee while a user is paying.
--    Verification uses the price stored HERE, not the current row in
--    chain_alert_pricing, so a quote can never move under someone mid-payment.
CREATE TABLE IF NOT EXISTS watch_payment_intents (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    chain_key VARCHAR(40) NOT NULL,
    -- new = unlock an additional watch, renew = extend an existing one.
    kind VARCHAR(8) NOT NULL DEFAULT 'new',
    -- For kind='renew' this is enforced. For kind='new' the address is
    -- ADVISORY - it is what the quote was shown for, so support can see what
    -- someone meant to buy, but the entitlement is (user, chain) and a user who
    -- changes their mind about which address to watch is not made to pay twice.
    address VARCHAR(120) NOT NULL DEFAULT '',
    watch_id INT UNSIGNED NULL,
    -- What the user types (or the app prefills) in the transaction memo.
    -- Unique across all intents: a code identifies exactly one intent.
    memo_code VARCHAR(24) NOT NULL,
    -- Locked quote. See note 2 above.
    fee_amount VARCHAR(40) NOT NULL,
    fee_denom VARCHAR(40) NOT NULL,
    collect_address VARCHAR(120) NOT NULL,
    cadence VARCHAR(12) NOT NULL,
    -- A payment is only accepted if the transaction is NEWER than the intent.
    -- This is what stops someone digging up an old, unrelated transfer that
    -- happens to have gone to the collection address.
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

-- ---------------------------------------------------------------------------
-- The consumed-payment ledger. Append-only; one row per verified payment.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS watch_payments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    -- NULLABLE, and ON DELETE SET NULL rather than CASCADE. Deleting an account
    -- must not erase the record that a transaction hash was already spent -
    -- that record is the only thing making the unique key below permanent.
    user_id INT UNSIGNED NULL,
    chain_key VARCHAR(40) NOT NULL,
    -- Uppercase hex, canonicalised before insert.
    tx_hash VARCHAR(80) NOT NULL,
    -- What this payment unlocked. SET NULL if the user later removes the watch:
    -- the payment still happened and the hash must stay spent.
    watched_address_id INT UNSIGNED NULL,
    -- What was actually received (>= fee_amount; overpayment is kept, not
    -- credited or refunded - the UI says so before the user pays).
    amount VARCHAR(40) NOT NULL,
    denom VARCHAR(40) NOT NULL,
    -- Snapshots, so a later admin edit cannot rewrite history.
    collect_address VARCHAR(120) NOT NULL,
    fee_amount VARCHAR(40) NOT NULL,
    cadence VARCHAR(12) NOT NULL,
    memo_code VARCHAR(24) NOT NULL DEFAULT '',
    -- Sender, kept for support ("I paid from this wallet") and as the fallback
    -- binding when the memo was omitted.
    paid_from VARCHAR(120) NOT NULL DEFAULT '',
    height BIGINT UNSIGNED NOT NULL DEFAULT 0,
    tx_time DATETIME NULL,
    period_start DATETIME NOT NULL,
    -- NULL = perpetual (one_time cadence). Otherwise when this period ends.
    paid_until DATETIME NULL,
    verified_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    -- THE CONSUME. Scoped by chain (the same hash could in principle exist on
    -- two networks) and deliberately NOT by user_id: a per-user key would let
    -- two different accounts each claim the same payment, which is the exact
    -- thing this constraint exists to prevent. It is also what makes the
    -- verification path race-free without locking - two concurrent submits of
    -- one hash resolve to one INSERT winner and one duplicate-key error.
    UNIQUE KEY uq_chain_tx (chain_key, tx_hash),
    KEY idx_user (user_id),
    KEY idx_watch (watched_address_id),
    KEY idx_paid_until (paid_until),
    CONSTRAINT fk_payment_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_payment_watch FOREIGN KEY (watched_address_id)
        REFERENCES watched_addresses (id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- Entitlement cache on the watch itself.
-- ---------------------------------------------------------------------------
-- watch_payments stays the source of truth; these three columns are written in
-- the SAME transaction as the payment. They exist because the watcher reads
-- every watched_addresses row every 30 seconds and the admin view lists status
-- per watch - a per-row join on the ledger each cycle is avoidable work.
--
-- MySQL has no "ADD COLUMN IF NOT EXISTS", so each is guarded dynamically to
-- stay idempotent (same idiom as 004 and 006).

-- tier: free | paid.
--
-- There is deliberately no third "grandfathered" state. Introducing or
-- lowering a cap only ever gates the NEXT add - existing rows are never
-- touched, and anything not explicitly paid occupies a free slot. A user
-- already over a new cap therefore keeps every watch they have and simply has
-- no spare slots, with no backfill pass and nothing switched off.
SET @col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'watched_addresses'
      AND COLUMN_NAME = 'tier'
);
SET @sql := IF(@col = 0,
    'ALTER TABLE watched_addresses ADD COLUMN tier VARCHAR(12) NOT NULL DEFAULT ''free''
     COMMENT ''free | paid''',
    'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- NULL for free watches and for perpetual one_time purchases.
SET @col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'watched_addresses'
      AND COLUMN_NAME = 'paid_until'
);
SET @sql := IF(@col = 0,
    'ALTER TABLE watched_addresses ADD COLUMN paid_until DATETIME NULL',
    'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- active | lapsed. A lapsed watch is PAUSED, never deleted: the address, label
-- and alert history survive, the watcher simply stops raising alerts for it,
-- and the user is offered a renewal.
SET @col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'watched_addresses'
      AND COLUMN_NAME = 'payment_state'
);
SET @sql := IF(@col = 0,
    'ALTER TABLE watched_addresses ADD COLUMN payment_state VARCHAR(12) NOT NULL DEFAULT ''active''
     COMMENT ''active | lapsed''',
    'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Index for the watcher's per-cycle lapse sweep.
SET @idx := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'watched_addresses'
      AND INDEX_NAME = 'idx_tier_paid_until'
);
SET @sql := IF(@idx = 0,
    'ALTER TABLE watched_addresses ADD KEY idx_tier_paid_until (tier, paid_until)',
    'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Every watch that exists BEFORE pricing is configured is free and stays free.
-- Re-running this is harmless: it only ever touches rows still at the default.
UPDATE watched_addresses
SET tier = 'free', paid_until = NULL, payment_state = 'active'
WHERE tier NOT IN ('free', 'paid');

INSERT INTO schema_version (version, applied_at)
VALUES (11, NOW())
ON DUPLICATE KEY UPDATE applied_at = VALUES(applied_at);
