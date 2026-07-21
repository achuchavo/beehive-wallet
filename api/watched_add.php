<?php
require __DIR__ . '/common.php';

$userId = require_user();
$body = read_body();

$chainKey = trim($body['chain_key'] ?? '');
$address = trim($body['address'] ?? '');
$label = trim($body['label'] ?? '');

// Chain registry lives in config/chains.json (shared with the watcher).
$chains = json_decode(file_get_contents(__DIR__ . '/chains.json'), true);
$chain = null;
foreach ($chains as $c) {
    if ($c['key'] === $chainKey) {
        $chain = $c;
        break;
    }
}
if ($chain === null) {
    json_error('Unknown chain');
}
if (!looks_like_address($address, $chain['bech32Prefix'])) {
    json_error("Enter a valid {$chain['chainName']} address");
}

$db = get_db();

$stmt = $db->prepare('SELECT COUNT(*) AS n FROM watched_addresses WHERE user_id = ?');
$stmt->execute([$userId]);
if ((int) $stmt->fetch()['n'] >= 20) {
    json_error('Watch limit reached (20 addresses)');
}

$stmt = $db->prepare(
    'INSERT IGNORE INTO watched_addresses (user_id, chain_key, address, label, alarm_enabled, created_at)
     VALUES (?, ?, ?, ?, 1, NOW())'
);
$stmt->execute([$userId, $chainKey, $address, $label]);

json_out(['ok' => true, 'id' => (int) $db->lastInsertId()]);
