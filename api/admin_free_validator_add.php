<?php
require __DIR__ . '/common.php';
require_post();

$db = get_db();
require_permission($db, 'chains');

$b = read_body();
$chainKey = trim($b['chain_key'] ?? '');
$valoper = trim($b['valoper'] ?? '');

$stmt = $db->prepare('SELECT bech32_prefix FROM chains WHERE chain_key = ?');
$stmt->execute([$chainKey]);
$chain = $stmt->fetch();
if (!$chain) {
    json_error('Unknown chain');
}
// Full bech32 validation (checksum + exact valoper HRP), not a shape guess: a
// mistyped address here would silently make a validator "free" that is not the
// one intended, or none at all.
if (!is_valoper_address($valoper, (string) $chain['bech32_prefix'])) {
    json_error('Enter a valid validator (valoper) address');
}

$db->prepare('INSERT IGNORE INTO chain_free_validators (chain_key, valoper) VALUES (?, ?)')
    ->execute([$chainKey, $valoper]);

json_out(['ok' => true]);
