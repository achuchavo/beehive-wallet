<?php
require __DIR__ . '/common.php';

$body = read_body();
$email = strtolower(trim($body['email'] ?? ''));
$password = $body['password'] ?? '';

$db = get_db();
$stmt = $db->prepare('SELECT id, password_hash FROM users WHERE email = ?');
$stmt->execute([$email]);
$user = $stmt->fetch();

if (!$user || !password_verify($password, $user['password_hash'])) {
    json_error('Wrong email or password', 401);
}

$_SESSION['user_id'] = (int) $user['id'];
session_regenerate_id(true);

json_out(['ok' => true]);
