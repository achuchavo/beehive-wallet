<?php
require __DIR__ . '/common.php';

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
if (!preg_match('/^' . preg_quote($chain['bech32_prefix'], '/') . 'valoper1[a-z0-9]{20,80}$/', $valoper)) {
    json_error('Enter a valid validator (valoper) address');
}

$db->prepare('INSERT IGNORE INTO chain_free_validators (chain_key, valoper) VALUES (?, ?)')
    ->execute([$chainKey, $valoper]);

json_out(['ok' => true]);
