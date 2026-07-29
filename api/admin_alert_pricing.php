<?php
// Per-chain address-alert pricing, for the admin screen. Read-only.
//
// Every chain is returned, including the ones with no pricing row - "not
// configured" is a state the admin needs to see and act on, and omitting those
// chains would make them look as though they did not exist.
require __DIR__ . '/common.php';
require_once __DIR__ . '/watch_billing.php';

$db = get_db();
require_permission($db, 'alert_pricing', PERM_READ);

$chains = $db->query(
    'SELECT chain_key, chain_name, denom, display_denom, decimals, bech32_prefix, is_active
     FROM chains ORDER BY sort_order, chain_name'
)->fetchAll();

$pricingRows = [];
foreach ($db->query('SELECT * FROM chain_alert_pricing')->fetchAll() as $row) {
    $pricingRows[$row['chain_key']] = $row;
}

// Counts per chain, so the admin can see what a cap change would land on before
// making it. free/grandfathered vs paid, and how many paid ones have lapsed.
$counts = [];
foreach ($db->query(
    "SELECT chain_key,
            SUM(tier <> 'paid') AS free_count,
            SUM(tier = 'paid') AS paid_count,
            SUM(tier = 'paid' AND paid_until IS NOT NULL AND paid_until < NOW()) AS lapsed_count,
            COUNT(*) AS total
     FROM watched_addresses GROUP BY chain_key"
)->fetchAll() as $row) {
    $counts[$row['chain_key']] = [
        'free' => (int) $row['free_count'],
        'paid' => (int) $row['paid_count'],
        'lapsed' => (int) $row['lapsed_count'],
        'total' => (int) $row['total'],
    ];
}

$out = [];
foreach ($chains as $chain) {
    $key = $chain['chain_key'];
    $row = $pricingRows[$key] ?? null;

    // The same normalisation the enforcement path applies, so the screen shows
    // what will actually happen rather than the raw stored value.
    $normalised = alert_pricing($db, $key);

    // chain_config() answers only for ACTIVE chains; the admin screen lists
    // inactive ones too, so build the shape pricing_sellable() needs directly.
    $chainShape = ['denom' => $chain['denom'], 'bech32Prefix' => $chain['bech32_prefix']];

    $out[] = [
        'chain_key' => $key,
        'chain_name' => $chain['chain_name'],
        'denom' => $chain['denom'],
        'display_denom' => $chain['display_denom'],
        'decimals' => (int) $chain['decimals'],
        'bech32_prefix' => $chain['bech32_prefix'],
        'chain_is_active' => (int) $chain['is_active'] === 1,
        // null = unmetered: no cap, no fee, only the global watch limit.
        'pricing' => $normalised === null ? null : [
            'alerts_enabled' => $normalised['alerts_enabled'],
            'free_cap' => $normalised['free_cap'],
            'fee_amount' => $normalised['fee_amount'],
            'fee_denom' => $normalised['fee_denom'],
            'collect_address' => $normalised['collect_address'],
            'cadence' => $normalised['cadence'],
            'grace_days' => $normalised['grace_days'],
            // Whether we could actually take a payment right now. False with a
            // row present means something is misconfigured, and the screen says
            // which part - a silently unsellable chain is the failure mode this
            // flag exists to make loud.
            'sellable' => pricing_sellable($normalised, $chainShape),
            'updated_at' => $row['updated_at'] ?? null,
        ],
        'watch_counts' => $counts[$key] ?? ['free' => 0, 'paid' => 0, 'lapsed' => 0, 'total' => 0],
    ];
}

json_out([
    'ok' => true,
    'chains' => $out,
    'cadences' => WATCH_CADENCES,
    'free_cap_max' => FREE_CAP_MAX,
    'grace_days_max' => GRACE_DAYS_MAX,
]);
