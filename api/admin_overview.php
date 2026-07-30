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
// Read-or-better. Every section here is a READ, so this is the right question
// to ask of a levelled grant - an admin with chains:READ still sees the data,
// they just cannot change it from the screens that render it.
$can = static fn(string $f): bool => context_level($ctx, $f) >= PERM_READ;

$out = [
    'ok' => true,
    'permissions' => $ctx['features'],
    // Per-feature level, so the UI can render a section read-only instead of
    // offering controls the server will refuse. Presentation only.
    'levels' => (object) $ctx['levels'],
    'is_super_admin' => $ctx['is_super_admin'],
];

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
// Wallet-alert analytics: counts over users' watched addresses. Gated on
// 'wallet_alerts', not 'uptime' - an operator who only monitors validator
// liveness has no need for these.
if ($can('wallet_alerts')) {
    $stats['watched_addresses'] = (int) $db->query('SELECT COUNT(*) FROM watched_addresses')->fetchColumn();
    $stats['alerts_total'] = (int) $db->query('SELECT COUNT(*) FROM wallet_alerts')->fetchColumn();
    $stats['alerts_24h'] = (int) $db->query(
        'SELECT COUNT(*) FROM wallet_alerts WHERE detected_at > NOW() - INTERVAL 1 DAY'
    )->fetchColumn();

    // Watcher health, from the watcher's OWN heartbeat.
    //
    // This used to infer liveness from MAX(last_checked_at) across
    // watched_addresses - the freshest address it had polled. That is a proxy
    // for "did any work happen", not for "is it alive", and the two diverge in
    // the most misleading direction possible: with no addresses being watched
    // there is nothing to poll, so the column stays NULL and a perfectly
    // healthy watcher is reported as "not running or stale". A new deployment
    // therefore accuses itself of being broken.
    //
    // The watcher now stamps app_settings.watcher_last_run at the end of every
    // cycle, whether or not it found anything to do.
    $row = $db->query(
        "SELECT setting_value AS last_run,
                TIMESTAMPDIFF(SECOND, setting_value, NOW()) AS age_seconds
         FROM app_settings WHERE setting_key = 'watcher_last_run'"
    )->fetch();
    $stats['watcher_last_run'] = $row ? $row['last_run'] : null;
    $stats['watcher_age_seconds'] = $row && $row['age_seconds'] !== null
        ? (int) $row['age_seconds']
        : null;
    // How many addresses it is actually responsible for, so "healthy but idle"
    // is distinguishable from "healthy and working" on the screen.
    $stats['watcher_watched'] = (int) $db->query('SELECT COUNT(*) FROM watched_addresses')->fetchColumn();
}
$out['stats'] = $stats;

// --- User directory (PII: emails, wallet addresses, role grants) ------------
// Also released to a 'roles' holder: assigning access requires seeing who you
// are assigning it to, so gating this on 'users' alone would leave the access
// screen with an empty list. It is the minimum the feature cannot work without,
// not a widening of what 'roles' is for.
if ($can('users') || $can('roles')) {
    $out['users'] = $db->query(
        'SELECT u.id, u.email, u.is_admin, u.is_super_admin, u.is_disabled, u.main_address,
                u.created_at, COUNT(w.id) AS watched_count,
                GROUP_CONCAT(DISTINCT CONCAT(p.feature, \':\', p.level)) AS features
         FROM users u
         LEFT JOIN watched_addresses w ON w.user_id = u.id
         LEFT JOIN admin_permissions p ON p.user_id = u.id
         GROUP BY u.id
         ORDER BY u.created_at DESC
         LIMIT 100'
    )->fetchAll();
}

// --- Recent alert activity (watched addresses + labels) ---------------------
// This is user PII - the addresses people watch and the names they gave them.
// It was readable with only the 'uptime' permission.
if ($can('wallet_alerts')) {
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
