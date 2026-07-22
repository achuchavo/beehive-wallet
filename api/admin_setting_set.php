<?php
require __DIR__ . '/common.php';
require_post();

$db = get_db();
require_super_admin($db);
$body = read_body();

$key = trim($body['key'] ?? '');
$value = $body['value'] ?? '';

// Only known boolean flags are settable through this endpoint.
$booleanKeys = ['uptime_alerts_enabled'];
if (!in_array($key, $booleanKeys, true)) {
    json_error('Unknown setting');
}
$value = !empty($value) && $value !== '0' ? '1' : '0';

$stmt = $db->prepare(
    'INSERT INTO app_settings (setting_key, setting_value, updated_at)
     VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()'
);
$stmt->execute([$key, $value]);

json_out(['ok' => true, 'key' => $key, 'value' => $value]);
