<?php
require __DIR__ . '/common.php';
require_post();

$db = get_db();
$userId = require_user($db);
$body = read_body();
$id = (int) ($body['id'] ?? 0);
$alarmType = trim($body['alarm_type'] ?? '');

$allowedTypes = ['sent', 'received', 'both', 'unbond'];
if (!in_array($alarmType, $allowedTypes, true)) {
    json_error('Invalid alarm type');
}

$stmt = $db->prepare('UPDATE watched_addresses SET alarm_type = ? WHERE id = ? AND user_id = ?');
$stmt->execute([$alarmType, $id, $userId]);

json_out(['ok' => true]);
