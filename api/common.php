<?php
// Shared bootstrap for all wallet API endpoints.
// The server only ever stores PUBLIC data: emails, addresses, alarm settings.
// Private keys never reach this API in any form.

declare(strict_types=1);

ini_set('display_errors', '0');
error_reporting(E_ALL);

// Pure validation/policy helpers (bech32, origin policy, role hierarchy, SSRF
// address rules). Kept separate so they are unit-testable without a session or
// database - see api/tests/run.php.
require_once __DIR__ . '/security_lib.php';

// --- Session hardening -----------------------------------------------------
// Cookie flags MUST be set before session_start().
const SESSION_IDLE_SECONDS = 3600;             // sign out after 1h of inactivity
const SESSION_ABSOLUTE_SECONDS = 7 * 86400;    // hard cap regardless of activity
// NOTE: "stay signed in" no longer extends the session itself - see
// REMEMBER_TTL and remember_issue() further down. There is no password-change
// endpoint yet; when one is added it MUST call remember_revoke_all().

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

// Enforce idle + absolute timeout on every request. These limits now apply
// uniformly: "remember me" no longer stretches the primary session (which made
// a stolen session id valid for 30 days). Instead a separate rotating token
// re-establishes a fresh short session - see remember_resume() below.
if (!empty($_SESSION['user_id'])) {
    $__now = time();
    $__started = (int) ($_SESSION['auth_started_at'] ?? $__now);
    $__last = (int) ($_SESSION['last_seen_at'] ?? $__now);
    if (
        ($__now - $__last) > SESSION_IDLE_SECONDS
        || ($__now - $__started) > SESSION_ABSOLUTE_SECONDS
    ) {
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
    session_regenerate_id(true);
    $_SESSION['user_id'] = $userId;
    $_SESSION['auth_started_at'] = time();
    $_SESSION['last_seen_at'] = time();
    $_SESSION['remember'] = $remember;
    // The session cookie itself stays session-scoped. Persistence is provided
    // by a separate rotating token (remember_issue), so the session id is never
    // long-lived. Callers pass $remember through to remember_issue().
}

// --- "Remember me" tokens (audit #18) ---------------------------------------
// Selector + verifier in one cookie: "<selector>:<verifier>". The selector
// finds the row; only a SHA-256 of the verifier is stored, so a database leak
// yields no usable cookie. Every use rotates the verifier.

const REMEMBER_COOKIE = 'beehive_remember';
const REMEMBER_TTL = 30 * 86400;   // 30 days
const REMEMBER_GRACE_SECONDS = 60; // window in which the previous verifier still works

function remember_cookie_options(int $expires): array
{
    return [
        'expires' => $expires,
        'path' => '/',
        'secure' => cookie_secure(),
        'httponly' => true,
        'samesite' => 'Strict',
    ];
}

/** Mint a token for $userId and send it as a persistent cookie. */
function remember_issue(PDO $db, int $userId): void
{
    $selector = bin2hex(random_bytes(16));
    $verifier = bin2hex(random_bytes(32));

    $stmt = $db->prepare(
        'INSERT INTO remember_tokens
            (user_id, selector, verifier_hash, expires_at, user_agent, ip, created_at)
         VALUES (?, ?, ?, NOW() + INTERVAL ' . REMEMBER_TTL . ' SECOND, ?, ?, NOW())'
    );
    $stmt->execute([
        $userId,
        $selector,
        hash('sha256', $verifier),
        mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255),
        client_ip(),
    ]);

    setcookie(REMEMBER_COOKIE, "{$selector}:{$verifier}", remember_cookie_options(time() + REMEMBER_TTL));

    // Opportunistic cleanup of expired rows.
    if (random_int(1, 50) === 1) {
        $db->exec('DELETE FROM remember_tokens WHERE expires_at < NOW()');
    }
}

function remember_clear_cookie(): void
{
    setcookie(REMEMBER_COOKIE, '', remember_cookie_options(time() - 42000));
}

/** Revoke every token for a user (password change, theft detection, disable). */
function remember_revoke_all(PDO $db, int $userId): void
{
    $db->prepare('DELETE FROM remember_tokens WHERE user_id = ?')->execute([$userId]);
}

/** Revoke only the token presented by this request, and drop the cookie. */
function remember_revoke_current(PDO $db): void
{
    $raw = (string) ($_COOKIE[REMEMBER_COOKIE] ?? '');
    if ($raw !== '' && str_contains($raw, ':')) {
        [$selector] = explode(':', $raw, 2);
        if (preg_match('/^[0-9a-f]{32}$/', $selector)) {
            $db->prepare('DELETE FROM remember_tokens WHERE selector = ?')->execute([$selector]);
        }
    }
    remember_clear_cookie();
}

