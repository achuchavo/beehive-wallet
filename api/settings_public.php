<?php
require __DIR__ . '/common.php';

$db = get_db();

// Public feature flags the frontend needs before/without auth. The watch limit
// is a product rule rather than a secret - the admin screen reads it here, and
// the signed-out alarms page can state it before anyone registers.
json_out([
    'ok' => true,
    'uptime_alerts_enabled' => get_setting($db, 'uptime_alerts_enabled', '0') === '1',
    'watch_limit' => watch_limit($db),
]);
