<?php
require __DIR__ . '/common.php';

$userId = require_user();
$body = read_body();
$id = (int) ($body['id'] ?? 0);

$db = get_db();
$stmt = $db->prepare('DELETE FROM watched_addresses WHERE id = ? AND user_id = ?');
$stmt->execute([$id, $userId]);

json_out(['ok' => true]);