/**
 * If there is no active session but a valid remember cookie, re-establish one
 * and rotate the token. Returns the user id, or null.
 *
 * Called lazily (only where authentication is actually needed) so the public
 * RPC/LCD proxies never pay for a database lookup.
 */
function remember_resume(PDO $db): ?int
{
    if (!empty($_SESSION['user_id'])) {
        return (int) $_SESSION['user_id'];
    }
    $raw = (string) ($_COOKIE[REMEMBER_COOKIE] ?? '');
    if ($raw === '' || !str_contains($raw, ':')) {
        return null;
    }
    [$selector, $verifier] = explode(':', $raw, 2);
    if (!preg_match('/^[0-9a-f]{32}$/', $selector) || !preg_match('/^[0-9a-f]{64}$/', $verifier)) {
        remember_clear_cookie();
        return null;
    }

    $db->beginTransaction();
    try {
        $stmt = $db->prepare(
            'SELECT t.id, t.user_id, t.verifier_hash, t.prev_verifier_hash, t.rotated_at,
                    (t.expires_at > NOW()) AS still_valid,
                    (t.rotated_at IS NOT NULL
                     AND t.rotated_at > NOW() - INTERVAL ' . REMEMBER_GRACE_SECONDS . ' SECOND) AS in_grace,
                    u.is_disabled
             FROM remember_tokens t
             JOIN users u ON u.id = t.user_id
             WHERE t.selector = ?
             FOR UPDATE'
        );
        $stmt->execute([$selector]);
        $row = $stmt->fetch();

        if (!$row) {
            $db->commit();
            remember_clear_cookie();
            return null;
        }

        $hash = hash('sha256', $verifier);
        $matchesCurrent = hash_equals((string) $row['verifier_hash'], $hash);
        $matchesPrev = $row['prev_verifier_hash'] !== null
            && (int) $row['in_grace'] === 1
            && hash_equals((string) $row['prev_verifier_hash'], $hash);

        if (!$matchesCurrent && !$matchesPrev) {
            // A known selector with an unrecognised verifier means a stolen or
            // superseded token was replayed. Burn every token for this user.
            remember_revoke_all($db, (int) $row['user_id']);
            $db->commit();
            remember_clear_cookie();
            error_log('remember: verifier mismatch for user ' . $row['user_id'] . ' - all tokens revoked');
            return null;
        }

        if ((int) $row['still_valid'] !== 1 || (int) $row['is_disabled'] === 1) {
            $db->prepare('DELETE FROM remember_tokens WHERE id = ?')->execute([$row['id']]);
            $db->commit();
            remember_clear_cookie();
            return null;
        }

        // Rotate: new verifier, previous one honoured for the grace window so
        // parallel requests carrying the same cookie still succeed.
        $newVerifier = bin2hex(random_bytes(32));
        $db->prepare(
            'UPDATE remember_tokens
             SET prev_verifier_hash = verifier_hash,
                 verifier_hash = ?,
                 rotated_at = NOW(),
                 last_used_at = NOW(),
                 ip = ?
             WHERE id = ?'
        )->execute([hash('sha256', $newVerifier), client_ip(), $row['id']]);
        $db->commit();

        setcookie(
            REMEMBER_COOKIE,
            "{$selector}:{$newVerifier}",
            remember_cookie_options(time() + REMEMBER_TTL)
        );

        $userId = (int) $row['user_id'];
        session_login($userId, true);
        return $userId;
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        error_log('remember_resume failed: ' . $e->getMessage());
        return null;
    }
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

/**
 * Default cap on a JSON request body.
 *
 * Every endpoint here takes small structured JSON - addresses, labels, a
 * password. 64 KB is far above any legitimate payload and far below anything
 * that costs memory. Push subscriptions carry a slightly larger blob, so they
 * pass their own limit.
 */
const MAX_BODY_BYTES = 65536;

/**
 * Parse the JSON request body, refusing anything oversized.
 *
 * The read is BOUNDED rather than "read it all, then check": measuring after
 * the fact means the whole body is already in memory, which is precisely what
 * the limit is meant to prevent. Content-Length is checked first as a cheap
 * rejection, but it is client-supplied, so the stream read is capped too and
 * that is what actually enforces the limit.
 */
function read_body(int $maxBytes = MAX_BODY_BYTES): array
{
    $declared = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($declared > $maxBytes) {
        json_out(['error' => 'Request body too large'], 413);
    }

    $in = fopen('php://input', 'rb');
    if ($in === false) {
        return [];
    }
    // One byte past the limit is enough to know it was exceeded.
    $raw = (string) stream_get_contents($in, $maxBytes + 1);
    fclose($in);
    if (strlen($raw) > $maxBytes) {
        json_out(['error' => 'Request body too large'], 413);
    }

    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function get_db(): PDO
{
    // require_once, not require: get_db() is called more than once per request,
    // and any stray leading bytes in the config file (e.g. a UTF-8 BOM added by
    // an editor) would otherwise be echoed into the response body each time.
    static $cfg = null;
    if ($cfg === null) {
        $cfg = require __DIR__ . '/db_config.php';
    }
    $dsn = "mysql:host={$cfg['host']};port={$cfg['port']};dbname={$cfg['database']};charset=utf8mb4";
    $pdo = new PDO($dsn, $cfg['user'], $cfg['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    return $pdo;
}

// CSRF gate for cookie-authenticated requests. The policy itself lives in
// security_lib.php (origin_denied_reason) so it can be unit-tested; note that
// `same-site` is NOT trusted, so a compromised sibling subdomain cannot drive
// authenticated mutations. CosmJS RPC/LCD proxy traffic is unauthenticated
// (no session cookie) so it never reaches this check.
/**
 * The deployment's own canonical origins (scheme + host + port).
 *
 * Configure BEEHIVE_TRUSTED_ORIGINS in api/db_config.php as a PHP array to make
 * CSRF policy independent of the reflected Host header. With none configured
 * the check falls back to Host comparison, which is weaker but keeps an
 * unconfigured deployment working instead of blocking every mutation.
 */
function trusted_origins(): array
{
    static $cached = null;
    if ($cached !== null) {
        return $cached;
    }
    $cached = defined('BEEHIVE_TRUSTED_ORIGINS') && is_array(BEEHIVE_TRUSTED_ORIGINS)
        ? BEEHIVE_TRUSTED_ORIGINS
        : [];
    return $cached;
}

function require_same_origin(): void
{
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $reason = origin_denied_reason(
        $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '',
        $_SERVER['HTTP_ORIGIN'] ?? '',
        $_SERVER['HTTP_HOST'] ?? '',
        is_mutating_method($method),
        trusted_origins()
    );
    if ($reason !== '') {
        json_error('Cross-origin request blocked', 403);
    }
}

// State-changing endpoints must be POST: a mutation must never be reachable by
// a GET navigation (<img src>, link prefetch, browser history replay).
function require_post(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        header('Allow: POST');
        json_error('Method not allowed', 405);
    }
    // JSON endpoints only. This also blocks HTML form cross-submission, which
    // can only send urlencoded/multipart/plain content types.
    $ct = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0]));
    if ($ct !== '' && $ct !== 'application/json') {
        json_error('Unsupported content type', 415);
    }
}

