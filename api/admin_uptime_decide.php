<?php
// Approve, extend, or withdraw a validator uptime subscription.
//
// 'deny' applies to an ALREADY APPROVED subscription as well as a pending one -
// withdrawing authorisation is the same decision as refusing it, and the
// watcher only ever selects status = 'approved', so either way alerts stop on
// its next cycle.
require __DIR__ . '/common.php';
require_post();

$db = get_db();
$adminId = require_permission($db, 'uptime', PERM_WRITE);
$body = read_body();

$id = (int) ($body['id'] ?? 0);
$action = $body['action'] ?? '';
$days = (int) ($body['days'] ?? 0); // <= 0 means indefinite

// The previous status is read so the audit trail records what actually changed
// - "denied a pending application" and "withdrew a live authorisation" are very
// different events and were previously indistinguishable.
$stmt = $db->prepare('SELECT id, status FROM uptime_subscriptions WHERE id = ?');
$stmt->execute([$id]);
$sub = $stmt->fetch();
if (!$sub) {
    json_error('Subscription not found', 404);
}
$was = (string) $sub['status'];

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
    // authorized_until is cleared, not left behind. A withdrawn subscription
    // carrying an expiry date reads as still authorised on every screen that
    // shows one, and would quietly look live again if it were ever re-approved
    // without a fresh period being set.
    //
    // The alert cursors are reset too, so re-approving later starts from the
    // validator's current state rather than replaying a stale "down" flag from
    // before the withdrawal.
    $stmt = $db->prepare(
        'UPDATE uptime_subscriptions
         SET status = \'denied\', authorized_until = NULL,
             last_down_state = 0, last_alert_at = NULL, last_missed = 0
         WHERE id = ?'
    );
    $stmt->execute([$id]);
} else {
    json_error('Unknown action');
}

// Withdrawing a live authorisation stops a service someone was relying on, so
// it belongs in the audit trail alongside the role changes. Best-effort, like
// every other call site - it must never undo a change that already committed.
$detail = $action === 'approve'
    ? ($days > 0 ? "approve {$days}d (was {$was})" : "approve indefinite (was {$was})")
    : "deny (was {$was})";
audit_admin_action($db, $adminId, 0, 'uptime_decide', "sub={$id} {$detail}");

json_out(['ok' => true, 'status' => $action === 'approve' ? 'approved' : 'denied']);
