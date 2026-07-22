<?php
require __DIR__ . '/common.php';
require_post();

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
    'coingecko_id' => trim($b['coingecko_id'] ?? ''),
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

// --- Semantic validation (audit #14) ---------------------------------------
// A chain row drives derivation paths, address prefixes, fee math and the fee
// collector, so "non-empty" is nowhere near enough: a bad row here produces
// wrong addresses or misdirected funds. These checks run server-side even
// though the admin form also validates, because the form is not the boundary.

$prefix = $fields['bech32_prefix'];

if (!preg_match('/^[A-Za-z0-9]([A-Za-z0-9._-]{0,58}[A-Za-z0-9])?$/', $fields['chain_id'])) {
    json_error('chain_id must be 1-60 chars: letters, digits, dot, dash or underscore');
}
if (!preg_match('/^[a-z][a-z0-9]{1,19}$/', $prefix)) {
    json_error('bech32_prefix must be 2-20 lowercase letters/digits starting with a letter');
}
// Cosmos SDK denom rule.
if (!preg_match('#^[a-zA-Z][a-zA-Z0-9/:._-]{2,127}$#', $fields['denom'])) {
    json_error('denom is not a valid Cosmos denomination');
}
if (!preg_match('/^[A-Za-z0-9.]{1,20}$/', $fields['display_denom'])) {
    json_error('display_denom must be 1-20 letters/digits');
}
if (mb_strlen($fields['chain_name']) > 80) {
    json_error('chain_name is too long (80 max)');
}
if ($fields['decimals'] < 0 || $fields['decimals'] > 30) {
    json_error('decimals must be between 0 and 30');
}
// SLIP-44 coin type. Hardened-derivation index must stay below 2^31.
if ($fields['coin_type'] < 0 || $fields['coin_type'] > 2147483647) {
    json_error('coin_type must be between 0 and 2147483647');
}
if ($fields['sort_order'] < -1000 || $fields['sort_order'] > 1000) {
    json_error('sort_order must be between -1000 and 1000');
}

// gas_price is "<amount><denom>" and its denom MUST match the chain's denom -
// otherwise every fee would be priced in an asset the chain does not charge in.
if (!preg_match('#^(\d+(?:\.\d+)?)([a-zA-Z][a-zA-Z0-9/:._-]*)$#', $fields['gas_price'], $gp)) {
    json_error('gas_price must look like "5umed" (amount followed by a denom)');
}
if ($gp[2] !== $fields['denom']) {
    json_error("gas_price denom \"{$gp[2]}\" does not match the chain denom \"{$fields['denom']}\"");
}
if ((float) $gp[1] < 0 || (float) $gp[1] > 1000000) {
    json_error('gas_price amount is out of range');
}

// Explorer templates: HTTPS only, and they are used by string concatenation so
// they must end at the point the hash/address is appended.
foreach (['explorer_tx_url', 'explorer_validator_url'] as $u) {
    if ($fields[$u] === '') {
        continue;
    }
    if (!preg_match('#^https://#', $fields[$u]) || mb_strlen($fields[$u]) > 200) {
        json_error("$u must be an https:// URL (200 chars max)");
    }
    if (!str_ends_with($fields[$u], '/')) {
        json_error("$u must end with '/' - the tx hash or address is appended to it");
    }
}

// The bundled validator must be a valoper address ON THIS CHAIN.
if ($fields['beehive_validator'] !== '' && !is_valoper_address($fields['beehive_validator'], $prefix)) {
    json_error("beehive_validator must be a valid {$prefix}valoper1... address");
}

// Fee collector: a real account address on this chain, and required whenever a
// service fee is charged - otherwise the fee would be sent nowhere.
if (!preg_match('/^\d+$/', $fields['service_fee'])) {
    json_error('service_fee must be a whole number of base units (0 for none)');
}
if (strlen($fields['service_fee']) > 30) {
    json_error('service_fee is unreasonably large');
}
if ($fields['fee_collector'] !== '' && !is_account_address($fields['fee_collector'], $prefix)) {
    json_error("fee_collector must be a valid {$prefix}1... address");
}
if ($fields['service_fee'] !== '0' && $fields['fee_collector'] === '') {
    json_error('A non-zero service_fee requires a fee_collector address');
}

if ($fields['coingecko_id'] !== '' && !preg_match('/^[a-z0-9][a-z0-9-]{0,59}$/', $fields['coingecko_id'])) {
    json_error('coingecko_id must be lowercase letters, digits and dashes');
}

// The prefix is baked into every stored wallet address, so changing it on an
// existing chain would orphan them.
$stmt = $db->prepare('SELECT bech32_prefix, denom FROM chains WHERE chain_key = ?');
$stmt->execute([$key]);
$prev = $stmt->fetch();
if ($prev && ($prev['bech32_prefix'] !== $prefix || $prev['denom'] !== $fields['denom'])) {
    json_error(
        'bech32_prefix and denom cannot be changed on an existing chain - '
        . 'wallets already store addresses derived from them. Add a new chain instead.',
        409
    );
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
