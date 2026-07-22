<?php
require __DIR__ . '/common.php';

$db = get_db();
$userId = require_user($db);

$stmt = $db->prepare(
    'SELECT a.id, a.watched_address_id, a.kind, w.chain_key, w.address, w.label,
            a.tx_hash, a.amount, a.denom, a.recipient, a.detected_at, a.is_read
     FROM wallet_alerts a
     JOIN watched_addresses w ON w.id = a.watched_address_id
     WHERE w.user_id = ?
     ORDER BY a.detected_at DESC
     LIMIT 100'
);
$stmt->execute([$userId]);
$alerts = $stmt->fetchAll();

$unread = 0;
foreach ($alerts as $a) {
    if (!(int) $a['is_read']) {
        $unread++;
    }
}

json_out(['ok' => true, 'unread' => $unread, 'alerts' => $alerts]);
