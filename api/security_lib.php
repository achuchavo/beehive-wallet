<?php
// Pure security/validation helpers, deliberately free of session, header, DB and
// superglobal access so they can be unit-tested from the CLI (see tests/run.php).
// common.php requires this file; endpoints should not include it directly.

declare(strict_types=1);

// --- Bech32 ----------------------------------------------------------------
// Real checksum validation (BIP-173 polymod), not a shape guess. Cosmos account,
// validator-operator and consensus addresses are all bech32 with distinct HRPs.

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32_polymod(array $values): int
{
    $gen = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    $chk = 1;
    foreach ($values as $v) {
        $b = $chk >> 25;
        $chk = (($chk & 0x1ffffff) << 5) ^ $v;
        for ($i = 0; $i < 5; $i++) {
            if (($b >> $i) & 1) {
                $chk ^= $gen[$i];
            }
        }
    }
    return $chk;
}

function bech32_hrp_expand(string $hrp): array
{
    $out = [];
    $len = strlen($hrp);
    for ($i = 0; $i < $len; $i++) {
        $out[] = ord($hrp[$i]) >> 5;
    }
    $out[] = 0;
    for ($i = 0; $i < $len; $i++) {
        $out[] = ord($hrp[$i]) & 31;
    }
    return $out;
}

/** Regroup 5-bit words into 8-bit bytes. Returns null on invalid padding. */
function bech32_convert_bits(array $data, int $from, int $to, bool $pad): ?array
{
    $acc = 0;
    $bits = 0;
    $ret = [];
    $maxv = (1 << $to) - 1;
    foreach ($data as $value) {
        if ($value < 0 || ($value >> $from) !== 0) {
            return null;
        }
        $acc = ($acc << $from) | $value;
        $bits += $from;
        while ($bits >= $to) {
            $bits -= $to;
            $ret[] = ($acc >> $bits) & $maxv;
        }
    }
    if ($pad) {
        if ($bits > 0) {
            $ret[] = ($acc << ($to - $bits)) & $maxv;
        }
    } elseif ($bits >= $from || (($acc << ($to - $bits)) & $maxv) !== 0) {
        return null; // non-zero padding
    }
    return $ret;
}

/**
 * Strict bech32 decode. Returns ['hrp' => string, 'data' => byte[]] or null.
 * Rejects mixed case, non-canonical uppercase, bad charset and bad checksum.
 */
function bech32_decode(string $addr): ?array
{
    $len = strlen($addr);
    if ($len < 8 || $len > 120) {
        return null;
    }
    // Canonical form only: we store and compare lowercase everywhere.
    if ($addr !== strtolower($addr)) {
        return null;
    }
    $pos = strrpos($addr, '1');
    if ($pos === false || $pos < 1 || $pos + 7 > $len) {
        return null;
    }
    $hrp = substr($addr, 0, $pos);
    if (!preg_match('/^[a-z]+$/', $hrp)) {
        return null;
    }
    $dataPart = substr($addr, $pos + 1);
    $values = [];
    for ($i = 0; $i < strlen($dataPart); $i++) {
        $c = strpos(BECH32_CHARSET, $dataPart[$i]);
        if ($c === false) {
            return null;
        }
        $values[] = $c;
    }
    if (bech32_polymod(array_merge(bech32_hrp_expand($hrp), $values)) !== 1) {
        return null;
    }
    $payload = array_slice($values, 0, -6); // strip 6-word checksum
    $bytes = bech32_convert_bits($payload, 5, 8, false);
    if ($bytes === null) {
        return null;
    }
    return ['hrp' => $hrp, 'data' => $bytes];
}

/**
 * Validate a bech32 address against an exact expected HRP and payload length.
 * Cosmos account/valoper addresses are 20 bytes; consensus pubkey-derived and
 * some module addresses are 32.
 */
function bech32_address_ok(string $addr, string $expectedHrp, array $allowedLengths = [20, 32]): bool
{
    $d = bech32_decode($addr);
    if ($d === null) {
        return false;
    }
    if ($d['hrp'] !== $expectedHrp) {
        return false;
    }
    return in_array(count($d['data']), $allowedLengths, true);
}

