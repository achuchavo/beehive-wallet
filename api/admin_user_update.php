<?php
require __DIR__ . '/common.php';

$db = get_db();
$adminId = require_permission($db, 'users');

$body = read_body();
$targetId = (int) ($body['id'] ?? 0);
$action = $body['action'] ?? '';

// Admin-role actions (promote/demote) moved to admin_role_update.php (super only).
$allowed = ['disable', 'enable', 'delete'];
if (!in_array($action, $allowed, true)) {
    json_error('Unknown action');
}
if ($targetId === $adminId) {
    json_error("You can't change your own account");
}

$stmt = $db->prepare('SELECT id FROM users WHERE id = ?');
$stmt->execute([$targetId]);
if (!$stmt->fetch()) {
    json_error('User not found', 404);
}

switch ($action) {
    case 'disable':
        $db->prepare('UPDATE users SET is_disabled = 1 WHERE id = ?')->execute([$targetId]);
        break;
    case 'enable':
        $db->prepare('UPDATE users SET is_disabled = 0 WHERE id = ?')->execute([$targetId]);
        break;
    case 'delete':
        // watched_addresses and wallet_alerts cascade via foreign keys.
        $db->prepare('DELETE FROM users WHERE id = ?')->execute([$targetId]);
        break;
}

json_out(['ok' => true]);
