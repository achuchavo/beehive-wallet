<?php
require __DIR__ . '/common.php';

$db = get_db();
require_post();
$adminId = require_permission($db, 'users');

$body = read_body();
$targetId = (int) ($body['id'] ?? 0);
$action = $body['action'] ?? '';

// Admin-role actions (promote/demote) moved to admin_role_update.php (super only).
$allowed = ['disable', 'enable', 'delete'];
if (!in_array($action, $allowed, true)) {
    json_error('Unknown action');
}

// Everything below runs in one transaction so the final-super-admin count
// cannot race with a concurrent request doing the same check.
$db->beginTransaction();
try {
    // Lock the actor and target rows for the duration of the check+write.
    $stmt = $db->prepare(
        'SELECT id, is_admin, is_super_admin, is_disabled FROM users WHERE id = ? FOR UPDATE'
    );
    $stmt->execute([$adminId]);
    $actor = $stmt->fetch();

    $stmt->execute([$targetId]);
    $target = $stmt->fetch();

    if (!$actor) {
        $db->rollBack();
        json_error('Not logged in', 401);
    }
    if (!$target) {
        $db->rollBack();
        json_error('User not found', 404);
    }

    // Role hierarchy: self-protection, disabled actor, and "only a super admin
    // may act on another admin/super admin". Deliberately does not tell the
    // caller the target's role - 403 is identical for every denial.
    $deny = admin_action_denied_reason($actor, $target);
    if ($deny !== '') {
        $db->rollBack();
        if ($deny === 'self') {
            json_error("You can't change your own account", 403);
        }
        json_error('You do not have permission to modify this account', 403);
    }

    // Never allow the last remaining active super admin to be removed or locked
    // out. Counted inside the transaction, with the rows locked above.
    if (role_level($target) === ROLE_SUPER && in_array($action, ['disable', 'delete'], true)) {
        $stmt = $db->prepare(
            'SELECT COUNT(*) FROM users
             WHERE is_super_admin = 1 AND is_disabled = 0 AND id <> ?
             FOR UPDATE'
        );
        $stmt->execute([$targetId]);
        if ((int) $stmt->fetchColumn() < 1) {
            $db->rollBack();
            json_error('This is the last active super admin and cannot be removed', 409);
        }
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

    $db->commit();
} catch (Throwable $e) {
    if ($db->inTransaction()) {
        $db->rollBack();
    }
    error_log('admin_user_update failed: ' . $e->getMessage());
    json_error('Could not update the account', 500);
}

audit_admin_action($db, $adminId, $targetId, $action);

json_out(['ok' => true]);
