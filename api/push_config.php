<?php
// Public VAPID key for browser push subscription. Not a secret.
require __DIR__ . '/common.php';

$cfg = json_decode(file_get_contents(__DIR__ . '/push_public_key.json'), true);
json_out(['ok' => true, 'publicKey' => $cfg['publicKey']]);
