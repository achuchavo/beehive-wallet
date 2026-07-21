<?php
require __DIR__ . '/common.php';

$db = get_db();
$userId = require_user($db);
$body = read_body();
$id = (int) ($body['id'] ?? 0);

$stmt = $db->prepare('DELETE FROM uptime_subscriptions WHERE id = ? AND user_id = ?');
$stmt->execute([$id, $userId]);

json_out(['ok' => true]);
