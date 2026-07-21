<?php
require __DIR__ . '/common.php';

$db = get_db();
require_permission($db, 'chains');

$b = read_body();
$key = trim($b['chain_key'] ?? '');
if (!preg_match('/^[a-z0-9_-]{2,40}$/', $key)) {
    json_error('Chain key must be 2-40 lowercase letters, numbers, - or _');
}

$fields = [
    'chain_id' => trim($b['chain_id'] ?? ''),
    'chain_name' => trim($b['chain_name'] ?? ''),
    'bech32_prefix' => trim($b['bech32_prefix'] ?? ''),
    'denom' => trim($b['denom'] ?? ''),
    'display_denom' => trim($b['display_denom'] ?? ''),
    'decimals' => (int) ($b['decimals'] ?? 6),
    'coin_type' => (int) ($b['coin_type'] ?? 118),
    'gas_price' => trim($b['gas_price'] ?? ''),
    'explorer_tx_url' => trim($b['explorer_tx_url'] ?? ''),
    'explorer_validator_url' => trim($b['explorer_validator_url'] ?? ''),
    'beehive_validator' => trim($b['beehive_validator'] ?? ''),
    'beehive_moniker' => trim($b['beehive_moniker'] ?? ''),
    'service_fee' => trim($b['service_fee'] ?? '0'),
    'fee_collector' => trim($b['fee_collector'] ?? ''),
    'is_active' => !empty($b['is_active']) ? 1 : 0,
    'sort_order' => (int) ($b['sort_order'] ?? 0),
];

foreach (['chain_id', 'chain_name', 'bech32_prefix', 'denom', 'display_denom', 'gas_price'] as $req) {
    if ($fields[$req] === '') {
        json_error('Missing required field: ' . $req);
    }
}

$stmt = $db->prepare('SELECT chain_key FROM chains WHERE chain_key = ?');
$stmt->execute([$key]);
$exists = (bool) $stmt->fetch();

if ($exists) {
    $set = implode(', ', array_map(fn ($f) => "$f = :$f", array_keys($fields)));
    $sql = "UPDATE chains SET $set WHERE chain_key = :chain_key";
    $params = $fields;
    $params['chain_key'] = $key;
    $db->prepare($sql)->execute($params);
} else {
    $cols = array_merge(['chain_key'], array_keys($fields));
    $placeholders = implode(', ', array_map(fn ($c) => ":$c", $cols));
    $sql = 'INSERT INTO chains (' . implode(', ', $cols) . ") VALUES ($placeholders)";
    $params = $fields;
    $params['chain_key'] = $key;
    $db->prepare($sql)->execute($params);
}

json_out(['ok' => true]);