function require_user(PDO $db): int
{
    // Every authenticated endpoint (read or write) is same-origin only.
    require_same_origin();
    // Lazily re-establish a session from a "remember me" token. Done here (and
    // in me.php) rather than at bootstrap so the unauthenticated RPC/LCD
    // proxies never trigger a database lookup on every request.
    if (empty($_SESSION['user_id'])) {
        remember_resume($db);
    }
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
// 'wallet_alerts' is separate from 'uptime' on purpose: uptime is about
// validator liveness, while wallet-alert data exposes users' watched ADDRESSES
// and labels. Granting one should not grant the other.
const ADMIN_FEATURES = ['users', 'chains', 'announcements', 'uptime', 'wallet_alerts'];

/**
 * Best-effort audit trail for administrator account changes. Never allowed to
 * break the action itself: if the table has not been migrated yet the failure
 * is logged to the PHP error log instead. See docs/migrations/004.
 */
function audit_admin_action(PDO $db, int $actorId, int $targetId, string $action, string $detail = ''): void
{
    try {
        $stmt = $db->prepare(
            'INSERT INTO admin_audit_log (actor_user_id, target_user_id, action, detail, ip, created_at)
             VALUES (?, ?, ?, ?, ?, NOW())'
        );
        $stmt->execute([$actorId, $targetId, mb_substr($action, 0, 40), mb_substr($detail, 0, 255), client_ip()]);
    } catch (Throwable $e) {
        error_log('admin_audit_log write failed: ' . $e->getMessage());
    }
}

// Read a global setting from app_settings, with a default fallback.
function get_setting(PDO $db, string $key, string $default = ''): string
{
    $stmt = $db->prepare('SELECT setting_value FROM app_settings WHERE setting_key = ?');
    $stmt->execute([$key]);
    $val = $stmt->fetchColumn();
    return $val === false ? $default : (string) $val;
}

// Per-user cap on watched addresses. Admin-configurable through app_settings,
// so raising it is a setting change rather than a redeploy.
const WATCH_LIMIT_DEFAULT = 20;
const WATCH_LIMIT_MIN = 1;
const WATCH_LIMIT_MAX = 500;

/**
 * The effective watch limit.
 *
 * Bounds are enforced on READ, not just when the admin saves: the value lives
 * in a table anyone with DB access can edit, and a junk or out-of-range entry
 * must not be able to remove the cap entirely (unbounded rows per user) or set
 * it to zero and lock every user out of a feature they already use.
 */
function watch_limit(PDO $db): int
{
    $raw = filter_var(
        get_setting($db, 'watch_limit', (string) WATCH_LIMIT_DEFAULT),
        FILTER_VALIDATE_INT
    );
    if ($raw === false || $raw < WATCH_LIMIT_MIN || $raw > WATCH_LIMIT_MAX) {
        return WATCH_LIMIT_DEFAULT;
    }
    return $raw;
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

// Full bech32 validation (checksum + exact HRP + payload length + canonical
// lowercase). Implemented in security_lib.php; this wrapper keeps the original
// call sites working.
function looks_like_address(string $address, string $prefix): bool
{
    return is_account_address($address, $prefix);
}

// --- Address ownership challenges (audit #19) -------------------------------
const ADDRESS_CHALLENGE_TTL = 300;                  // 5 minutes
const ADDRESS_CHALLENGE_ACTION = 'link-address';


/**
 * Metadata for ONE active chain, or null.
 *
 * Sourced from the `chains` table - the same authority the frontend
 * (chains_public.php) and the watcher (SELECT * FROM chains WHERE is_active)
 * already use. It previously read a static api/chains.json that deploy.ps1
 * copied from config/, which listed Medibloc only: every Chihuahua address
 * link, watched address and uptime subscription was rejected as "Unknown
 * chain" even though the UI happily created Chihuahua wallets. A file that has
 * to be redeployed to match the database is a second source of truth, so it is
 * gone rather than regenerated.
 *
 * Fails CLOSED. If the registry cannot be read, callers get null and answer
 * "Unknown chain" - the alternative, falling back to a stale list, risks
 * authorising an address against the wrong network.
 */
function chain_config(string $chainKey): ?array
{
    // An empty key is not a request for "the default chain". It used to return
    // $chains[0], so a client that omitted chain_key silently got Medibloc -
    // exactly the silent-default the audit flags.
    if ($chainKey === '') {
        return null;
    }
    foreach (active_chains() as $c) {
        if ($c['key'] === $chainKey) {
            return $c;
        }
    }
    return null;
}

/**
 * Every active chain, in display order, keyed camelCase to match the shape the
 * frontend and the old static file used.
 */
function active_chains(): array
{
    static $cache = null;
    if ($cache !== null) {
        return $cache;
    }
    try {
        $db = get_db();
        $rows = $db->query(
            'SELECT * FROM chains WHERE is_active = 1 ORDER BY sort_order, chain_name'
        )->fetchAll();
        $epStmt = $db->prepare(
            "SELECT kind, url FROM chain_endpoints
             WHERE chain_key = ? AND is_active = 1 ORDER BY priority, id"
        );
        $out = [];
        foreach ($rows as $r) {
            // Highest-priority endpoint of each kind; the proxies do their own
            // failover, so one representative URL is all this shape carries.
            $lcd = '';
            $rpc = '';
            $epStmt->execute([$r['chain_key']]);
            foreach ($epStmt->fetchAll() as $ep) {
                if ($ep['kind'] === 'lcd' && $lcd === '') $lcd = $ep['url'];
                if ($ep['kind'] === 'rpc' && $rpc === '') $rpc = $ep['url'];
            }
            $out[] = [
                'key' => $r['chain_key'],
                'chainId' => $r['chain_id'],
                'chainName' => $r['chain_name'],
                'bech32Prefix' => $r['bech32_prefix'],
                'denom' => $r['denom'],
                'displayDenom' => $r['display_denom'],
                'decimals' => (int) $r['decimals'],
                'lcd' => $lcd,
                'rpc' => $rpc,
                'beehiveValidator' => $r['beehive_validator'],
                'beehiveMoniker' => $r['beehive_moniker'],
            ];
        }
        $cache = $out;
    } catch (Throwable $e) {
        // Fail closed - see chain_config().
        error_log('active_chains: registry unavailable: ' . $e->getMessage());
        $cache = [];
    }
    return $cache;
}

/**
 * The exact human-readable text a user signs to prove they control an address.
 *
 * Every field the signature must be bound to appears here: the domain (so a
 * signature cannot be replayed against another deployment), the action (so it
 * cannot be reused for a different operation), the account, the address, the
 * single-use nonce, and the expiry. The server rebuilds this from its own
 * stored row at redemption - a client-supplied version is never trusted.
 */
function address_challenge_message(
    int $userId,
    string $address,
    string $nonce,
    string $domain,
    string $expiresIso
): string {
    return "Beehive Wallet - address ownership proof\n"
        . "Domain: {$domain}\n"
        . 'Action: ' . ADDRESS_CHALLENGE_ACTION . "\n"
        . "Address: {$address}\n"
        . "Account: {$userId}\n"
        . "Nonce: {$nonce}\n"
        . "Expires: {$expiresIso}\n"
        . "\nSigning this proves you hold the key for this address. "
        . 'It authorises nothing else and moves no funds.';
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
// is_public_ip() / outbound_url_denied_reason() live in security_lib.php.

/** Every A/AAAA address a hostname currently resolves to. */
function resolve_host_ips(string $host): array
{
    if (filter_var($host, FILTER_VALIDATE_IP)) {
        return [$host];
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
    return $ips;
}

/**
 * Resolve a URL's host and require that EVERY returned address is public.
 * Returns the validated IP list, or null if the URL is unsafe/unresolvable.
 * Used both at admin save time and immediately before each outbound request,
 * so a hostname whose DNS later flips to an internal address is caught.
 */
function validated_target_ips(string $url): ?array
{
    if (outbound_url_denied_reason($url) !== '') {
        return null;
    }
    $host = (string) parse_url($url, PHP_URL_HOST);
    $ips = resolve_host_ips(trim($host, '[]'));
    if (!$ips) {
        return null;
    }
    foreach ($ips as $ip) {
        if (!is_public_ip($ip)) {
            return null;
        }
    }
    return $ips;
}

// Full validation for admin-configured node URLs (used at save time).
function is_safe_public_url(string $url): bool
{
    return validated_target_ips($url) !== null;
}

// Request-time guard for the proxies. Unlike before, this re-resolves DNS on
// every request instead of trusting the hostname that was validated at save
// time - which is what closes the DNS-rebinding window.
function proxy_url_ok(string $url): bool
{
    return validated_target_ips($url) !== null;
}

/**
 * Shared cURL hardening for outbound proxy calls: no redirects (each hop would
 * bypass validation), pinned resolution to the addresses we just validated, and
 * a bounded body read that fails loudly instead of returning truncated JSON.
 *
 * Returns ['body'=>string,'status'=>int,'error'=>string,'too_large'=>bool].
 */
/**
 * cURL transport for proxy_fetch(). Pins the connection to $ips, the addresses
 * validated moments earlier, so DNS cannot be re-pointed at an internal host
 * between validation and connect.
 *
 * Redirects are refused rather than followed: each hop would otherwise reach a
 * destination that was never validated.
 */
function proxy_fetch_curl(
    string $url,
    string $host,
    int $port,
    array $ips,
    ?string $post,
    int $timeout,
    int $maxBytes
): array {
    // curl's --resolve syntax is HOST:PORT:ADDR[,ADDR...]; IPv6 literals must
    // be bracketed or their colons are mistaken for field separators.
    $pinned = array_map(
        static fn(string $ip): string => str_contains($ip, ':') ? "[{$ip}]" : $ip,
        $ips
    );

    $body = '';
    $tooLarge = false;

    $ch = curl_init($url);
    if ($ch === false) {
        return ['body' => '', 'status' => 0, 'error' => 'curl init failed', 'too_large' => false];
    }

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => false,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_MAXREDIRS => 0,
        CURLOPT_CONNECTTIMEOUT => $timeout,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
        // The pin. TLS still validates against the ORIGINAL hostname, so this
        // narrows where we connect without weakening certificate checking.
        CURLOPT_RESOLVE => ["{$host}:{$port}:" . implode(',', $pinned)],
        CURLOPT_HTTPHEADER => $post !== null
            ? ['Content-Type: application/json', 'Accept: application/json']
            : ['Accept: application/json'],
        // Bounded read: abort as soon as the cap is passed rather than
        // buffering an arbitrarily large upstream body.
        CURLOPT_WRITEFUNCTION => function ($_ch, string $chunk) use (&$body, &$tooLarge, $maxBytes): int {
            $body .= $chunk;
            if (strlen($body) > $maxBytes) {
                $tooLarge = true;
                return 0; // signals curl to abort the transfer
            }
            return strlen($chunk);
        },
    ]);
    if ($post !== null) {
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $post);
    }

    $ok = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $curlErr = curl_error($ch);
    curl_close($ch);

    if ($tooLarge) {
        return ['body' => '', 'status' => $status, 'error' => 'too_large', 'too_large' => true];
    }
    if ($ok === false) {
        return [
            'body' => '',
            'status' => $status,
            'error' => $curlErr !== '' ? $curlErr : 'request failed',
            'too_large' => false,
        ];
    }
    if ($status >= 300 && $status < 400) {
        return ['body' => '', 'status' => $status, 'error' => 'redirect_blocked', 'too_large' => false];
    }
    return ['body' => $body, 'status' => $status, 'error' => '', 'too_large' => false];
}

function proxy_fetch(string $url, array $opts = []): array
{
    $timeout = (int) ($opts['timeout'] ?? 10);
    $maxBytes = (int) ($opts['max_bytes'] ?? 2 * 1024 * 1024);
    $post = $opts['post'] ?? null;

    $ips = validated_target_ips($url);
    if ($ips === null) {
        return ['body' => '', 'status' => 0, 'error' => 'blocked', 'too_large' => false];
    }

    $parts = parse_url($url);
    $host = trim((string) ($parts['host'] ?? ''), '[]');
    $port = (int) ($parts['port'] ?? 443);

    // Preferred path: cURL, which can PIN the connection to the addresses we
    // just validated (CURLOPT_RESOLVE). Without that pin a hostname could
    // resolve to a public IP during validation and to an internal one moments
    // later at connect time - the DNS-rebinding window. The stream-wrapper
    // fallback below cannot pin, so it is only used where curl is absent.
    if (function_exists('curl_init')) {
        return proxy_fetch_curl($url, $host, $port, $ips, $post, $timeout, $maxBytes);
    }

    // NOTE: reached only when ext/curl is unavailable. Consequence: we cannot
    // pin the connection to the pre-validated IPs the way CURLOPT_RESOLVE does,
    // so a small DNS-rebinding window remains between validation and connect.
    // It is narrowed by revalidating immediately before every request.
    $headers = "Accept: application/json\r\n";
    if ($post !== null) {
        $headers .= "Content-Type: application/json\r\n";
    }
    $ctx = stream_context_create([
        'http' => [
            'method' => $post !== null ? 'POST' : 'GET',
            'header' => $headers,
            'content' => $post ?? '',
            'timeout' => $timeout,
            'ignore_errors' => true,
            // Never auto-follow: a redirect hop would skip SSRF revalidation.
            'follow_location' => 0,
            'max_redirects' => 0,
            'protocol_version' => 1.1,
        ],
        'ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true,
        ],
    ]);

    $fh = @fopen($url, 'rb', false, $ctx);
    if ($fh === false) {
        return ['body' => '', 'status' => 0, 'error' => 'request failed', 'too_large' => false];
    }

    // Status line comes from the wrapper metadata (works inside a function,
    // unlike the magic $http_response_header local).
    $status = 0;
    $meta = stream_get_meta_data($fh);
    foreach ($meta['wrapper_data'] ?? [] as $h) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', (string) $h, $m)) {
            $status = (int) $m[1]; // last status line wins
        }
    }

    // Bounded read: stop as soon as the cap is passed instead of buffering an
    // arbitrarily large upstream body or silently truncating it.
    $body = '';
    $tooLarge = false;
    while (!feof($fh)) {
        $chunk = fread($fh, 16384);
        if ($chunk === false || $chunk === '') {
            break;
        }
        $body .= $chunk;
        if (strlen($body) > $maxBytes) {
            $tooLarge = true;
            break;
        }
    }
    fclose($fh);

    if ($tooLarge) {
        return ['body' => '', 'status' => $status, 'error' => 'too_large', 'too_large' => true];
    }
    // Treat a redirect as a failure rather than following it.
    if ($status >= 300 && $status < 400) {
        return ['body' => '', 'status' => $status, 'error' => 'redirect_blocked', 'too_large' => false];
    }
    return ['body' => $body, 'status' => $status, 'error' => '', 'too_large' => false];
}

