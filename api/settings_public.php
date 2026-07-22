<?php
require __DIR__ . '/common.php';

$db = get_db();

// Public feature flags the frontend needs before/without auth.
json_out([
    'ok' => true,
    'uptime_alerts_enabled' => get_setting($db, 'uptime_alerts_enabled', '0') === '1',
]);
