<?php
require __DIR__ . '/common.php';

if (empty($_SESSION['user_id'])) {
    json_out(['ok' => true, 'logged_in' => false]);
}

$db = get_db();
$stmt = $db->prepare('SELECT email, is_admin, is_disabled, main_address FROM users WHERE id = ?');
$stmt->execute([(int) $_SESSION['user_id']]);
$user = $stmt->fetch();

if (!$user || (int) $user['is_disabled'] === 1) {
    $_SESSION = [];
    session_destroy();
    json_out(['ok' => true, 'logged_in' => false]);
}

$ctx = admin_context($db, (int) $_SESSION['user_id']);

json_out([
    'ok' => true,
    'logged_in' => true,
    'email' => $user['email'],
    'is_admin' => $ctx['is_admin'],
    'is_super_admin' => $ctx['is_super_admin'],
    'admin_features' => $ctx['features'],
    'main_address' => $user['main_address'],
]);
