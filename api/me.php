<?php
require __DIR__ . '/common.php';

$db = get_db();

// me.php is what the app calls on load, so this is where a "remember me" token
// normally revives a session after the short idle timeout has expired.
if (empty($_SESSION['user_id'])) {
    remember_resume($db);
}
if (empty($_SESSION['user_id'])) {
    json_out(['ok' => true, 'logged_in' => false]);
}
$stmt = $db->prepare(
    'SELECT email, is_admin, is_disabled, main_address, main_address_verified FROM users WHERE id = ?'
);
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
    // False for anything linked before ownership proofs existed: the UI prompts
    // re-verification, and login.php will not accept it as an identifier.
    'main_address_verified' => (int) $user['main_address_verified'] === 1,
]);
