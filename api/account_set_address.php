<?php
require __DIR__ . '/common.php';
require_post();

$db = get_db();
$userId = require_user($db);
$body = read_body();
$mainAddress = trim($body['main_address'] ?? '');

$storeAddress = null;
if ($mainAddress !== '') {
    $chains = json_decode(file_get_contents(__DIR__ . '/chains.json'), true);
    $prefix = $chains[0]['bech32Prefix'];
    if (!looks_like_address($mainAddress, $prefix)) {
        json_error("Enter a valid {$chains[0]['chainName']} address");
    }
    $stmt = $db->prepare('SELECT id FROM users WHERE main_address = ? AND id <> ?');
    $stmt->execute([$mainAddress, $userId]);
    if ($stmt->fetch()) {
        json_error('That address is already linked to another account');
    }
    $storeAddress = $mainAddress;
}

$stmt = $db->prepare('UPDATE users SET main_address = ? WHERE id = ?');
$stmt->execute([$storeAddress, $userId]);

json_out(['ok' => true, 'main_address' => $storeAddress]);