// Per-IP + global rate limit for the public proxies. Uses APCu when available
// (in-memory, no DB write per request) and otherwise falls back to a shared
// database counter, so the limiter is never silently disabled. Emits 429 with
// Retry-After and exits when exceeded.
//
// The DB fallback is a fixed 60s bucket keyed by (scope, bucket); rows are
// pruned opportunistically so the table cannot grow without bound.
function proxy_rate_limit(string $ip, int $perIpPerMin = 300, int $globalPerMin = 3000): void
{
    $bucket = (int) floor(time() / 60);
    $scopes = [["ip_{$ip}", $perIpPerMin], ['all', $globalPerMin]];

    if (function_exists('apcu_enabled') && @apcu_enabled()) {
        foreach ($scopes as [$scope, $limit]) {
            $n = apcu_inc("proxy_{$scope}_{$bucket}", 1, $ok, 90);
            if ($n !== false && $n > $limit) {
                rate_limit_exceeded();
            }
        }
        return;
    }

    // --- Shared DB fallback -------------------------------------------------
    // Correct across processes/instances, at the cost of one upsert per request.
    try {
        $db = get_db();
        foreach ($scopes as [$scope, $limit]) {
            $stmt = $db->prepare(
                'INSERT INTO rate_counters (scope, bucket, hits) VALUES (?, ?, 1)
                 ON DUPLICATE KEY UPDATE hits = hits + 1'
            );
            $stmt->execute([mb_substr($scope, 0, 64), $bucket]);

            $stmt = $db->prepare('SELECT hits FROM rate_counters WHERE scope = ? AND bucket = ?');
            $stmt->execute([mb_substr($scope, 0, 64), $bucket]);
            if ((int) $stmt->fetchColumn() > $limit) {
                rate_limit_exceeded();
            }
        }
        if (random_int(1, 200) === 1) {
            $db->prepare('DELETE FROM rate_counters WHERE bucket < ?')->execute([$bucket - 60]);
        }
        return;
    } catch (Throwable $e) {
        // Shared storage unavailable - most commonly because migration 004 has
        // not been applied yet, so `rate_counters` does not exist. Do NOT fail
        // closed here: that would 429 every proxy request and take the whole
        // wallet offline. Do NOT silently skip either. Fall through to the
        // file-backed limiter below, which still enforces a limit.
        error_log('proxy_rate_limit: shared storage unavailable (' . $e->getMessage() . '), using file fallback');
    }

    file_rate_limit($scopes, $bucket);
}

