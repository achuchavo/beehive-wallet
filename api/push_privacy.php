<?php
// Toggle whether push notification BODIES name the wallet and the amount.
//
// Push bodies render on the lock screen, so the default (private) keeps a
// balance movement from being readable by anyone holding the device. This only
// affects what leaves the server for the push service; the in-app alert list
// always shows full detail.
require __DIR__ . '/common.php';
require_post();
require_trusted_caller();

$db = get_db();
$userId = require_user($db);

$body = read_body();
$private = !empty($body['push_private']) ? 1 : 0;

$db->prepare('UPDATE users SET push_private = ? WHERE id = ?')->execute([$private, $userId]);

json_out(['ok' => true, 'push_private' => (bool) $private]);
