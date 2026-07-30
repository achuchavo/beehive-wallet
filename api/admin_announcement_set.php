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

$expiresAt = null;
if ($expiresHours > 0) {
    $expiresAt = (new DateTime())->modify("+{$expiresHours} hours")->format('Y-m-d H:i:s');
}

// Two ways to ship the same fields, with different id semantics:
//   update_id set    edit the ACTIVE announcement in place. The id survives,
//                    so users who already dismissed it stay dismissed - this
//                    is the typo-fix path, not a re-announcement.
//   update_id absent publish a NEW announcement (new id). Everyone sees it,
//                    including people who dismissed the previous one.
$updateId = isset($body['update_id']) ? (int) $body['update_id'] : 0;

if ($updateId > 0) {
    $check = $db->prepare('SELECT id FROM announcements WHERE id = ? AND is_active = 1');
    $check->execute([$updateId]);
    if (!$check->fetch()) {
        json_error('No active announcement with that id - it may have been taken down');
    }
    // Expiry is re-applied from now: the editor re-states it on every save.
    $stmt = $db->prepare(
        'UPDATE announcements
         SET message = ?, body = ?, cta_label = ?, cta_path = ?, severity = ?, expires_at = ?
         WHERE id = ? AND is_active = 1'
    );
    $stmt->execute([$message, $richBody, $ctaLabel, $ctaPath, $severity, $expiresAt, $updateId]);
    json_out(['ok' => true]);
}

$db->exec('UPDATE announcements SET is_active = 0 WHERE is_active = 1');

$stmt = $db->prepare(
    'INSERT INTO announcements
        (message, body, cta_label, cta_path, severity, is_active, expires_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, NOW())'
);
$stmt->execute([$message, $richBody, $ctaLabel, $ctaPath, $severity, $expiresAt, $adminId]);

json_out(['ok' => true]);
