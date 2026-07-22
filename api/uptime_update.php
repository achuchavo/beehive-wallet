<?php
require __DIR__ . '/common.php';
require_post();

$db = get_db();
$userId = require_user($db);
$body = read_body();

$id = (int) ($body['id'] ?? 0);

// Ownership check.
$stmt = $db->prepare('SELECT id FROM uptime_subscriptions WHERE id = ? AND user_id = ?');
$stmt->execute([$id, $userId]);
if (!$stmt->fetch()) {
    json_error('Subscription not found', 404);
}

$sets = [];
$params = [];

if (isset($body['frequency_minutes'])) {
    $freq = (int) $body['frequency_minutes'];
    $allowed = [60, 360, 720, 1440];
    if (!in_array($freq, $allowed, true)) {
        json_error('Invalid frequency');
    }
    $sets[] = 'frequency_minutes = ?';
    $params[] = $freq;
}

if (isset($body['miss_threshold'])) {
    $thr = (int) $body['miss_threshold'];
    if ($thr < 1 || $thr > 100000) {
        json_error('Invalid threshold');
    }
    $sets[] = 'miss_threshold = ?';
    $params[] = $thr;
}

if (array_key_exists('snooze_minutes', $body)) {
    $mins = (int) $body['snooze_minutes'];
    if ($mins <= 0) {
        $sets[] = 'snooze_until = NULL';
    } else {
        $sets[] = 'snooze_until = DATE_ADD(NOW(), INTERVAL ? MINUTE)';
        $params[] = min($mins, 60 * 24 * 30); // cap at 30 days
    }
}

if (!$sets) {
    json_error('Nothing to update');
}

$params[] = $id;
$params[] = $userId;
$sql = 'UPDATE uptime_subscriptions SET ' . implode(', ', $sets) . ' WHERE id = ? AND user_id = ?';
$db->prepare($sql)->execute($params);

json_out(['ok' => true]);