/**
 * Rate limit for SENSITIVE endpoints (auth, registration, admin mutations,
 * ownership challenges), which fails CLOSED.
 *
 * The distinction from proxy_rate_limit() is deliberate and is the whole point
 * of having two functions:
 *
 *   - The RPC/LCD proxies serve public, read-only chain data. Failing closed
 *     there 429s every balance read and takes the entire wallet offline, which
 *     has actually happened here. Availability wins.
 *   - These endpoints gate credentials and privileged state. With no working
 *     limiter an attacker gets unmetered password guesses, so refusing service
 *     is strictly better than serving unlimited attempts. Security wins.
 *
 * Returns nothing; it either allows the request, 429s (limit hit) or 503s (no
 * limiter available at all).
 */
function sensitive_rate_limit(string $scopeKey, int $perMin = 30): void
{
    $bucket = (int) floor(time() / 60);
    $scopes = [[$scopeKey, $perMin]];

    if (function_exists('apcu_enabled') && @apcu_enabled()) {
        $n = apcu_inc("sens_{$scopeKey}_{$bucket}", 1, $ok, 90);
        if ($n !== false && $n > $perMin) {
            rate_limit_exceeded();
        }
        return;
    }

    try {
        $db = get_db();
        $stmt = $db->prepare(
            'INSERT INTO rate_counters (scope, bucket, hits) VALUES (?, ?, 1)
             ON DUPLICATE KEY UPDATE hits = hits + 1'
        );
        $stmt->execute([mb_substr("sens_{$scopeKey}", 0, 64), $bucket]);
        $stmt = $db->prepare('SELECT hits FROM rate_counters WHERE scope = ? AND bucket = ?');
        $stmt->execute([mb_substr("sens_{$scopeKey}", 0, 64), $bucket]);
        if ((int) $stmt->fetchColumn() > $perMin) {
            rate_limit_exceeded();
        }
        return;
    } catch (Throwable $e) {
        error_log('sensitive_rate_limit: shared storage unavailable (' . $e->getMessage() . ')');
    }

    // File counters are per-server, but for a single-server deployment they are
    // a real limit and better than nothing.
    if (file_rate_limit($scopes, $bucket)) {
        return;
    }

    // Nothing worked. Refuse rather than allow unmetered attempts against an
    // authentication surface. 503 + Retry-After, not 429: the client did
    // nothing wrong, the server cannot currently meter it.
    error_log('sensitive_rate_limit: no limiter backend available, failing closed');
    header('Retry-After: 60');
    json_out(['error' => 'Service temporarily unavailable. Please try again shortly.'], 503);
}

