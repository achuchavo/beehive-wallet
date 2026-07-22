-- Migration 008 — add the Chihuahua (HUAHUA) chain.
--
-- Second supported chain after Medibloc. Chosen over Osmosis because Osmosis
-- holds balances outside x/bank and x/staking (LP positions, concentrated
-- liquidity, superfluid staking): the wallet would silently understate a
-- pooled user's total, which is exactly the failure mode this codebase is
-- built to avoid. Chihuahua is vanilla Cosmos SDK, so what we query IS what
-- the user owns.
--
-- Every value below was verified against the live chain or the Cosmos
-- chain-registry on 2026-07-23, not assumed:
--   chain_id        chihuahua-1     (confirmed via /status on 4 RPC nodes)
--   bech32_prefix   chihuahua
--   denom           uhuahua, 6 decimals, display HUAHUA
--   coin_type       118             (standard; Medibloc's 371 is the outlier)
--   coingecko_id    chihuahua-token (verified through api/price.php -> KRW)
--
-- gas_price = 500uhuahua. The registry lists low/average/high as
-- 500/1250/2000, and a sample of 40 recent MsgDelegate transactions paid
-- either 500 (22) or 1250 (18) — so 500 is demonstrably accepted on chain and
-- is the honest value for the app's "Low" tier, which is labelled as the
-- network minimum. The Send page's speed multipliers (1x/1.5x/2x) then give
-- 500 / 750 / 1000 uhuahua per gas unit.
--
-- NOTE: beehive_validator and fee_collector are intentionally EMPTY. We do not
-- run a validator on Chihuahua yet. This degrades safely and deliberately:
--   - serviceFeeActive() is false while fee_collector is '', so no service fee
--     is bundled into any delegation;
--   - isFree() matches nothing, so the validator list sorts purely by stake;
--   - the dashboard CTA falls back to "Start staking" instead of advertising a
--     Beehive validator that does not exist on this chain.
-- Fill both in (plus chain_free_validators) once a validator is running.
--
-- Endpoints: publicnode was excluded on purpose — https://chihuahua-rest.
-- publicnode.com returns 403 to the proxy's requests. The rest answered 200
-- with bond_denom=uhuahua and no redirects, which matters because proxy_fetch
-- pins the connection to pre-validated IPs and refuses to follow redirects.
--
-- Apply with a privileged user:
--   mysql -u chavo -p beehive_wallet < docs/migrations/008_chihuahua_chain.sql
--
-- BACK UP FIRST (outside the repo — dumps contain emails and password hashes):
--   mysqldump -u chavo -p beehive_wallet > D:\WebServer\backups\before_008.sql
-- ROLLBACK:
--   DELETE FROM chain_endpoints WHERE chain_key = 'chihuahua';
--   DELETE FROM chains WHERE chain_key = 'chihuahua';
--   and reset schema_version to 7.
-- Existing Medibloc wallets and balances are untouched either way — this
-- migration only inserts new rows.

-- Append after whatever is already configured, so Medibloc keeps sort_order 0
-- and therefore stays CHAINS[0] / DEFAULT_CHAIN in the frontend.
SET @next_order := (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM chains);

INSERT IGNORE INTO chains (
    chain_key, chain_id, chain_name, bech32_prefix,
    denom, display_denom, decimals, coin_type, gas_price,
    explorer_tx_url, explorer_validator_url,
    beehive_validator, beehive_moniker,
    service_fee, fee_collector,
    coingecko_id, is_active, sort_order
) VALUES (
    'chihuahua', 'chihuahua-1', 'Chihuahua', 'chihuahua',
    'uhuahua', 'HUAHUA', 6, 118, '500uhuahua',
    -- Mintscan uses /transactions/ for this chain, not /tx/ as Medibloc does.
    'https://www.mintscan.io/chihuahua/transactions/',
    'https://www.mintscan.io/chihuahua/validators/',
    '', '',
    '0', '',
    'chihuahua-token', 1, @next_order
);

-- Idempotent: re-running replaces only this chain's endpoints. (An endpoint an
-- admin added through the UI afterwards would be dropped by a re-run, so treat
-- this migration as one-shot once the chain is live.)
DELETE FROM chain_endpoints WHERE chain_key = 'chihuahua';

INSERT INTO chain_endpoints (chain_key, kind, url, priority, is_active) VALUES
    ('chihuahua', 'lcd', 'https://api.chihuahua.wtf',              0, 1),
    ('chihuahua', 'lcd', 'https://chihuahua-api.polkachu.com',     1, 1),
    ('chihuahua', 'lcd', 'https://chihuahua-api.kleomedes.network', 2, 1),
    ('chihuahua', 'rpc', 'https://rpc.chihuahua.wtf',              0, 1),
    ('chihuahua', 'rpc', 'https://chihuahua-rpc.polkachu.com',     1, 1),
    ('chihuahua', 'rpc', 'https://chihuahua-rpc.kleomedes.network', 2, 1),
    ('chihuahua', 'rpc', 'https://rpc.chihuahua.validatus.com',    3, 1);

INSERT INTO schema_version (version, applied_at)
VALUES (8, NOW())
ON DUPLICATE KEY UPDATE applied_at = VALUES(applied_at);
