<?php
require __DIR__ . '/common.php';
require_post();

$db = get_db();
require_super_admin($db);
$body = read_body();

$key = trim($body['key'] ?? '');
$value = $body['value'] ?? '';

// Only known keys are settable through this endpoint, and each is coerced to
// its own shape - an allow-list, so a typo'd or hostile key cannot write an
// arbitrary row into app_settings.
$booleanKeys = ['uptime_alerts_enabled'];
// key => [min, max]. Rejected rather than clamped: silently storing 500 when
// the admin typed 5000 would look like the save worked as asked.
$intKeys = ['watch_limit' => [WATCH_LIMIT_MIN, WATCH_LIMIT_MAX]];

if (in_array($key, $booleanKeys, true)) {
    $value = !empty($value) && $value !== '0' ? '1' : '0';
} elseif (isset($intKeys[$key])) {
    [$min, $max] = $intKeys[$key];
    $n = filter_var($value, FILTER_VALIDATE_INT);
    if ($n === false || $n < $min || $n > $max) {
        json_error("Value must be a whole number between {$min} and {$max}");
    }
    $value = (string) $n;
} else {
    json_error('Unknown setting');
}

$stmt = $db->prepare(
    'INSERT INTO app_settings (setting_key, setting_value, updated_at)
     VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()'
);
$stmt->execute([$key, $value]);

json_out(['ok' => true, 'key' => $key, 'value' => $value]);
