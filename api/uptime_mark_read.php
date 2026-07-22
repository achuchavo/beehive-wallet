<?php
require __DIR__ . '/common.php';
require_post();

$db = get_db();
$userId = require_user($db);

$stmt = $db->prepare(
    'UPDATE uptime_alerts a
     JOIN uptime_subscriptions s ON s.id = a.subscription_id
     SET a.is_read = 1
     WHERE s.user_id = ? AND a.is_read = 0'
);
$stmt->execute([$userId]);

json_out(['ok' => true]);
