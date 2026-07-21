<?php
// Super-admin only: manage who is an admin, their granted features, and super
// status. Kept separate from user moderation so only super admins can touch
// admin roles.
require __DIR__ . '/common.php';

$db = get_db();
$superId = require_super_admin($db);

$body = read_body();
$targetId = (int) ($body['id'] ?? 0);
$isAdmin = !empty($body['is_admin']);
$isSuper = !empty($body['is_super_admin']);
$features = is_array($body['features'] ?? null) ? $body['features'] : [];

if ($targetId === $superId) {
    json_error("You can't change your own admin role");
}

$stmt = $db->prepare('SELECT id FROM users WHERE id = ?');
$stmt->execute([$targetId]);
if (!$stmt->fetch()) {
    json_error('User not found', 404);
}

// A super admin implies admin.
if ($isSuper) {
    $isAdmin = true;
}

$db->beginTransaction();
try {
    $db->prepare('UPDATE users SET is_admin = ?, is_super_admin = ? WHERE id = ?')
        ->execute([$isAdmin ? 1 : 0, $isSuper ? 1 : 0, $targetId]);

    $db->prepare('DELETE FROM admin_permissions WHERE user_id = ?')->execute([$targetId]);

    if ($isAdmin && !$isSuper) {
        $ins = $db->prepare('INSERT INTO admin_permissions (user_id, feature) VALUES (?, ?)');
        foreach ($features as $feature) {
            if (in_array($feature, ADMIN_FEATURES, true)) {
                $ins->execute([$targetId, $feature]);
            }
        }
    }
    $db->commit();
} catch (Throwable $e) {
    $db->rollBack();
    json_error('Could not update role');
}

json_out(['ok' => true]);
