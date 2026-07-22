<?php
require __DIR__ . '/common.php';
require_post();

$db = get_db();
$userId = require_user($db);
$body = read_body();

$chainKey = trim($body['chain_key'] ?? '');
$address = trim($body['address'] ?? '');
$label = trim($body['label'] ?? '');
$alarmType = trim($body['alarm_type'] ?? 'both');
$allowedTypes = ['sent', 'received', 'both', 'unbond'];
if (!in_array($alarmType, $allowedTypes, true)) {
    $alarmType = 'both';
}

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

$stmt = $db->prepare('SELECT COUNT(*) AS n FROM watched_addresses WHERE user_id = ?');
$stmt->execute([$userId]);
if ((int) $stmt->fetch()['n'] >= 20) {
    json_error('Watch limit reached (20 addresses)');
}

$stmt = $db->prepare(
    'INSERT IGNORE INTO watched_addresses (user_id, chain_key, address, label, alarm_enabled, alarm_type, created_at)
     VALUES (?, ?, ?, ?, 1, ?, NOW())'
);
$stmt->execute([$userId, $chainKey, $address, $label, $alarmType]);

if ($stmt->rowCount() === 0) {
    // Already watched (unique user+chain+address): return the existing row's id
    // with an explicit duplicate flag rather than a bogus zero insert id.
    $existing = $db->prepare(
        'SELECT id FROM watched_addresses WHERE user_id = ? AND chain_key = ? AND address = ?'
    );
    $existing->execute([$userId, $chainKey, $address]);
    json_out(['ok' => true, 'id' => (int) $existing->fetchColumn(), 'duplicate' => true]);
}

json_out(['ok' => true, 'id' => (int) $db->lastInsertId(), 'duplicate' => false]);
