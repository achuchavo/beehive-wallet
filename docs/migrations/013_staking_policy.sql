-- Migration 013 — per-chain staking policy.
--
-- Until now every validator on a chain was stakeable through the app, and the
-- only lever was money: validators in chain_free_validators cost nothing to
-- delegate to, everything else bundled chains.service_fee. There was no way to
-- say "only these validators, full stop".
--
-- staking_policy adds that third position:
--
--   all             every validator, no fee. chain_free_validators is ignored.
--   allowlist       ONLY the validators in chain_free_validators. Anything else
--                   is not offered for delegation at all, at any price.
--   allowlist_paid  the listed validators are free; any other validator can
--                   still be delegated to, but the delegation bundles
--                   service_fee to fee_collector.
--
-- 'allowlist_paid' is exactly what the app did before this migration, so the
-- backfill below chooses it for any chain that already had a fee configured and
-- 'all' for the rest. Nobody's behaviour changes on apply.
--
-- SCOPE, stated plainly because it is easy to assume otherwise: this restricts
-- what BEEHIVE offers. A delegation is a transaction the user signs and
-- broadcasts to the chain, so nothing here can stop someone staking wherever
-- they like from another wallet or a block explorer. It governs this app's UI
-- and the fee it bundles - not the chain.
--
-- Apply with a privileged user:
--   mysql -u chavo -p beehive_wallet < docs/migrations/013_staking_policy.sql
--
-- BACK UP FIRST (outside the repo — dumps contain emails and password hashes):
--   mysqldump -u chavo -p beehive_wallet > D:\WebServer\backups\before_013.sql
-- ROLLBACK: ALTER TABLE chains DROP COLUMN staking_policy;  and reset
--           schema_version to 12. Every chain returns to "all validators
--           stakeable, fee outside the free list", which is today's behaviour.

-- MySQL has no "ADD COLUMN IF NOT EXISTS", so this is guarded dynamically to
-- stay idempotent (same idiom as 004, 006, 010 and 011).
SET @col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'chains'
      AND COLUMN_NAME = 'staking_policy'
);
SET @sql := IF(@col = 0,
    'ALTER TABLE chains ADD COLUMN staking_policy VARCHAR(16) NOT NULL DEFAULT ''all''
     COMMENT ''all | allowlist | allowlist_paid''',
    'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Preserve current behaviour exactly. A chain with a real fee AND somewhere to
-- send it was already running the "free list, everyone else pays" rule, so it
-- is recorded as such rather than silently losing its fee.
--
-- Only rows still at the column default are touched, so re-running this cannot
-- overwrite a policy an admin has since chosen.
UPDATE chains
SET staking_policy = 'allowlist_paid'
WHERE staking_policy = 'all'
  AND service_fee <> ''
  AND service_fee <> '0'
  AND fee_collector <> '';

-- Repair any value this build does not understand. Fails towards 'all' - the
-- permissive option - because a junk policy must not silently stop users
-- delegating to validators they were previously able to reach.
UPDATE chains
SET staking_policy = 'all'
WHERE staking_policy NOT IN ('all', 'allowlist', 'allowlist_paid');

INSERT INTO schema_version (version, applied_at)
VALUES (13, NOW())
ON DUPLICATE KEY UPDATE applied_at = VALUES(applied_at);
