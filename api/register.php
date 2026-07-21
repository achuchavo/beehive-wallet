<?php
require __DIR__ . '/common.php';

$body = read_body();
$email = strtolower(trim($body['email'] ?? ''));
$password = $body['password'] ?? '';

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    json_error('Enter a valid email address');
}
if (strlen($password) < 10) {
    json_error('Password must be at least 10 characters');
}

$db = get_db();

$stmt = $db->prepare('SELECT id FROM users WHERE email = ?');
$stmt->execute([$email]);
if ($stmt->fetch()) {
    json_error('That email is already registered');
}

$hash = password_hash($password, PASSWORD_ARGON2ID);
$stmt = $db->prepare('INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, NOW())');
$stmt->execute([$email, $hash]);

$_SESSION['user_id'] = (int) $db->lastInsertId();
session_regenerate_id(true);

json_out(['ok' => true]);
