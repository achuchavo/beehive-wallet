<?php
require __DIR__ . '/common.php';
require_post();

require_same_origin();
$body = read_body();
$email = strtolower(trim($body['email'] ?? ''));
$password = (string) ($body['password'] ?? '');

// A wallet address is NOT accepted at registration (audit #19). Proving control
// of an address requires signing a challenge bound to an account, and there is
// no authenticated account yet at this point. Any main_address in the request
// is ignored; the user links it after signing in, via address_challenge.php +
// account_set_address.php, which verifies an ADR-036 signature.
$mainAddress = '';

// Bound input sizes: email fits the column; password has a sane ceiling so a
// megabyte string can't be forced through Argon2id (a hashing-cost DoS).
if (strlen($email) > 190 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    json_error('Enter a valid email address');
}
if (strlen($password) < 10) {
    json_error('Password must be at least 10 characters');
}
if (strlen($password) > 200) {
    json_error('Password is too long (200 characters max)');
}
if (strlen($mainAddress) > 120) {
    json_error('Address is too long');
}

// Main address is optional, but if given it must be a valid, unused address.
$storeAddress = null;
if ($mainAddress !== '') {
    // Any ACTIVE chain, not just the first one. This read chains[0] from the
    // static file, so a Chihuahua address was rejected as "not a valid Medibloc
    // address" - the audit named three endpoints with this bug; this was a
    // fourth.
    $matched = false;
    foreach (active_chains() as $c) {
        if (looks_like_address($mainAddress, $c['bech32Prefix'])) {
            $matched = true;
            break;
        }
    }
    if (!$matched) {
        json_error('Enter a valid wallet address for a supported network, or leave it blank');
    }
    $storeAddress = $mainAddress;
}

$db = get_db();
$ip = client_ip();

// Cap new accounts per IP to prevent mass registration.
if (count_recent_failures($db, 'ip', $ip, 'register') >= RATE_MAX_REGISTER_PER_IP) {
    rate_limited();
}

// Account enumeration: the caller gets one identical message whether the email
// or the wallet address was the conflict (or neither). The precise cause is
// recorded server-side only. Registration is rate-limited per IP above, which
// is what keeps this from becoming an oracle by brute force.
const REGISTER_GENERIC_ERROR =
    'We could not complete that registration. If you already have an account, try signing in instead.';

$conflict = '';

$stmt = $db->prepare('SELECT id FROM users WHERE email = ?');
$stmt->execute([$email]);
if ($stmt->fetch()) {
    $conflict = 'email';
}

if ($conflict === '' && $storeAddress !== null) {
    $stmt = $db->prepare('SELECT id FROM users WHERE main_address = ?');
    $stmt->execute([$storeAddress]);
    if ($stmt->fetch()) {
        $conflict = 'main_address';
    }
}

if ($conflict !== '') {
    error_log("register: conflict on {$conflict} from ip {$ip}");
    // Count the attempt so repeated probing trips the per-IP cap.
    record_attempt($db, $ip, $email, 'register', false);
    json_error(REGISTER_GENERIC_ERROR, 409);
}

$hash = password_hash($password, PASSWORD_ARGON2ID);
$stmt = $db->prepare(
    'INSERT INTO users (email, password_hash, main_address, created_at) VALUES (?, ?, ?, NOW())'
);
$stmt->execute([$email, $hash, $storeAddress]);

// Count this registration against the per-IP cap.
record_attempt($db, $ip, $email, 'register', false);

// Do not auto-login: the user confirms success and signs in explicitly.
json_out(['ok' => true]);
