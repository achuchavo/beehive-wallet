<?php
require __DIR__ . '/common.php';

$userId = require_user();
$body = read_body();
$id = (int) ($body['id'] ?? 0);
$enabled = !empty($body['enabled']) ? 1 : 0;

$db = get_db();
$stmt = $db->prepare('UPDATE watched_addresses SET alarm_enabled = ? WHERE id = ? AND user_id = ?');
$stmt->execute([$enabled, $id, $userId]);

json_out(['ok' => true]);
