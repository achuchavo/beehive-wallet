<?php
require __DIR__ . '/common.php';
require_post();

$db = get_db();
$userId = require_user($db);
$body = read_body();

$endpoint = $body['endpoint'] ?? '';
$p256dh = $body['keys']['p256dh'] ?? '';
$auth = $body['keys']['auth'] ?? '';

if (!is_string($endpoint) || strpos($endpoint, 'https://') !== 0 || strlen($endpoint) > 500) {
    json_error('Invalid subscription endpoint');
}
if ($p256dh === '' || $auth === '') {
    json_error('Invalid subscription keys');
}

$stmt = $db->prepare(
    'INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth_key, created_at)
     VALUES (?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth_key = VALUES(auth_key)'
);
$stmt->execute([$userId, $endpoint, $p256dh, $auth]);

json_out(['ok' => true]);
