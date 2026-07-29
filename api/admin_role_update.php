<?php
// Manage who is an admin, what they may reach, and at what level.
//
// This is the most dangerous endpoint in the deployment - it is the one that
// hands out power - so every rule below is enforced HERE, server-side, with the
// rows locked. The admin screen mirrors them only to avoid offering a control
// that will be refused; it is not, and must never become, the enforcement.
//
// The rules, in the order they are checked:
//
//   1. Nobody edits their own access. (An admin who could would simply grant
//      themselves everything.)
//   2. Only a super admin may set or clear is_super_admin. The top of the
//      hierarchy cannot be entered or left except by someone already there.
//   3. Only a super admin may act on a target who is already an admin or super
//      admin - reusing admin_action_denied_reason(), the audited helper that
//      admin_user_update.php uses, rather than a second implementation of the
//      same rule that could drift from it.
//   4. No escalation: an admin may not grant any feature above the level they
//      hold themselves, and only a super admin may grant 'roles' at all.
//   5. The last active super admin cannot be demoted.
//
// Previously this endpoint was super-admin only, which made rules 1-5 mostly
// vacuous. It is now reachable with roles:WRITE, so they carry real weight.
require __DIR__ . '/common.php';
require_post();

$db = get_db();
// Super admins hold every feature at write implicitly, so they still pass.
$actorId = require_permission($db, 'roles', PERM_WRITE);

// Granting power is a sensitive surface: meter it like the other ones.
sensitive_rate_limit("roles_{$actorId}", 20);

$body = read_body();
$targetId = (int) ($body['id'] ?? 0);
// NOTE: is_admin is deliberately NOT read from the body - it is derived from
// the grants further down. The field is still accepted and ignored so an older
// client bundle mid-deploy does not fail.
$wantSuper = !empty($body['is_super_admin']);

/**
 * Requested grants, normalised to feature => level.
 *
 * Accepts the new {"chains": 2, "uptime": 1} map and the legacy
 * ["chains","uptime"] list, which is read as write level - the meaning a
 * membership row has always had. Tolerating both means a browser still running
 * the previous JS bundle during a deploy does not silently strip an admin's
 * grants down to nothing.
 */
$wanted = [];
$rawFeatures = $body['features'] ?? [];
if (is_array($rawFeatures)) {
    foreach ($rawFeatures as $key => $value) {
        if (is_int($key)) {
            $feature = is_string($value) ? $value : '';
            $level = PERM_WRITE;
        } else {
            $feature = (string) $key;
            $level = clamp_permission_level((int) $value);
        }
        if ($feature === '' || $level === PERM_NONE) {
            continue;
        }
        // Unknown features are refused rather than ignored: silently dropping
        // one would report success for a grant that was never made.
        if (!in_array($feature, ADMIN_FEATURES, true)) {
            json_error('Unknown feature', 400);
        }
        $wanted[$feature] = $level;
    }
}

// Rule 1. Checked before anything else, and again by nothing else - there is no
// path in this file that edits the actor's own row.
if ($targetId === $actorId) {
    json_error("You can't change your own admin role", 403);
}
if ($targetId <= 0) {
    json_error('User not found', 404);
}

// Being an admin is DERIVED, not asked for: holding at least one grant makes
// someone an admin, and a super admin implies one.
//
// This removes a state that was previously reachable and served nobody -
// is_admin = 1 with no feature rows, which let an account into the admin area
// to find every section withheld. It also means the client cannot assert a role
// that disagrees with the grants it sent.
$wantAdmin = $wantSuper || count($wanted) > 0;

