<?php
// Staking policy and the allowed-validator list, per chain. Read-only.
//
// Gated on its own 'staking' feature rather than on 'chains'. Editing an
// endpoint URL and deciding which validators users may delegate to (and what it
// costs them) are different jobs with different blast radii - one breaks
// connectivity, the other directs where people's stake and money go.
require __DIR__ . '/common.php';
require_once __DIR__ . '/watch_billing.php';

$db = get_db();
require_permission($db, 'staking', PERM_READ);

$chains = $db->query(
    'SELECT chain_key, chain_name, denom, display_denom, decimals, bech32_prefix,
            beehive_validator, beehive_moniker, staking_policy, service_fee,
            fee_collector, is_active
     FROM chains ORDER BY sort_order, chain_name'
)->fetchAll();

$allowed = [];
foreach (
    $db->query('SELECT id, chain_key, valoper FROM chain_free_validators ORDER BY chain_key, id')
        ->fetchAll() as $row
) {
    $allowed[$row['chain_key']][] = ['id' => (int) $row['id'], 'valoper' => $row['valoper']];
}

$out = [];
foreach ($chains as $c) {
    $policy = in_array($c['staking_policy'] ?? 'all', STAKING_POLICIES, true)
        ? $c['staking_policy']
        : 'all';
    $fee = base_normalize((string) $c['service_fee']) ?? '0';
    $chainShape = ['denom' => $c['denom'], 'bech32Prefix' => $c['bech32_prefix']];

    $out[] = [
        'chain_key' => $c['chain_key'],
        'chain_name' => $c['chain_name'],
        'denom' => $c['denom'],
        'display_denom' => $c['display_denom'],
        'decimals' => (int) $c['decimals'],
        'bech32_prefix' => $c['bech32_prefix'],
        'chain_is_active' => (int) $c['is_active'] === 1,
        'beehive_validator' => $c['beehive_validator'],
        'beehive_moniker' => $c['beehive_moniker'],
        'staking_policy' => $policy,
        'service_fee' => $fee,
        'fee_collector' => $c['fee_collector'],
        // Whether the paid tier could actually take a payment. Under
        // 'allowlist_paid' a missing collector or a zero fee means the app would
        // offer "pay to stake here" and then charge nothing - so the screen says
        // so rather than letting it look configured.
        'fee_ready' => base_is_positive($fee)
            && is_account_address((string) $c['fee_collector'], (string) $c['bech32_prefix']),
        'allowed_validators' => $allowed[$c['chain_key']] ?? [],
    ];
    unset($chainShape);
}

json_out([
    'ok' => true,
    'chains' => $out,
    'policies' => STAKING_POLICIES,
]);
