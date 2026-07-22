<?php
require __DIR__ . '/common.php';

$db = get_db();
require_permission($db, 'uptime');

$enabled = get_setting($db, 'uptime_alerts_enabled', '0') === '1';

$subs = $db->query(
    "SELECT s.id, s.user_id, u.email, s.chain_key, s.validator_address, s.moniker,
            s.status, s.authorized_until, s.miss_threshold, s.frequency_minutes,
            s.last_missed, s.last_down_state, s.created_at
     FROM uptime_subscriptions s
     JOIN users u ON u.id = s.user_id
     ORDER BY (s.status = 'pending') DESC, s.created_at DESC
     LIMIT 200"
)->fetchAll();

json_out(['ok' => true, 'enabled' => $enabled, 'subscriptions' => $subs]);
