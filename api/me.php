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
    'SELECT email, is_admin, is_disabled, main_address, main_address_verified, push_private FROM users WHERE id = ?'
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
    // The caller's own id. Needed so the admin screens can tell which row is
    // YOU: every self-edit is refused server-side, and without this the UI
    // cannot mark that row and instead offers a control that always 403s.
    'id' => (int) $_SESSION['user_id'],
    'email' => $user['email'],
    'is_admin' => $ctx['is_admin'],
    'is_super_admin' => $ctx['is_super_admin'],
    // Features held at read level or better, and the level for each. The UI
    // uses the levels to disable controls it cannot use; every endpoint
    // enforces its own level regardless, so this is presentation only.
    'admin_features' => $ctx['features'],
    'admin_levels' => (object) $ctx['levels'],
    'main_address' => $user['main_address'],
    // False for anything linked before ownership proofs existed: the UI prompts
    // re-verification, and login.php will not accept it as an identifier.
    'main_address_verified' => (int) $user['main_address_verified'] === 1,
    // Whether push bodies redact wallet names and amounts (audit #13).
    'push_private' => (int) ($user['push_private'] ?? 1) === 1,
]);
