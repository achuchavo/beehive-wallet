<?php
require __DIR__ . '/common.php';

$db = get_db();
$adminId = require_admin($db);

$body = read_body();

if (!empty($body['clear'])) {
    $db->exec('UPDATE announcements SET is_active = 0 WHERE is_active = 1');
    json_out(['ok' => true]);
}

$message = trim($body['message'] ?? '');
$severity = $body['severity'] ?? 'info';
$expiresHours = isset($body['expires_hours']) ? (int) $body['expires_hours'] : 0;

if ($message === '' || mb_strlen($message) > 300) {
    json_error('Message must be 1-300 characters');
}
if (!in_array($severity, ['info', 'warning', 'danger'], true)) {
    json_error('Severity must be info, warning, or danger');
}

$db->exec('UPDATE announcements SET is_active = 0 WHERE is_active = 1');

$expiresAt = null;
if ($expiresHours > 0) {
    $expiresAt = (new DateTime())->modify("+{$expiresHours} hours")->format('Y-m-d H:i:s');
}

$stmt = $db->prepare(
    'INSERT INTO announcements (message, severity, is_active, expires_at, created_by, created_at)
     VALUES (?, ?, 1, ?, ?, NOW())'
);
$stmt->execute([$message, $severity, $expiresAt, $adminId]);

json_out(['ok' => true]);
