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

/** Encode raw bytes as a bech32 address with the given HRP. */
function bech32_encode(string $hrp, array $bytes): string
{
    $data = bech32_convert_bits($bytes, 8, 5, true);
    if ($data === null) {
        return '';
    }
    $chk = bech32_polymod(array_merge(bech32_hrp_expand($hrp), $data, [0, 0, 0, 0, 0, 0])) ^ 1;
    for ($i = 0; $i < 6; $i++) {
        $data[] = ($chk >> (5 * (5 - $i))) & 31;
    }
    $out = $hrp . '1';
    foreach ($data as $d) {
        $out .= BECH32_CHARSET[$d];
    }
    return $out;
}

// --- secp256k1 / ADR-036 address-ownership proof (audit #19) ----------------
// Verifies that whoever asks to link an address actually holds its private key.
// No GMP on this host, so BCMath is used for the (cheap) on-curve check; the
// client submits the UNCOMPRESSED public key, which lets us derive the address
// by compressing it rather than computing a modular square root.

const SECP256K1_P =
    '115792089237316195423570985008687907853269984665640564039457584007908834671663';

/** Big-endian hex -> decimal string, for BCMath (which has no hex input). */
function bc_hex2dec(string $hex): string
{
    $dec = '0';
    $len = strlen($hex);
    for ($i = 0; $i < $len; $i++) {
        $dec = bcadd(bcmul($dec, '16'), (string) hexdec($hex[$i]));
    }
    return $dec;
}

/**
 * Is the 65-byte uncompressed point actually on secp256k1 (y^2 == x^3 + 7)?
 * Rejects garbage before it ever reaches OpenSSL.
 */
function secp256k1_point_on_curve(string $pub65): bool
{
    if (strlen($pub65) !== 65 || $pub65[0] !== "\x04") {
        return false;
    }
    $p = SECP256K1_P;
    $x = bc_hex2dec(bin2hex(substr($pub65, 1, 32)));
    $y = bc_hex2dec(bin2hex(substr($pub65, 33, 32)));
    if (bccomp($x, $p) >= 0 || bccomp($y, $p) >= 0) {
        return false;
    }
    $lhs = bcmod(bcmul($y, $y), $p);
    $x2 = bcmod(bcmul($x, $x), $p);
    $rhs = bcmod(bcadd(bcmod(bcmul($x2, $x), $p), '7'), $p);
    return bccomp($lhs, $rhs) === 0;
}

/** Uncompressed (65B) -> compressed (33B) SEC1 public key. */
function secp256k1_compress(string $pub65): string
{
    $prefix = (ord($pub65[64]) & 1) === 0 ? "\x02" : "\x03";
    return $prefix . substr($pub65, 1, 32);
}

/** Cosmos address for a compressed pubkey: bech32(ripemd160(sha256(pk))). */
function cosmos_address_from_pubkey(string $compressed33, string $prefix): string
{
    $hash = hash('ripemd160', hash('sha256', $compressed33, true), true);
    return bech32_encode($prefix, array_values(unpack('C*', $hash)));
}

/** Wrap an uncompressed point in a DER SubjectPublicKeyInfo PEM for OpenSSL. */
function secp256k1_pubkey_pem(string $pub65): string
{
    // SEQUENCE { SEQUENCE { OID ecPublicKey, OID secp256k1 }, BIT STRING point }
    $der = hex2bin('3056301006072a8648ce3d020106052b8104000a034200') . $pub65;
    return "-----BEGIN PUBLIC KEY-----\n"
        . chunk_split(base64_encode($der), 64, "\n")
        . "-----END PUBLIC KEY-----\n";
}

/** DER INTEGER, minimally encoded with a sign-padding byte when needed. */
function der_integer(string $be): string
{
    $be = ltrim($be, "\x00");
    if ($be === '') {
        $be = "\x00";
    }
    if (ord($be[0]) & 0x80) {
        $be = "\x00" . $be;
    }
    return "\x02" . chr(strlen($be)) . $be;
}

/** 64-byte compact (r||s) signature -> DER ECDSA signature. */
function compact_sig_to_der(string $sig64): string
{
    $r = der_integer(substr($sig64, 0, 32));
    $s = der_integer(substr($sig64, 32, 32));
    return "\x30" . chr(strlen($r . $s)) . $r . $s;
}

/**
 * The exact ADR-036 amino StdSignDoc bytes for an arbitrary message.
 * Keys are emitted in alphabetical order and slashes are NOT escaped, so this
 * matches JSON.stringify on the client byte-for-byte (base64 can contain '/').
 */
