<?php
require __DIR__ . '/common.php';

$db = get_db();
$userId = require_user($db);

$stmt = $db->prepare(
    'SELECT id, chain_key, address, label, alarm_enabled, created_at
     FROM watched_addresses
     WHERE user_id = ?
     ORDER BY created_at DESC'
);
$stmt->execute([$userId]);

json_out(['ok' => true, 'addresses' => $stmt->fetchAll()]);
