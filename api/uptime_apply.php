<?php
require __DIR__ . '/common.php';
require_post();

$db = get_db();
$userId = require_user($db);

if (get_setting($db, 'uptime_alerts_enabled', '0') !== '1') {
    json_error('Uptime alerts are not available right now');
}

$body = read_body();
$chainKey = trim($body['chain_key'] ?? '');
$validator = trim($body['validator_address'] ?? '');
$moniker = trim($body['moniker'] ?? '');

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
if (!looks_like_address($validator, $chain['bech32Prefix'] . 'valoper')) {
    json_error("Enter a valid {$chain['chainName']} validator address");
}

$stmt = $db->prepare('SELECT COUNT(*) AS n FROM uptime_subscriptions WHERE user_id = ?');
$stmt->execute([$userId]);
if ((int) $stmt->fetch()['n'] >= 20) {
    json_error('Subscription limit reached (20 validators)');
}

$stmt = $db->prepare(
    'INSERT IGNORE INTO uptime_subscriptions
        (user_id, chain_key, validator_address, moniker, status, created_at)
     VALUES (?, ?, ?, ?, \'pending\', NOW())'
);
$stmt->execute([$userId, $chainKey, $validator, mb_substr($moniker, 0, 120)]);

json_out(['ok' => true, 'id' => (int) $db->lastInsertId()]);
