<?php
// Shared bootstrap for all wallet API endpoints.
// The server only ever stores PUBLIC data: emails, addresses, alarm settings.
// Private keys never reach this API in any form.

declare(strict_types=1);

ini_set('display_errors', '0');
error_reporting(E_ALL);

// --- Session hardening -----------------------------------------------------
// Cookie flags MUST be set before session_start().
const SESSION_IDLE_SECONDS = 3600;             // sign out after 1h of inactivity
const SESSION_ABSOLUTE_SECONDS = 7 * 86400;    // hard cap regardless of activity
const SESSION_REMEMBER_SECONDS = 30 * 86400;   // "stay signed in" lifetime

function cookie_secure(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

ini_set('session.use_strict_mode', '1'); // reject attacker-supplied session ids
ini_set('session.use_only_cookies', '1');
ini_set('session.cookie_httponly', '1');
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'secure' => cookie_secure(),
    'httponly' => true,
    'samesite' => 'Strict',
]);
session_start();

header('Content-Type: application/json; charset=utf-8');
// Authenticated JSON must never be stored by browser or shared caches.
header('Cache-Control: no-store');

// Enforce idle + absolute timeout on every request. A "remember me" session
// skips the idle timeout and gets a longer absolute cap, so the user stays
// signed in until they explicitly log out (or 30 days pass).
if (!empty($_SESSION['user_id'])) {
    $__now = time();
    $__started = (int) ($_SESSION['auth_started_at'] ?? $__now);
    $__last = (int) ($_SESSION['last_seen_at'] ?? $__now);
    $__remember = !empty($_SESSION['remember']);
    $__idleLimit = $__remember ? PHP_INT_MAX : SESSION_IDLE_SECONDS;
    $__absLimit = $__remember ? SESSION_REMEMBER_SECONDS : SESSION_ABSOLUTE_SECONDS;
    if (($__now - $__last) > $__idleLimit || ($__now - $__started) > $__absLimit) {
        session_logout();
    } else {
        $_SESSION['last_seen_at'] = $__now;
    }
}

// Establish an authenticated session (call on successful login). Rotates the
// session id to defeat fixation and stamps the timeout clocks. When $remember
// is true the cookie is made persistent (30 days) instead of session-only.
function session_login(int $userId, bool $remember = false): void
{
    if ($remember) {
        session_set_cookie_params([
            'lifetime' => SESSION_REMEMBER_SECONDS,
            'path' => '/',
            'secure' => cookie_secure(),
            'httponly' => true,
            'samesite' => 'Strict',
        ]);
    }
    session_regenerate_id(true);
    $_SESSION['user_id'] = $userId;
    $_SESSION['auth_started_at'] = time();
    $_SESSION['last_seen_at'] = time();
    $_SESSION['remember'] = $remember;
}

// Fully invalidate the session and delete its cookie.
function session_logout(): void
{
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires' => time() - 42000,
            'path' => $p['path'],
            'domain' => $p['domain'],
            'secure' => $p['secure'],
            'httponly' => $p['httponly'],
            'samesite' => $p['samesite'] ?? 'Strict',
        ]);
    }
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_destroy();
    }
}

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

// CSRF defense for cookie-authenticated requests. `Sec-Fetch-Site` is set by the
// browser and cannot be forged by a cross-site attacker; `none` covers a user
// typing the URL / a bookmark. We fall back to Origin-host comparison for the
// rare client that omits Sec-Fetch-Site. CosmJS RPC/LCD proxy traffic is
// unauthenticated (no session cookie) so it never reaches this check.
function require_same_origin(): void
{
    $site = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '';
    if ($site !== '') {
        if (in_array($site, ['same-origin', 'same-site', 'none'], true)) {
            return;
        }
        json_error('Cross-site request blocked', 403);
    }
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '') {
        return; // no Origin (e.g. same-origin GET / legacy client)
    }
    $originHost = parse_url($origin, PHP_URL_HOST);
    $host = preg_replace('/:\d+$/', '', $_SERVER['HTTP_HOST'] ?? '');
    if ($originHost === null || strcasecmp($originHost, (string) $host) !== 0) {
        json_error('Cross-origin request blocked', 403);
    }
}

