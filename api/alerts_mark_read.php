<?php
require __DIR__ . '/common.php';

$userId = require_user();

$db = get_db();
$stmt = $db->prepare(
    'UPDATE wallet_alerts a
     JOIN watched_addresses w ON w.id = a.watched_address_id
     SET a.is_read = 1
     WHERE w.user_id = ?'
);
$stmt->execute([$userId]);

json_out(['ok' => true]);