function adr36_sign_doc(string $message, string $signer): string
{
    return json_encode([
        'account_number' => '0',
        'chain_id' => '',
        'fee' => ['amount' => [], 'gas' => '0'],
        'memo' => '',
        'msgs' => [[
            'type' => 'sign/MsgSignData',
            'value' => ['data' => base64_encode($message), 'signer' => $signer],
        ]],
        'sequence' => '0',
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}

/**
 * Verify an ADR-036 signature over $message and confirm the signer really owns
 * $address. The message is rebuilt server-side by the caller - never trust a
 * client-supplied sign doc.
 *
 * Returns '' on success, else a deny reason.
 */
function verify_address_ownership(
    string $message,
    string $address,
    string $prefix,
    string $pubkeyB64,
    string $signatureB64
): string {
    $pub = base64_decode($pubkeyB64, true);
    $sig = base64_decode($signatureB64, true);
    if ($pub === false || $sig === false) {
        return 'bad_encoding';
    }
    if (strlen($sig) !== 64) {
        return 'bad_signature_length';
    }
    if (strlen($pub) !== 65 || $pub[0] !== "\x04") {
        return 'bad_pubkey_format';
    }
    if (!secp256k1_point_on_curve($pub)) {
        return 'pubkey_not_on_curve';
    }

    // The address must be derived from THIS key, otherwise a valid signature
    // from an unrelated key would authorise linking someone else's address.
    $derived = cosmos_address_from_pubkey(secp256k1_compress($pub), $prefix);
    if ($derived === '' || !hash_equals($derived, $address)) {
        return 'address_mismatch';
    }

    $pem = secp256k1_pubkey_pem($pub);
    $key = @openssl_pkey_get_public($pem);
    if ($key === false) {
        return 'pubkey_rejected';
    }
    $ok = openssl_verify(
        adr36_sign_doc($message, $address),
        compact_sig_to_der($sig),
        $key,
        OPENSSL_ALGO_SHA256
    );
    return $ok === 1 ? '' : 'signature_invalid';
}

// --- CSRF / origin policy ---------------------------------------------------
// See common.php require_same_origin() for how these are applied.

/**
 * Reduce an origin to a comparable canonical form: lowercase scheme and host,
 * with the default port for the scheme removed.
 *
 * Returns '' if the input is not a usable absolute origin.
 */
function canonical_origin(string $origin): string
{
    $origin = trim($origin);
    if ($origin === '' || strcasecmp($origin, 'null') === 0) {
        return '';
    }
    $scheme = parse_url($origin, PHP_URL_SCHEME);
    $host = parse_url($origin, PHP_URL_HOST);
    if (!is_string($scheme) || !is_string($host) || $scheme === '' || $host === '') {
        return '';
    }
    $scheme = strtolower($scheme);
    $host = strtolower($host);
    if ($scheme !== 'http' && $scheme !== 'https') {
        return '';
    }
    $port = parse_url($origin, PHP_URL_PORT);
    $default = $scheme === 'https' ? 443 : 80;
    $port = $port === null ? $default : (int) $port;

    return $port === $default ? "{$scheme}://{$host}" : "{$scheme}://{$host}:{$port}";
}

/**
 * Is `$origin` one of the deployment's own origins?
 *
 * `$trusted` is the configured canonical list. Comparing against a configured
 * value rather than the request's own Host header is the point: Host is
 * client-supplied and reflected, and the previous check ignored scheme
 * entirely, so http://wallet.example validated happily against an HTTPS-only
 * deployment.
 */
function origin_is_trusted(string $origin, array $trusted): bool
{
    $c = canonical_origin($origin);
    if ($c === '') {
        return false;
    }
    foreach ($trusted as $t) {
        if ($c === canonical_origin((string) $t)) {
            return true;
        }
    }
    return false;
}

/**
 * @param string[] $trusted Canonical origins for this deployment. When empty,
 *                          falls back to comparing against the Host header -
 *                          weaker, but it keeps an unconfigured deployment
 *                          working rather than locking every mutation out.
 */
function origin_denied_reason(
    string $site,
    string $origin,
    string $host,
    bool $isMutation,
    array $trusted = []
): string {
    // With a configured origin list, that list is the whole policy: exact
    // scheme + host + port, no reliance on reflected headers.
    if ($trusted !== []) {
        if ($site === 'cross-site' || $site === 'same-site') {
            return 'cross_site';
        }
        if ($origin !== '') {
            if (strcasecmp($origin, 'null') === 0) {
                return 'opaque_origin';
            }
            return origin_is_trusted($origin, $trusted) ? '' : 'origin_mismatch';
        }
        if ($isMutation && $site !== 'same-origin') {
            return 'missing_origin';
        }
        return '';
    }

    return origin_denied_reason_by_host($site, $origin, $host, $isMutation);
}

/** Legacy Host-based comparison. Retained only as the unconfigured fallback. */
function origin_denied_reason_by_host(string $site, string $origin, string $host, bool $isMutation): string
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

// --- Per-feature access levels (migration 010) ------------------------------
//
// admin_permissions used to be pure membership: a row meant FULL access. The
// `level` column makes a grant ordered instead, so someone can be given sight
// of a feature without the ability to change it.
//
// NONE is normally expressed by the absence of a row; it exists as a constant
// so a clamped junk value has somewhere safe to land.
const PERM_NONE = 0;
const PERM_READ = 1;
const PERM_WRITE = 2;

/**
 * Admin features that can be granted individually. Super admins have all of
 * them at PERM_WRITE and never have rows in admin_permissions.
 *
 * Lives here rather than in common.php so the pure grant helpers below can be
 * unit-tested without a session or database; common.php requires this file, so
 * every existing call site is unaffected.
 *
 * The split is by WHAT DATA the feature exposes, not by which screen it sits
 * on:
 *   - 'wallet_alerts' is separate from 'uptime' because uptime is validator
 *     liveness while wallet-alert data exposes users' watched ADDRESSES.
 *   - 'user_watches' is separate from 'wallet_alerts' again: it adds who pays
 *     for what, which is billing data about a named person.
 *   - 'roles' is separate from 'users' because user moderation (disable, delete)
 *     and handing out administrative power are very different blast radii.
 */
const ADMIN_FEATURES = [
    'users',
    'roles',
    'chains',
    'announcements',
    'uptime',
    'wallet_alerts',
    'staking',
    'alert_pricing',
    'user_watches',
    'settings',
];

/**
 * Coerce a stored level into a known one.
 *
 * Clamped on READ, not merely on write, for the same reason watch_limit() is:
 * this table is editable by anyone with database access, and the application
 * must not act on a value it never wrote. Anything above write clamps DOWN to
 * write (the real ceiling) rather than being read as "even more than write";
 * anything below read becomes no access at all.
 */
function clamp_permission_level(int $level): int
{
    if ($level >= PERM_WRITE) {
        return PERM_WRITE;
    }
    if ($level === PERM_READ) {
        return PERM_READ;
    }
    return PERM_NONE;
}

/**
 * Whether an actor may grant $feature at $level to someone else.
 * '' = allowed, otherwise a deny reason:
 *   unknown_feature | escalation | roles_super_only
 *
 * This is the anti-escalation rule, and it is a plain numeric comparison
 * precisely so it is hard to get subtly wrong: nobody can hand out more access
 * than they themselves hold.
 *
 * Callers must ALSO enforce, with the database: that the actor holds
 * roles:WRITE at all, the self-edit ban, the super-admin-only rules on
 * is_super_admin, admin_action_denied_reason() against the target, and the
 * final-super-admin count.
 */
function grant_denied_reason(
    array $actorLevels,
    bool $actorIsSuper,
    string $feature,
    int $level
): string {
    if (!in_array($feature, ADMIN_FEATURES, true)) {
        return 'unknown_feature';
    }
    // A super admin is the ceiling of the whole model - there is nothing above
    // them to escalate to.
    if ($actorIsSuper) {
        return '';
    }
    // Only a super admin may hand out role management. Escalation alone would
    // permit it (an admin with roles:WRITE granting roles:WRITE is sideways,
    // not upward), but that lets an admin cohort replicate itself indefinitely
    // with no super admin ever in the loop.
    if ($feature === 'roles') {
        return 'roles_super_only';
    }
    if (clamp_permission_level($level) > clamp_permission_level((int) ($actorLevels[$feature] ?? PERM_NONE))) {
        return 'escalation';
    }
    return '';
}

// --- Base-unit amount math --------------------------------------------------
//
// The PHP mirror of app/src/wallet/amount.ts, and it exists for the same
// reason: chain amounts are integers in base units that routinely exceed what a
// float can represent exactly, and on a 64-bit build PHP_INT_MAX is about
// 9.2e18 - which an 18-decimal chain passes at ten whole tokens. A fee
// comparison that silently loses precision is a fee comparison that can be
// underpaid, so nothing here goes through (int) or (float).
//
// Values are non-negative decimal integer STRINGS ("200000000"). bcmath would
// do this too, but it is an optional extension and the money path must not
// depend on whether it happens to be compiled in.

/**
 * Normalise a base-unit string: strip leading zeros, reject anything that is
 * not a plain non-negative integer. Returns null for junk, so callers must
 * decide what to do rather than silently receiving a zero.
 *
 * Deliberately strict. A value like "1.5", "1e6", "-1" or " 12 " reaching this
 * function means the caller's assumptions are wrong somewhere upstream, and
 * coercing it would hide that.
 */
function base_normalize(string $value): ?string
{
    if (!preg_match('/^[0-9]+$/', $value)) {
        return null;
    }
    $trimmed = ltrim($value, '0');
    return $trimmed === '' ? '0' : $trimmed;
}

/**
 * Compare two base-unit strings: -1, 0 or 1. Junk sorts as invalid, so callers
 * get null and must handle it explicitly.
 *
 * Length-then-lexicographic, which is exact for normalised non-negative
 * integers of any size and needs no big-number library.
 */
function base_cmp(string $a, string $b): ?int
{
    $x = base_normalize($a);
    $y = base_normalize($b);
    if ($x === null || $y === null) {
        return null;
    }
    if (strlen($x) !== strlen($y)) {
        return strlen($x) < strlen($y) ? -1 : 1;
    }
    return $x <=> $y;
}

/** Exact addition of two base-unit strings, or null if either is invalid. */
function base_add(string $a, string $b): ?string
{
    $x = base_normalize($a);
    $y = base_normalize($b);
    if ($x === null || $y === null) {
        return null;
    }
    // Schoolbook addition over the digits, right to left. Exact at any width.
    $out = '';
    $carry = 0;
    $i = strlen($x) - 1;
    $j = strlen($y) - 1;
    while ($i >= 0 || $j >= 0 || $carry > 0) {
        $sum = $carry;
        if ($i >= 0) {
            $sum += (int) $x[$i--];
        }
        if ($j >= 0) {
            $sum += (int) $y[$j--];
        }
        $out = ((string) ($sum % 10)) . $out;
        $carry = intdiv($sum, 10);
    }
    return base_normalize($out);
}

/** True when a base-unit string is a valid amount strictly greater than zero. */
function base_is_positive(string $value): bool
{
    $n = base_normalize($value);
    return $n !== null && $n !== '0';
}

// --- Payment transaction parsing --------------------------------------------

/**
 * Total paid to $to in $denom by the bank sends in a decoded transaction body,
 * plus the addresses that paid it.
 *
 * Pure so the money path's parsing is unit-testable without a node. Shape is
 * the Cosmos SDK REST form: $txBody['messages'] is a list of decoded messages,
 * each MsgSend carrying from_address, to_address and an amount[] of coins.
 *
 * Deliberately narrow:
 *   - ONLY '/cosmos.bank.v1beta1.MsgSend'. MsgMultiSend, authz MsgExec wrappers
 *     and IBC transfers are not counted. Each is a separate shape with its own
 *     parsing hazards, and the app builds a plain MsgSend; a payer using
 *     something else is told the payment was not recognised rather than having
 *     it half-understood.
 *   - Denominations match EXACTLY as strings, so an IBC voucher whose display
 *     name resembles the native denom cannot pass as it.
 *   - A malformed coin is skipped, never guessed at. Skipping can only ever
 *     UNDERCOUNT, which fails towards refusing a payment rather than towards
 *     accepting an underpayment.
 *
 * Sums with base_add(), so a total is exact at any width.
 */
function msgsend_total_to(array $txBody, string $to, string $denom): array
{
    $total = '0';
    $senders = [];

    if ($to === '' || $denom === '') {
        return ['total' => '0', 'senders' => []];
    }

    $messages = $txBody['messages'] ?? null;
    if (!is_array($messages)) {
        return ['total' => '0', 'senders' => []];
    }

    foreach ($messages as $msg) {
        if (!is_array($msg) || ($msg['@type'] ?? '') !== '/cosmos.bank.v1beta1.MsgSend') {
            continue;
        }
        if (($msg['to_address'] ?? '') !== $to) {
            continue;
        }
        $coins = $msg['amount'] ?? null;
        if (!is_array($coins)) {
            continue;
        }
        $matched = false;
        foreach ($coins as $coin) {
            if (!is_array($coin) || ($coin['denom'] ?? '') !== $denom) {
                continue;
            }
            $amount = $coin['amount'] ?? '';
            if (!is_string($amount)) {
                continue;
            }
            $sum = base_add($total, $amount);
            if ($sum === null) {
                continue; // unparseable amount: skip, never guess
            }
            $total = $sum;
            $matched = true;
        }
        if ($matched) {
            $from = $msg['from_address'] ?? '';
            if (is_string($from) && $from !== '' && !in_array($from, $senders, true)) {
                $senders[] = $from;
            }
        }
    }

    return ['total' => $total, 'senders' => $senders];
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