/**
 * Last-resort limiter backed by counter files in the system temp dir.
 *
 * LIMITATIONS (documented per audit #4): this is per-server, not shared across
 * instances, so behind multiple app servers each enforces the limit separately.
 * It is a safety net for when APCu is absent AND the DB counter table is
 * unavailable - install APCu or apply migration 004 for correct shared limits.
 * Infrastructure-level limiting (mod_ratelimit / reverse proxy) should back
 * this up regardless; see docs/security-headers.md.
 */
function file_rate_limit(array $scopes, int $bucket): bool
{
    $dir = sys_get_temp_dir() . '/beehive_rl';
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    if (!is_dir($dir) || !is_writable($dir)) {
        error_log('rate_limit: file fallback unavailable');
        return false;
    }
    // True only if at least one scope was actually counted - a caller that
    // fails closed must not treat "every open() failed" as enforcement.
    $enforced = false;

    foreach ($scopes as [$scope, $limit]) {
        $file = $dir . '/' . hash('sha256', $scope . '_' . $bucket) . '.cnt';
        $fh = @fopen($file, 'c+');
        if ($fh === false) {
            continue;
        }
        if (flock($fh, LOCK_EX)) {
            $enforced = true;
            $n = (int) stream_get_contents($fh) + 1;
            ftruncate($fh, 0);
            rewind($fh);
            fwrite($fh, (string) $n);
            fflush($fh);
            flock($fh, LOCK_UN);
            fclose($fh);
            if ($n > $limit) {
                rate_limit_exceeded();
            }
        } else {
            fclose($fh);
        }
    }

    // Opportunistically drop counter files older than a few minutes.
    if (random_int(1, 200) === 1) {
        foreach (glob($dir . '/*.cnt') ?: [] as $f) {
            if (@filemtime($f) < time() - 300) {
                @unlink($f);
            }
        }
    }
    return $enforced;
}

