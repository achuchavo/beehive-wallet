<?php
// Shared bootstrap for all wallet API endpoints.
// The server only ever stores PUBLIC data: emails, addresses, alarm settings.
// Private keys never reach this API in any form.

declare(strict_types=1);

session_start();
header('Content-Type: application/json; charset=utf-8');

ini_set('display_errors', '0');
error_reporting(E_ALL);

function json_out(array $data, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($data);
    exit;
}

function json_error(string $message, int $status = 400): void
{
    json_out(['ok' => false, 'error' => $message], $status);
}

function read_body(): array
{
    $raw = file_get_contents('php://input');
    $data = json_decode($raw === false ? '' : $raw, true);
    return is_array($data) ? $data : [];
}

function get_db(): PDO
{
    $cfg = require __DIR__ . '/db_config.php';
    $dsn = "mysql:host={$cfg['host']};port={$cfg['port']};dbname={$cfg['database']};charset=utf8mb4";
    $pdo = new PDO($dsn, $cfg['user'], $cfg['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    return $pdo;
}

function require_user(PDO $db): int
{
    if (empty($_SESSION['user_id'])) {
        json_error('Not logged in', 401);
    }
    $userId = (int) $_SESSION['user_id'];
    $stmt = $db->prepare('SELECT is_disabled FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $row = $stmt->fetch();
    if (!$row) {
        $_SESSION = [];
        session_destroy();
        json_error('Not logged in', 401);
    }
    if ((int) $row['is_disabled'] === 1) {
        json_error('Account disabled', 403);
    }
    return $userId;
}

// Admin features that can be granted individually. Super admins have all.
const ADMIN_FEATURES = ['users', 'chains', 'announcements'];

function admin_context(PDO $db, int $userId): array
{
    $stmt = $db->prepare('SELECT is_admin, is_super_admin FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $row = $stmt->fetch();
    $isAdmin = $row && (int) $row['is_admin'] === 1;
    $isSuper = $row && (int) $row['is_super_admin'] === 1;

    if ($isSuper) {
        return ['is_admin' => true, 'is_super_admin' => true, 'features' => ADMIN_FEATURES];
    }
    $features = [];
    if ($isAdmin) {
        $stmt = $db->prepare('SELECT feature FROM admin_permissions WHERE user_id = ?');
        $stmt->execute([$userId]);
        $features = array_column($stmt->fetchAll(), 'feature');
    }
    return ['is_admin' => $isAdmin, 'is_super_admin' => false, 'features' => $features];
}

function require_admin(PDO $db): int
{
    $userId = require_user($db);
    $ctx = admin_context($db, $userId);
    if (!$ctx['is_admin']) {
        json_error('Admins only', 403);
    }
    return $userId;
}

function require_permission(PDO $db, string $feature): int
{
    $userId = require_user($db);
    $ctx = admin_context($db, $userId);
    if (!$ctx['is_admin'] || !in_array($feature, $ctx['features'], true)) {
        json_error('You do not have access to this feature', 403);
    }
    return $userId;
}

function require_super_admin(PDO $db): int
{
    $userId = require_user($db);
    $ctx = admin_context($db, $userId);
    if (!$ctx['is_super_admin']) {
        json_error('Super admins only', 403);
    }
    return $userId;
}

// Basic bech32 shape check (not full checksum validation - the watcher
// verifies addresses against the chain before first poll).
function looks_like_address(string $address, string $prefix): bool
{
    return (bool) preg_match('/^' . preg_quote($prefix, '/') . '1[a-z0-9]{20,80}$/', $address);
}

// Real client IP. Behind Cloudflare, CF-Connecting-IP is set by Cloudflare and
// is the user's address; fall back to the socket peer otherwise.
function client_ip(): string
{
    foreach (['HTTP_CF_CONNECTING_IP', 'REMOTE_ADDR'] as $key) {
        if (!empty($_SERVER[$key])) {
            return substr(trim($_SERVER[$key]), 0, 45);
        }
    }
    return 'unknown';
}

// Rolling-window rate limit config.
const RATE_WINDOW_MINUTES = 15;
const RATE_MAX_PER_IP = 10;        // failed logins per IP per window
const RATE_MAX_PER_IDENTIFIER = 5; // failed logins per account per window
const RATE_MAX_REGISTER_PER_IP = 5; // new accounts per IP per window

function record_attempt(PDO $db, string $ip, string $identifier, string $kind, bool $success): void
{
    $stmt = $db->prepare(
        'INSERT INTO login_attempts (ip, identifier, kind, success, attempted_at)
         VALUES (?, ?, ?, ?, NOW())'
    );
    $stmt->execute([$ip, mb_substr($identifier, 0, 190), $kind, $success ? 1 : 0]);

    // Opportunistic cleanup of old rows (~1% of requests).
    if (random_int(1, 100) === 1) {
        $db->exec('DELETE FROM login_attempts WHERE attempted_at < NOW() - INTERVAL 1 DAY');
    }
}

function count_recent_failures(PDO $db, string $column, string $value, string $kind): int
{
    $sql = "SELECT COUNT(*) FROM login_attempts
            WHERE $column = ? AND kind = ? AND success = 0
              AND attempted_at > NOW() - INTERVAL " . RATE_WINDOW_MINUTES . ' MINUTE';
    $stmt = $db->prepare($sql);
    $stmt->execute([$value, $kind]);
    return (int) $stmt->fetchColumn();
}

// Enforce login rate limits. Call before checking the password.
function enforce_login_rate_limit(PDO $db, string $ip, string $identifier): void
{
    if (count_recent_failures($db, 'ip', $ip, 'login') >= RATE_MAX_PER_IP) {
        rate_limited();
    }
    if ($identifier !== '' &&
        count_recent_failures($db, 'identifier', $identifier, 'login') >= RATE_MAX_PER_IDENTIFIER) {
        rate_limited();
    }
}

function rate_limited(): void
{
    header('Retry-After: ' . (RATE_WINDOW_MINUTES * 60));
    json_error('Too many attempts. Please wait a few minutes and try again.', 429);
}
