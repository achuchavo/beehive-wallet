<?php
require __DIR__ . '/common.php';

if (empty($_SESSION['user_id'])) {
    json_out(['ok' => true, 'logged_in' => false]);
}

$db = get_db();
$stmt = $db->prepare('SELECT email, is_admin FROM users WHERE id = ?');
$stmt->execute([(int) $_SESSION['user_id']]);
$user = $stmt->fetch();

if (!$user) {
    $_SESSION = [];
    session_destroy();
    json_out(['ok' => true, 'logged_in' => false]);
}

json_out([
    'ok' => true,
    'logged_in' => true,
    'email' => $user['email'],
    'is_admin' => (int) $user['is_admin'] === 1,
]);