$db->beginTransaction();
try {
    // Lock the actor and the target for the whole check-then-write. Without
    // this, two requests can each pass a check that the other invalidates.
    $userStmt = $db->prepare(
        'SELECT id, is_admin, is_super_admin, is_disabled FROM users WHERE id = ? FOR UPDATE'
    );
    $userStmt->execute([$actorId]);
    $actor = $userStmt->fetch();

    $userStmt->execute([$targetId]);
    $target = $userStmt->fetch();

    if (!$actor) {
        $db->rollBack();
        json_error('Not logged in', 401);
    }
    if (!$target) {
        $db->rollBack();
        json_error('User not found', 404);
    }

    $actorIsSuper = (int) $actor['is_super_admin'] === 1;
    $targetIsSuper = (int) $target['is_super_admin'] === 1;

    // Rule 3. Self-protection, a disabled actor, and "only a super admin may
    // act on another admin or super admin". Denials are deliberately
    // indistinguishable - the caller learns nothing about the target's role.
    $deny = admin_action_denied_reason($actor, $target);
    if ($deny !== '') {
        $db->rollBack();
        json_error('You do not have permission to modify this account', 403);
    }

    // Rule 2. Entering or leaving super admin is super-admin-only. Rule 3 has
    // already refused a non-super actor whose TARGET is super, so what is left
    // to catch here is a non-super trying to mint one.
    if (!$actorIsSuper && ($wantSuper || $targetIsSuper)) {
        $db->rollBack();
        json_error('Only a super admin can grant or remove super admin', 403);
    }

    // Rule 4. The actor's own levels, read inside the transaction and locked,
    // so a concurrent change to the actor's grants cannot be raced past this
    // check. A super admin holds everything at write and skips the lookup.
    $actorLevels = [];
    if (!$actorIsSuper) {
        $lv = $db->prepare('SELECT feature, level FROM admin_permissions WHERE user_id = ? FOR UPDATE');
        $lv->execute([$actorId]);
        foreach ($lv->fetchAll() as $r) {
            $actorLevels[$r['feature']] = clamp_permission_level((int) $r['level']);
        }
    }

    foreach ($wanted as $feature => $level) {
        $reason = grant_denied_reason($actorLevels, $actorIsSuper, $feature, $level);
        if ($reason === '') {
            continue;
        }
        $db->rollBack();
        if ($reason === 'roles_super_only') {
            json_error('Only a super admin can grant role management', 403);
        }
        // 'escalation' and 'unknown_feature' share one message: an admin
        // probing which features exist above their own level learns nothing.
        json_error('You cannot grant access beyond your own', 403);
    }

    // Rule 5. Never leave the deployment with no active super admin. Counted
    // inside the transaction with the rows above locked, which is what makes
    // two supers demoting each other concurrently impossible rather than
    // merely unlikely.
    if ($targetIsSuper && !$wantSuper) {
        $count = $db->prepare(
            'SELECT COUNT(*) FROM users
             WHERE is_super_admin = 1 AND is_disabled = 0 AND id <> ?
             FOR UPDATE'
        );
        $count->execute([$targetId]);
        if ((int) $count->fetchColumn() < 1) {
            $db->rollBack();
            json_error('This is the last active super admin and cannot be removed', 409);
        }
    }

    $db->prepare('UPDATE users SET is_admin = ?, is_super_admin = ? WHERE id = ?')
        ->execute([$wantAdmin ? 1 : 0, $wantSuper ? 1 : 0, $targetId]);

    // Grants are replaced wholesale, so an omitted feature is a revocation.
    $db->prepare('DELETE FROM admin_permissions WHERE user_id = ?')->execute([$targetId]);

    // A super admin's access is implicit; storing rows for one would be a
    // second, divergent source of truth for something admin_context() already
    // answers from is_super_admin.
    if ($wantAdmin && !$wantSuper) {
        $ins = $db->prepare('INSERT INTO admin_permissions (user_id, feature, level) VALUES (?, ?, ?)');
        foreach ($wanted as $feature => $level) {
            $ins->execute([$targetId, $feature, $level]);
        }
    }

    // Demotion must not leave a persistent session with powers the account no
    // longer has. admin_context() is read per request, so the next call already
    // reflects the change - but a "remember me" cookie can silently re-establish
    // a session for an account whose access was just revoked, and revoking the
    // tokens makes the demotion take effect at the next page load rather than
    // whenever the cookie happens to expire.
    if (!$wantAdmin) {
        remember_revoke_all($db, $targetId);
    }

    $db->commit();
} catch (Throwable $e) {
    if ($db->inTransaction()) {
        $db->rollBack();
    }
    error_log('admin_role_update failed: ' . $e->getMessage());
    json_error('Could not update role', 500);
}

// Handing out (or taking away) administrative power is exactly the kind of
// change the audit trail exists for. Best-effort, like every other call site -
// it must never undo a change that already committed.
$summary = $wantSuper ? 'super_admin' : ($wantAdmin ? 'admin' : 'user');
foreach ($wanted as $feature => $level) {
    $summary .= " {$feature}:" . ($level === PERM_WRITE ? 'w' : 'r');
}
audit_admin_action($db, $actorId, $targetId, 'role_update', $summary);

json_out(['ok' => true]);
