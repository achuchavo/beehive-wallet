<?php
require __DIR__ . '/common.php';

$body = read_body();
// Accept either an email or a wallet address as the identifier. The address
// is only a username here - the password is still the credential.
$identifier = trim($body['identifier'] ?? $body['email'] ?? '');
$email = strtolower($identifier);
$password = $body['password'] ?? '';

$db = get_db();
$stmt = $db->prepare(
    'SELECT id, password_hash, is_disabled FROM users WHERE email = ? OR main_address = ?'
);
$stmt->execute([$email, $identifier]);
$user = $stmt->fetch();

if (!$user || !password_verify($password, $user['password_hash'])) {
    json_error('Wrong login or password', 401);
}
if ((int) $user['is_disabled'] === 1) {
    json_error('This account has been disabled', 403);
}

$_SESSION['user_id'] = (int) $user['id'];
session_regenerate_id(true);

json_out(['ok' => true]);