function require_user(PDO $db): int
{
    // Every authenticated endpoint (read or write) is same-origin only.
    require_same_origin();
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
const ADMIN_FEATURES = ['users', 'chains', 'announcements', 'uptime'];

// Read a global setting from app_settings, with a default fallback.
function get_setting(PDO $db, string $key, string $default = ''): string
{
    $stmt = $db->prepare('SELECT setting_value FROM app_settings WHERE setting_key = ?');
    $stmt->execute([$key]);
    $val = $stmt->fetchColumn();
    return $val === false ? $default : (string) $val;
}

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

// Direct socket peers we trust to set a real forwarded-client-IP header. With
// DNS-only Cloudflare (grey cloud, no proxy in the request path) this stays
// empty, so we always use REMOTE_ADDR - which a client cannot forge. If the
// orange cloud is later enabled, add Cloudflare's edge IPs here.
const TRUSTED_PROXIES = [];

// Real client IP. Only honors CF-Connecting-IP when the direct peer is a trusted
// proxy; otherwise uses the socket peer. Prevents rate-limit bypass via a spoofed
// CF-Connecting-IP header when the request reaches PHP directly.
function client_ip(): string
{
    $peer = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    if (
        in_array($peer, TRUSTED_PROXIES, true)
        && !empty($_SERVER['HTTP_CF_CONNECTING_IP'])
    ) {
        return substr(trim($_SERVER['HTTP_CF_CONNECTING_IP']), 0, 45);
    }
    return substr((string) $peer, 0, 45);
}

// --- SSRF guards -----------------------------------------------------------
// A public routable IP: rejects private (10/8, 172.16/12, 192.168/16, fc00::/7),
// reserved/loopback (127/8, ::1), link-local (169.254/16 incl. the 169.254.169.254
// metadata address, fe80::/10) and other reserved ranges.
function is_public_ip(string $ip): bool
{
    return (bool) filter_var(
        $ip,
        FILTER_VALIDATE_IP,
        FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
    );
}

// Full validation for admin-configured node URLs (used at save time): must be
// HTTPS and resolve only to public IPs. Rejects unresolvable hosts.
function is_safe_public_url(string $url): bool
{
    $p = parse_url($url);
    if ($p === false || ($p['scheme'] ?? '') !== 'https' || empty($p['host'])) {
        return false;
    }
    $host = $p['host'];
    if (filter_var($host, FILTER_VALIDATE_IP)) {
        return is_public_ip($host);
    }
    $ips = [];
    $records = @dns_get_record($host, DNS_A | DNS_AAAA) ?: [];
    foreach ($records as $r) {
        if (!empty($r['ip'])) {
            $ips[] = $r['ip'];
        }
        if (!empty($r['ipv6'])) {
            $ips[] = $r['ipv6'];
        }
    }
    if (!$ips) {
        $v4 = @gethostbyname($host);
        if ($v4 && $v4 !== $host) {
            $ips[] = $v4;
        }
    }
    if (!$ips) {
        return false;
    }
    foreach ($ips as $ip) {
        if (!is_public_ip($ip)) {
            return false;
        }
    }
    return true;
}

// Cheap request-time guard for the proxies: HTTPS only and, for IP-literal hosts,
// must be public. Hostnames are trusted here because they were validated with a
// full DNS check when the admin saved them (see admin_endpoint_save.php).
function proxy_url_ok(string $url): bool
{
    $p = parse_url($url);
    if (!$p || ($p['scheme'] ?? '') !== 'https' || empty($p['host'])) {
        return false;
    }
    if (filter_var($p['host'], FILTER_VALIDATE_IP) && !is_public_ip($p['host'])) {
        return false;
    }
    return true;
}

// Best-effort per-IP + global rate limit for the public proxies, using APCu when
// available (in-memory, no DB write per request). A no-op if APCu is absent - the
// size/timeout caps still apply. Emits 429 and exits when exceeded.
function proxy_rate_limit(string $ip, int $perIpPerMin = 300, int $globalPerMin = 3000): void
{
    if (!function_exists('apcu_fetch') || !@apcu_enabled()) {
        return;
    }
    $bucket = (int) floor(time() / 60);
    foreach ([["proxy_ip_{$ip}_{$bucket}", $perIpPerMin], ["proxy_all_{$bucket}", $globalPerMin]] as [$key, $limit]) {
        $n = apcu_inc($key, 1, $ok, 90);
        if ($n !== false && $n > $limit) {
            header('Retry-After: 60');
            json_out(['error' => 'Rate limit exceeded. Please slow down.'], 429);
        }
    }
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