/** Account address, e.g. panacea1... */
function is_account_address(string $addr, string $prefix): bool
{
    return bech32_address_ok($addr, $prefix, [20, 32]);
}

/** Validator operator address, e.g. panaceavaloper1... */
function is_valoper_address(string $addr, string $prefix): bool
{
    return bech32_address_ok($addr, $prefix . 'valoper', [20, 32]);
}

/** Consensus address, e.g. panaceavalcons1... */
function is_valcons_address(string $addr, string $prefix): bool
{
    return bech32_address_ok($addr, $prefix . 'valcons', [20, 32]);
}

// --- CSRF / origin policy ---------------------------------------------------
// See common.php require_same_origin() for how these are applied.

function origin_denied_reason(string $site, string $origin, string $host, bool $isMutation): string
{
    // `same-site` is a sibling subdomain - NOT us. Reject alongside cross-site.
    if ($site === 'cross-site' || $site === 'same-site') {
        return 'cross_site';
    }

    $hostOnly = preg_replace('/:\d+$/', '', $host);
    if ($hostOnly === null || $hostOnly === '') {
        return 'bad_host';
    }

    if ($origin !== '') {
        if (strcasecmp($origin, 'null') === 0) {
            return 'opaque_origin'; // sandboxed iframe / opaque origin
        }
        $oh = parse_url($origin, PHP_URL_HOST);
        if (!is_string($oh) || $oh === '') {
            return 'bad_origin';
        }
        if (strcasecmp($oh, $hostOnly) !== 0) {
            return 'origin_mismatch';
        }
        if (preg_match('/:(\d+)$/', $host, $m)) {
            $op = parse_url($origin, PHP_URL_PORT);
            if ($op !== null && (int) $op !== (int) $m[1]) {
                return 'origin_mismatch';
            }
        }
        return '';
    }

    // Browsers attach Origin to every non-GET fetch, so a mutation without one
    // is only acceptable when Sec-Fetch-Site positively asserts same-origin.
    if ($isMutation && $site !== 'same-origin') {
        return 'missing_origin';
    }
    return '';
}

function is_mutating_method(string $method): bool
{
    return in_array(strtoupper($method), ['POST', 'PUT', 'PATCH', 'DELETE'], true);
}

// --- Admin privilege hierarchy ---------------------------------------------
const ROLE_USER = 0;
const ROLE_ADMIN = 1;
const ROLE_SUPER = 2;

function role_level(array $u): int
{
    if (!empty($u['is_super_admin']) && (int) $u['is_super_admin'] === 1) {
        return ROLE_SUPER;
    }
    if (!empty($u['is_admin']) && (int) $u['is_admin'] === 1) {
        return ROLE_ADMIN;
    }
    return ROLE_USER;
}

/**
 * Whether $actor may administratively modify $target. '' = allowed, otherwise a
 * deny reason: self | disabled | not_admin | privilege.
 *
 * Callers must ALSO enforce the `users` feature grant and the final-super-admin
 * rule (both need the database).
 */
function admin_action_denied_reason(array $actor, array $target): string
{
    if ((int) ($actor['id'] ?? 0) === (int) ($target['id'] ?? -1)) {
        return 'self';
    }
    if (!empty($actor['is_disabled']) && (int) $actor['is_disabled'] === 1) {
        return 'disabled';
    }
    $a = role_level($actor);
    $t = role_level($target);
    if ($a < ROLE_ADMIN) {
        return 'not_admin';
    }
    // Admins may only act on plain users; touching an admin or super admin
    // requires super admin.
    if ($t >= ROLE_ADMIN && $a < ROLE_SUPER) {
        return 'privilege';
    }
    return '';
}

// --- SSRF address checks ----------------------------------------------------
// filter_var's NO_PRIV/NO_RES flags miss a few ranges that matter for SSRF, so
// they are enumerated explicitly below.

function ip_in_cidr(string $ip, string $cidr): bool
{
    [$net, $maskLen] = explode('/', $cidr);
    $ipBin = @inet_pton($ip);
    $netBin = @inet_pton($net);
    if ($ipBin === false || $netBin === false || strlen($ipBin) !== strlen($netBin)) {
        return false;
    }
    $maskLen = (int) $maskLen;
    $bytes = intdiv($maskLen, 8);
    $rem = $maskLen % 8;
    if ($bytes > 0 && strncmp($ipBin, $netBin, $bytes) !== 0) {
        return false;
    }
    if ($rem === 0) {
        return true;
    }
    $mask = chr((0xff << (8 - $rem)) & 0xff);
    return (($ipBin[$bytes] & $mask) === ($netBin[$bytes] & $mask));
}

