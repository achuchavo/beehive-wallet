<?php
require __DIR__ . '/common.php';
require_post();

require_trusted_caller();
$body = read_body();

// The native shells cannot use the session cookie at all: their WebView origin
// is never this API's origin, and the cookie is SameSite=Strict. They receive a
// bearer token instead - see migration 014.
$wantsToken = is_native_client();
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

if ($wantsToken) {
    $platform = strtolower(trim((string) ($body['platform'] ?? '')));
    if (!device_platform_valid($platform)) {
        json_error('Unknown device platform');
    }

    // No session and no cookies for a native sign-in: the token IS the durable
    // credential, so `remember` is meaningless here and is ignored.
    //
    // The existing persistent tokens are deliberately NOT revoked. That rule
    // exists so a fresh sign-in retires the previous cookie on the same browser;
    // a phone signing in is a different device, and burning the user's browser
    // session because they opened the app would be surprising and wrong. Each
    // device's credential is revoked on its own logout.
    $issued = device_token_issue(
        $db,
        (int) $user['id'],
        $platform,
        (string) ($body['device_name'] ?? ''),
        (string) ($body['app_version'] ?? '')
    );

    // The only time this token is ever transmitted - only its hash is stored.
    json_out([
        'ok' => true,
        'token' => $issued['token'],
        'expires_at' => $issued['expires_at'],
    ]);
}

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
