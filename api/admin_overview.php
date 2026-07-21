<?php
require __DIR__ . '/common.php';

$db = get_db();
require_admin($db);

$stats = [];
$stats['users'] = (int) $db->query('SELECT COUNT(*) FROM users')->fetchColumn();
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

$users = $db->query(
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

$recentAlerts = $db->query(
    'SELECT a.id, a.tx_hash, a.amount, a.denom, a.detected_at,
            w.chain_key, w.address, w.label
     FROM wallet_alerts a
     JOIN watched_addresses w ON w.id = a.watched_address_id
     ORDER BY a.detected_at DESC
     LIMIT 20'
)->fetchAll();

json_out([
    'ok' => true,
    'stats' => $stats,
    'users' => $users,
    'recent_alerts' => $recentAlerts,
]);
