<?php
require __DIR__ . '/common.php';
require_post();

$db = get_db();
$userId = require_user($db);
$body = read_body();
$endpoint = $body['endpoint'] ?? '';

$stmt = $db->prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?');
$stmt->execute([$userId, $endpoint]);

json_out(['ok' => true]);
