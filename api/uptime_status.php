<?php
require __DIR__ . '/common.php';

$db = get_db();
$userId = require_user($db);

$enabled = get_setting($db, 'uptime_alerts_enabled', '0') === '1';

$stmt = $db->prepare(
    'SELECT id, chain_key, validator_address, moniker, status, authorized_until,
            miss_threshold, frequency_minutes, snooze_until, last_missed, last_down_state,
            last_alert_at, created_at
     FROM uptime_subscriptions
     WHERE user_id = ?
     ORDER BY created_at DESC'
);
$stmt->execute([$userId]);
$subscriptions = $stmt->fetchAll();

$stmt = $db->prepare(
    'SELECT a.id, a.subscription_id, a.kind, a.missed_blocks, a.detected_at, a.is_read,
            s.validator_address, s.moniker, s.chain_key
     FROM uptime_alerts a
     JOIN uptime_subscriptions s ON s.id = a.subscription_id
     WHERE s.user_id = ?
     ORDER BY a.detected_at DESC
     LIMIT 50'
);
$stmt->execute([$userId]);
$alerts = $stmt->fetchAll();

$unread = 0;
foreach ($alerts as $a) {
    if (!(int) $a['is_read']) {
        $unread++;
    }
}

json_out([
    'ok' => true,
    'enabled' => $enabled,
    'subscriptions' => $subscriptions,
    'alerts' => $alerts,
    'unread' => $unread,
]);
