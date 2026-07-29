<?php
require __DIR__ . '/common.php';

$db = get_db();
$userId = require_user($db);

$stmt = $db->prepare(
    'SELECT id, chain_key, address, label, alarm_enabled, alarm_type, created_at
     FROM watched_addresses
     WHERE user_id = ?
     ORDER BY created_at DESC'
);
$stmt->execute([$userId]);

// The limit rides along with the list so the page can show "n of N" and stop
// offering the form at the cap, without a second round trip.
json_out(['ok' => true, 'addresses' => $stmt->fetchAll(), 'limit' => watch_limit($db)]);
