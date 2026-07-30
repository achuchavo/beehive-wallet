<?php
require __DIR__ . '/common.php';
require_post();

$db = get_db();
$adminId = require_permission($db, 'announcements');

$body = read_body();

if (!empty($body['clear'])) {
    $db->exec('UPDATE announcements SET is_active = 0 WHERE is_active = 1');
    json_out(['ok' => true]);
}

$message = trim($body['message'] ?? '');
$richBody = trim($body['body'] ?? '');
$ctaLabel = trim($body['cta_label'] ?? '');
$ctaPath = trim($body['cta_path'] ?? '');
$severity = $body['severity'] ?? 'info';
$expiresHours = isset($body['expires_hours']) ? (int) $body['expires_hours'] : 0;

if ($message === '' || mb_strlen($message) > 300) {
    json_error('Message must be 1-300 characters');
}
if (!in_array($severity, ['info', 'warning', 'danger'], true)) {
    json_error('Severity must be info, warning, or danger');
}
if (mb_strlen($richBody) > 4000) {
    json_error('Body must be at most 4000 characters');
}
if (mb_strlen($ctaLabel) > 80) {
    json_error('CTA label must be at most 80 characters');
}
// The CTA is an in-app route, never a URL: "/alarms" is valid, "https://…" and
// "//evil.example" are not. This is what stops an announcement from steering
// users to an external site inside the app's own chrome.
if ($ctaPath !== '' && (mb_strlen($ctaPath) > 200 || !preg_match('#^/(?!/)#', $ctaPath))) {
    json_error('CTA path must be an in-app path starting with / (e.g. /alarms)');
}
// A button needs both halves; half a button is a config mistake worth rejecting.
if (($ctaLabel === '') !== ($ctaPath === '')) {
    json_error('CTA label and CTA path must be set together');
}

$db->exec('UPDATE announcements SET is_active = 0 WHERE is_active = 1');

$expiresAt = null;
if ($expiresHours > 0) {
    $expiresAt = (new DateTime())->modify("+{$expiresHours} hours")->format('Y-m-d H:i:s');
}

$stmt = $db->prepare(
    'INSERT INTO announcements
        (message, body, cta_label, cta_path, severity, is_active, expires_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, NOW())'
);
$stmt->execute([$message, $richBody, $ctaLabel, $ctaPath, $severity, $expiresAt, $adminId]);

json_out(['ok' => true]);