function rate_limit_exceeded(): void
{
    header('Retry-After: 60');
    json_out(['error' => 'Rate limit exceeded. Please slow down.'], 429);
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

/**
 * Enforce login rate limits. Call before checking the password.
 *
 * Fails CLOSED, explicitly. It already did so by accident - count_recent_failures()
 * has no error handling, so an unavailable login_attempts table threw and PHP
 * returned a bare 500 before any password was checked. That was the right
 * outcome reached the wrong way: no operator signal, and one refactor away from
 * becoming fail-open. Now the refusal is deliberate and says why.
 *
 * Unlike proxy_rate_limit(), which stays fail-open because 429ing public chain
 * reads takes the whole wallet down, an authentication surface with no working
 * limiter must refuse: the alternative is unmetered password guessing.
 */
function enforce_login_rate_limit(PDO $db, string $ip, string $identifier): void
{
    try {
        $ipFailures = count_recent_failures($db, 'ip', $ip, 'login');
        $idFailures = $identifier !== ''
            ? count_recent_failures($db, 'identifier', $identifier, 'login')
            : 0;
    } catch (Throwable $e) {
        error_log('enforce_login_rate_limit: attempt store unavailable, refusing login: ' . $e->getMessage());
        header('Retry-After: 60');
        json_out(['error' => 'Sign-in is temporarily unavailable. Please try again shortly.'], 503);
        return; // unreachable; json_out exits
    }

    if ($ipFailures >= RATE_MAX_PER_IP) {
        rate_limited();
    }
    if ($idFailures >= RATE_MAX_PER_IDENTIFIER) {
        rate_limited();
    }
}

function rate_limited(): void
{
    header('Retry-After: ' . (RATE_WINDOW_MINUTES * 60));
    json_error('Too many attempts. Please wait a few minutes and try again.', 429);
}
