<?php
require __DIR__ . '/common.php';

$db = get_db();
$adminId = require_admin($db);

// Every section is gated on its own feature grant. A chains-only or
// announcements-only admin is still an admin, but must not receive user
// emails, wallet addresses, or watched-address activity. Unauthorized
// sections are omitted entirely rather than returned as nulls, so the
// frontend cannot be tricked into rendering data it never received.
$ctx = admin_context($db, $adminId);
$can = static fn(string $f): bool => in_array($f, $ctx['features'], true);

$out = ['ok' => true, 'permissions' => $ctx['features']];

// --- Stats -----------------------------------------------------------------
// Aggregate counts are split by the feature that owns the underlying data.
$stats = [];
if ($can('users')) {
    $stats['users'] = (int) $db->query('SELECT COUNT(*) FROM users')->fetchColumn();
    $stats['failed_logins_24h'] = (int) $db->query(
        "SELECT COUNT(*) FROM login_attempts
         WHERE kind = 'login' AND success = 0 AND attempted_at > NOW() - INTERVAL 1 DAY"
    )->fetchColumn();
}
if ($can('uptime')) {
    $stats['watched_addresses'] = (int) $db->query('SELECT COUNT(*) FROM watched_addresses')->fetchColumn();
    $stats['alerts_total'] = (int) $db->query('SELECT COUNT(*) FROM wallet_alerts')->fetchColumn();
    $stats['alerts_24h'] = (int) $db->query(
        'SELECT COUNT(*) FROM wallet_alerts WHERE detected_at > NOW() - INTERVAL 1 DAY'
    )->fetchColumn();

    // Watcher health: freshest last_checked_at across watched addresses.
    $row = $db->query(
        'SELECT MAX(last_checked_at) AS last_run,
                TIMESTAMPDIFF(SECOND, MAX(last_checked_at), NOW()) AS age_seconds
         FROM watched_addresses'
    )->fetch();
    $stats['watcher_last_run'] = $row['last_run'];
    $stats['watcher_age_seconds'] = $row['age_seconds'] === null ? null : (int) $row['age_seconds'];
}
$out['stats'] = $stats;

// --- User directory (PII: emails, wallet addresses, role grants) ------------
if ($can('users')) {
    $out['users'] = $db->query(
        'SELECT u.id, u.email, u.is_admin, u.is_super_admin, u.is_disabled, u.main_address,
                u.created_at, COUNT(w.id) AS watched_count,
                GROUP_CONCAT(DISTINCT p.feature) AS features
         FROM users u
         LEFT JOIN watched_addresses w ON w.user_id = u.id
         LEFT JOIN admin_permissions p ON p.user_id = u.id
         GROUP BY u.id
         ORDER BY u.created_at DESC
         LIMIT 100'
    )->fetchAll();
}

// --- Recent alert activity (watched addresses + labels) ---------------------
if ($can('uptime')) {
    $out['recent_alerts'] = $db->query(
        'SELECT a.id, a.tx_hash, a.amount, a.denom, a.detected_at,
                w.chain_key, w.address, w.label
         FROM wallet_alerts a
         JOIN watched_addresses w ON w.id = a.watched_address_id
         ORDER BY a.detected_at DESC
         LIMIT 20'
    )->fetchAll();
}

json_out($out);