// Ranges that must never be reachable from a server-side fetch.
const SSRF_BLOCKED_V4 = [
    '0.0.0.0/8',        // this network
    '10.0.0.0/8',       // private
    '100.64.0.0/10',    // carrier-grade NAT
    '127.0.0.0/8',      // loopback
    '169.254.0.0/16',   // link-local incl. 169.254.169.254 cloud metadata
    '172.16.0.0/12',    // private
    '192.0.0.0/24',     // IETF protocol assignments
    '192.0.2.0/24',     // TEST-NET-1 documentation
    '192.88.99.0/24',   // 6to4 relay anycast
    '192.168.0.0/16',   // private
    '198.18.0.0/15',    // benchmarking
    '198.51.100.0/24',  // TEST-NET-2
    '203.0.113.0/24',   // TEST-NET-3
    '224.0.0.0/4',      // multicast
    '240.0.0.0/4',      // reserved (incl. 255.255.255.255)
];

const SSRF_BLOCKED_V6 = [
    '::/128',           // unspecified
    '::1/128',          // loopback
    '64:ff9b::/96',     // NAT64
    '100::/64',         // discard-only
    '2001:db8::/32',    // documentation
    'fc00::/7',         // unique local
    'fe80::/10',        // link-local
    'ff00::/8',         // multicast
];

/**
 * True only for a genuinely public, routable address. IPv4-mapped IPv6
 * (::ffff:127.0.0.1) is unwrapped and re-checked against the v4 rules so a
 * private address cannot be smuggled through in v6 form.
 */
function is_public_ip(string $ip): bool
{
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
        foreach (SSRF_BLOCKED_V4 as $c) {
            if (ip_in_cidr($ip, $c)) {
                return false;
            }
        }
        return true;
    }
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
        // Unwrap IPv4-mapped / IPv4-compatible forms and apply the v4 rules.
        if (preg_match('/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i', $ip, $m)) {
            return is_public_ip($m[1]);
        }
        $bin = @inet_pton($ip);
        if ($bin !== false && strlen($bin) === 16 && strncmp($bin, str_repeat("\0", 10) . "\xff\xff", 12) === 0) {
            return is_public_ip(inet_ntop(substr($bin, 12)));
        }
        foreach (SSRF_BLOCKED_V6 as $c) {
            if (ip_in_cidr($ip, $c)) {
                return false;
            }
        }
        return true;
    }
    return false;
}

/**
 * Structural checks on an outbound URL before any DNS work: HTTPS only, no
 * embedded credentials, no odd ports, parseable host.
 * Returns '' when acceptable, else a deny reason.
 */
function outbound_url_denied_reason(string $url): string
{
    $p = @parse_url($url);
    if ($p === false || !is_array($p)) {
        return 'unparseable';
    }
    if (($p['scheme'] ?? '') !== 'https') {
        return 'scheme';
    }
    if (isset($p['user']) || isset($p['pass'])) {
        return 'credentials'; // https://evil@internal/ tricks
    }
    $host = $p['host'] ?? '';
    if ($host === '') {
        return 'no_host';
    }
    if (isset($p['port']) && ((int) $p['port'] < 1 || (int) $p['port'] > 65535)) {
        return 'port';
    }
    // Reject anything that is not a plain hostname or IP literal.
    $isIp = (bool) filter_var($host, FILTER_VALIDATE_IP);
    $isBracketV6 = (bool) preg_match('/^\[[0-9a-f:.]+\]$/i', $host);
    if (!$isIp && !$isBracketV6 && !preg_match('/^[a-z0-9]([a-z0-9\-.]*[a-z0-9])?$/i', $host)) {
        return 'host_chars';
    }
    if ($isIp && !is_public_ip($host)) {
        return 'private_ip';
    }
    if ($isBracketV6) {
        $inner = trim($host, '[]');
        if (!is_public_ip($inner)) {
            return 'private_ip';
        }
    }
    return '';
}
