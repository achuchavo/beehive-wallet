<?php
require __DIR__ . '/common.php';

$body = read_body();
$email = strtolower(trim($body['email'] ?? ''));
$password = $body['password'] ?? '';
$mainAddress = trim($body['main_address'] ?? '');

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    json_error('Enter a valid email address');
}
if (strlen($password) < 10) {
    json_error('Password must be at least 10 characters');
}

// Main address is optional, but if given it must be a valid, unused address.
$storeAddress = null;
if ($mainAddress !== '') {
    $chains = json_decode(file_get_contents(__DIR__ . '/chains.json'), true);
    $prefix = $chains[0]['bech32Prefix'];
    if (!looks_like_address($mainAddress, $prefix)) {
        json_error("Enter a valid {$chains[0]['chainName']} address, or leave it blank");
    }
    $storeAddress = $mainAddress;
}

$db = get_db();

$stmt = $db->prepare('SELECT id FROM users WHERE email = ?');
$stmt->execute([$email]);
if ($stmt->fetch()) {
    json_error('That email is already registered');
}

if ($storeAddress !== null) {
    $stmt = $db->prepare('SELECT id FROM users WHERE main_address = ?');
    $stmt->execute([$storeAddress]);
    if ($stmt->fetch()) {
        json_error('That address is already linked to another account');
    }
}

$hash = password_hash($password, PASSWORD_ARGON2ID);
$stmt = $db->prepare(
    'INSERT INTO users (email, password_hash, main_address, created_at) VALUES (?, ?, ?, NOW())'
);
$stmt->execute([$email, $hash, $storeAddress]);

$_SESSION['user_id'] = (int) $db->lastInsertId();
session_regenerate_id(true);

json_out(['ok' => true]);
