<?php
require __DIR__ . '/common.php';
require_post();

require_same_origin();
$body = read_body();
// Accept either an email or a wallet address as the identifier. The address
// is only a username here - the password is still the credential.
$identifier = trim($body['identifier'] ?? $body['email'] ?? '');
$email = strtolower($identifier);
$password = $body['password'] ?? '';
$remember = !empty($body['remember']);

$db = get_db();
$ip = client_ip();

enforce_login_rate_limit($db, $ip, $email);

// A wallet address only works as an identifier once its owner has PROVED
// control of it by signing a challenge (audit #19). Addresses linked before
// proofs existed are main_address_verified = 0 and are therefore not accepted
// here, so a squatted or unproven address can never act as a sign-in handle.
$stmt = $db->prepare(
    'SELECT id, password_hash, is_disabled FROM users
     WHERE email = ?
        OR (main_address = ? AND main_address_verified = 1)'
);
$stmt->execute([$email, $identifier]);
$user = $stmt->fetch();

if (!$user || !password_verify($password, $user['password_hash'])) {
    record_attempt($db, $ip, $email, 'login', false);
    json_error('Wrong login or password', 401);
}
if ((int) $user['is_disabled'] === 1) {
    record_attempt($db, $ip, $email, 'login', false);
    json_error('This account has been disabled', 403);
}

record_attempt($db, $ip, $email, 'login', true);
// Clear this account's recent failures so a legit user isn't left near the cap.
$db->prepare("DELETE FROM login_attempts WHERE identifier = ? AND kind = 'login' AND success = 0")
    ->execute([$email]);

session_login((int) $user['id'], $remember);

// A fresh sign-in supersedes any previous persistent token for this account,
// so an old cookie cannot linger after the user re-authenticates.
remember_revoke_all($db, (int) $user['id']);
if ($remember) {
    remember_issue($db, (int) $user['id']);
} else {
    remember_clear_cookie();
}

json_out(['ok' => true]);
