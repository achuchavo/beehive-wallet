<?php
require __DIR__ . '/common.php';
require_post();

$db = get_db();
$adminId = require_permission($db, 'uptime');
$body = read_body();

$id = (int) ($body['id'] ?? 0);
$action = $body['action'] ?? '';
$days = (int) ($body['days'] ?? 0); // <= 0 means indefinite

$stmt = $db->prepare('SELECT id FROM uptime_subscriptions WHERE id = ?');
$stmt->execute([$id]);
if (!$stmt->fetch()) {
    json_error('Subscription not found', 404);
}

if ($action === 'approve') {
    if ($days > 0) {
        $stmt = $db->prepare(
            'UPDATE uptime_subscriptions
             SET status = \'approved\', approved_by = ?,
                 authorized_until = DATE_ADD(NOW(), INTERVAL ? DAY),
                 last_down_state = 0, last_alert_at = NULL, last_missed = 0
             WHERE id = ?'
        );
        $stmt->execute([$adminId, min($days, 3650), $id]);
    } else {
        $stmt = $db->prepare(
            'UPDATE uptime_subscriptions
             SET status = \'approved\', approved_by = ?, authorized_until = NULL,
                 last_down_state = 0, last_alert_at = NULL, last_missed = 0
             WHERE id = ?'
        );
        $stmt->execute([$adminId, $id]);
    }
} elseif ($action === 'deny') {
    $stmt = $db->prepare('UPDATE uptime_subscriptions SET status = \'denied\' WHERE id = ?');
    $stmt->execute([$id]);
} else {
    json_error('Unknown action');
}

json_out(['ok' => true]);
