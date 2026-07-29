<?php
// Dependency-free unit tests for the pure security policy helpers.
//   php api/tests/run.php
// No composer, session, DB or network required - security_lib.php is pure by
// design precisely so these paths can be tested.

declare(strict_types=1);
require __DIR__ . '/../security_lib.php';

$passed = 0;
$failed = 0;
$failures = [];

function check(string $name, $actual, $expected): void
{
    global $passed, $failed, $failures;
    if ($actual === $expected) {
        $passed++;
        return;
    }
    $failed++;
    $failures[] = sprintf(
        "  FAIL %s\n       expected: %s\n       actual:   %s",
        $name,
        var_export($expected, true),
        var_export($actual, true)
    );
}

// =============================================================================
// Bech32 (#20)
// =============================================================================
// Known-good vectors. The panacea address is the project's own validator's
// account form; the cosmos/BIP-173 vectors are from the specification.
$validPanacea = 'panacea1a3mg2ek63ql9gh347uqyg75t0u3ns956ytxkhl';
$validValoper = 'panaceavaloper1hlpw58lg9fvwvwa3ryzgjqyw39tf2nmns4r0z5';

check('bech32 valid account', is_account_address($validPanacea, 'panacea'), true);
check('bech32 valid valoper', is_valoper_address($validValoper, 'panacea'), true);

// A valoper address must NOT pass as an account address (HRP is exact).
check('valoper rejected as account', is_account_address($validValoper, 'panacea'), false);
check('account rejected as valoper', is_valoper_address($validPanacea, 'panacea'), false);

// Wrong expected prefix.
check('wrong hrp rejected', is_account_address($validPanacea, 'cosmos'), false);

// Corrupted checksum: flip the final character.
$badChecksum = substr($validPanacea, 0, -1) . (substr($validPanacea, -1) === 'l' ? 'q' : 'l');
check('bad checksum rejected', is_account_address($badChecksum, 'panacea'), false);

// The old regex accepted these; real bech32 must not.
check('shape-only garbage rejected', is_account_address('panacea1' . str_repeat('q', 38), 'panacea'), false);
check('mixed case rejected', is_account_address(strtoupper($validPanacea), 'panacea'), false);
check(
    'mixed case (partial) rejected',
    is_account_address('Panacea1a3mg2ek63ql9gh347uqyg75t0u3ns956ytxkhl', 'panacea'),
    false
);
check('empty rejected', is_account_address('', 'panacea'), false);
check('no separator rejected', is_account_address('panacea', 'panacea'), false);
check('invalid charset rejected', is_account_address('panacea1bbbbbbb', 'panacea'), false);

// =============================================================================
// Origin / CSRF policy (#6)
// =============================================================================
$host = 'wallet.achumuamah.com';

check(
    'same-origin allowed',
    origin_denied_reason('same-origin', "https://$host", $host, true),
    ''
);
check(
    'cross-site blocked',
    origin_denied_reason('cross-site', 'https://evil.example', $host, true),
    'cross_site'
);
// The regression this audit item is about: a sibling subdomain must NOT pass.
check(
    'same-site sibling subdomain blocked',
    origin_denied_reason('same-site', 'https://blog.achumuamah.com', $host, true),
    'cross_site'
);
check(
    'origin host mismatch blocked',
    origin_denied_reason('', 'https://evil.example', $host, true),
    'origin_mismatch'
);
check(
    'opaque null origin blocked',
    origin_denied_reason('', 'null', $host, true),
    'opaque_origin'
);
check(
    'mutation without origin blocked',
    origin_denied_reason('', '', $host, true),
    'missing_origin'
);
check(
    'GET without origin allowed',
    origin_denied_reason('', '', $host, false),
    ''
);
check(
    'mutation without origin but same-origin hint allowed',
    origin_denied_reason('same-origin', '', $host, true),
    ''
);
check(
    'port mismatch blocked',
    origin_denied_reason('', 'http://localhost:1234', 'localhost:5173', true),
    'origin_mismatch'
);
check(
    'matching port allowed',
    origin_denied_reason('', 'http://localhost:5173', 'localhost:5173', true),
    ''
);

check('POST is mutating', is_mutating_method('POST'), true);
check('DELETE is mutating', is_mutating_method('delete'), true);
check('GET is not mutating', is_mutating_method('GET'), false);

// =============================================================================
// Admin privilege hierarchy (#1)
// =============================================================================
$user  = ['id' => 1, 'is_admin' => 0, 'is_super_admin' => 0, 'is_disabled' => 0];
$user2 = ['id' => 2, 'is_admin' => 0, 'is_super_admin' => 0, 'is_disabled' => 0];
$admin = ['id' => 3, 'is_admin' => 1, 'is_super_admin' => 0, 'is_disabled' => 0];
$admin2 = ['id' => 4, 'is_admin' => 1, 'is_super_admin' => 0, 'is_disabled' => 0];
$super = ['id' => 5, 'is_admin' => 1, 'is_super_admin' => 1, 'is_disabled' => 0];
$super2 = ['id' => 6, 'is_admin' => 1, 'is_super_admin' => 1, 'is_disabled' => 0];
$disabledAdmin = ['id' => 7, 'is_admin' => 1, 'is_super_admin' => 0, 'is_disabled' => 1];

check('user acting on user denied', admin_action_denied_reason($user, $user2), 'not_admin');
check('admin acting on user allowed', admin_action_denied_reason($admin, $user), '');
// The core privilege-escalation fix:
check('admin acting on admin denied', admin_action_denied_reason($admin, $admin2), 'privilege');
check('admin acting on super admin denied', admin_action_denied_reason($admin, $super), 'privilege');
check('super acting on admin allowed', admin_action_denied_reason($super, $admin), '');
check('super acting on super allowed', admin_action_denied_reason($super, $super2), '');
check('super acting on user allowed', admin_action_denied_reason($super, $user), '');
check('self modification denied', admin_action_denied_reason($admin, $admin), 'self');
check('super self modification denied', admin_action_denied_reason($super, $super), 'self');
check('disabled actor denied', admin_action_denied_reason($disabledAdmin, $user), 'disabled');

check('role_level user', role_level($user), ROLE_USER);
check('role_level admin', role_level($admin), ROLE_ADMIN);
check('role_level super', role_level($super), ROLE_SUPER);

// =============================================================================
// SSRF address rules (#5)
// =============================================================================
check('public v4 allowed', is_public_ip('8.8.8.8'), true);
check('loopback blocked', is_public_ip('127.0.0.1'), false);
check('private 10/8 blocked', is_public_ip('10.0.0.1'), false);
check('private 172.16/12 blocked', is_public_ip('172.16.5.4'), false);
check('private 192.168/16 blocked', is_public_ip('192.168.1.1'), false);
check('cloud metadata blocked', is_public_ip('169.254.169.254'), false);
check('CGNAT blocked', is_public_ip('100.64.0.1'), false);
check('TEST-NET blocked', is_public_ip('192.0.2.1'), false);
check('multicast blocked', is_public_ip('224.0.0.1'), false);
check('reserved 240/4 blocked', is_public_ip('240.0.0.1'), false);
check('broadcast blocked', is_public_ip('255.255.255.255'), false);
check('0.0.0.0 blocked', is_public_ip('0.0.0.0'), false);

check('public v6 allowed', is_public_ip('2001:4860:4860::8888'), true);
check('v6 loopback blocked', is_public_ip('::1'), false);
check('v6 unique-local blocked', is_public_ip('fc00::1'), false);
check('v6 link-local blocked', is_public_ip('fe80::1'), false);
check('v6 multicast blocked', is_public_ip('ff02::1'), false);
check('v6 documentation blocked', is_public_ip('2001:db8::1'), false);
// IPv4-mapped IPv6 must not smuggle a private address through.
check('v4-mapped loopback blocked', is_public_ip('::ffff:127.0.0.1'), false);
check('v4-mapped private blocked', is_public_ip('::ffff:10.0.0.1'), false);
check('v4-mapped metadata blocked', is_public_ip('::ffff:169.254.169.254'), false);
check('not an ip', is_public_ip('nonsense'), false);

// URL structure rules
check('https public url ok', outbound_url_denied_reason('https://rpc.example.com/path'), '');
check('http rejected', outbound_url_denied_reason('http://rpc.example.com'), 'scheme');
check('file rejected', outbound_url_denied_reason('file:///etc/passwd'), 'scheme');
check('gopher rejected', outbound_url_denied_reason('gopher://x/'), 'scheme');
check(
    'embedded credentials rejected',
    outbound_url_denied_reason('https://user:pw@internal.example/'),
    'credentials'
);
check('private ip literal rejected', outbound_url_denied_reason('https://127.0.0.1/'), 'private_ip');
check('metadata ip literal rejected', outbound_url_denied_reason('https://169.254.169.254/'), 'private_ip');
check(
    'v6 private literal rejected',
    outbound_url_denied_reason('https://[::1]/'),
    'private_ip'
);

// =============================================================================
// Canonical CSRF origin (audit #10)
// =============================================================================
// Policy must depend on a CONFIGURED origin, not the reflected Host header,
// and must compare scheme + host + port. The old check ignored scheme, so
// plain http validated happily against an HTTPS-only deployment.

$TRUSTED = ['https://wallet.achumuamah.com'];

check('canonical: default https port dropped', canonical_origin('https://a.example:443'), 'https://a.example');
check('canonical: default http port dropped', canonical_origin('http://a.example:80'), 'http://a.example');
check('canonical: non-default port kept', canonical_origin('https://a.example:8443'), 'https://a.example:8443');
check('canonical: case normalised', canonical_origin('HTTPS://A.Example'), 'https://a.example');
check('canonical: non-http scheme rejected', canonical_origin('ftp://a.example'), '');
check('canonical: garbage rejected', canonical_origin('not a url'), '');
check('canonical: null origin rejected', canonical_origin('null'), '');

check('trusted origin accepted',
    origin_denied_reason('same-origin', 'https://wallet.achumuamah.com', 'wallet.achumuamah.com', true, $TRUSTED), '');
check('http rejected against an https deployment',
    origin_denied_reason('same-origin', 'http://wallet.achumuamah.com', 'wallet.achumuamah.com', true, $TRUSTED), 'origin_mismatch');
check('alternate port rejected',
    origin_denied_reason('same-origin', 'https://wallet.achumuamah.com:8443', 'wallet.achumuamah.com', true, $TRUSTED), 'origin_mismatch');
check('sibling subdomain rejected',
    origin_denied_reason('same-origin', 'https://evil.achumuamah.com', 'wallet.achumuamah.com', true, $TRUSTED), 'origin_mismatch');
check('spoofed Host cannot authorise a foreign origin',
    origin_denied_reason('same-origin', 'https://attacker.example', 'attacker.example', true, $TRUSTED), 'origin_mismatch');
check('same-site sibling still rejected outright',
    origin_denied_reason('same-site', 'https://wallet.achumuamah.com', 'wallet.achumuamah.com', true, $TRUSTED), 'cross_site');
check('opaque origin rejected',
    origin_denied_reason('same-origin', 'null', 'wallet.achumuamah.com', true, $TRUSTED), 'opaque_origin');
check('mutation without origin or assertion rejected',
    origin_denied_reason('', '', 'wallet.achumuamah.com', true, $TRUSTED), 'missing_origin');
check('mutation without origin but same-origin asserted allowed',
    origin_denied_reason('same-origin', '', 'wallet.achumuamah.com', true, $TRUSTED), '');
check('unconfigured falls back to host comparison',
    origin_denied_reason('same-origin', 'https://wallet.achumuamah.com', 'wallet.achumuamah.com', true, []), '');

// =============================================================================
// Per-feature access levels + anti-escalation (migration 010)
// =============================================================================

// Levels are clamped on READ, because admin_permissions is editable by anyone
// with database access and the app must not act on a value it never wrote.
check('level: write kept', clamp_permission_level(PERM_WRITE), PERM_WRITE);
check('level: read kept', clamp_permission_level(PERM_READ), PERM_READ);
check('level: zero is none', clamp_permission_level(0), PERM_NONE);
check('level: negative is none', clamp_permission_level(-5), PERM_NONE);
// Clamps DOWN to write rather than being read as "more than write".
check('level: junk high clamps to write', clamp_permission_level(99), PERM_WRITE);

$superLevels = [];              // a super admin needs no rows
$writeChains = ['chains' => PERM_WRITE];
$readChains = ['chains' => PERM_READ];

// A super admin is the ceiling: nothing to escalate to.
check('grant: super may grant write', grant_denied_reason($superLevels, true, 'chains', PERM_WRITE), '');
check('grant: super may grant roles', grant_denied_reason($superLevels, true, 'roles', PERM_WRITE), '');
check('grant: super may grant settings', grant_denied_reason($superLevels, true, 'settings', PERM_WRITE), '');

// The core rule: never hand out more than you hold.
check('grant: write may grant write', grant_denied_reason($writeChains, false, 'chains', PERM_WRITE), '');
check('grant: write may grant read', grant_denied_reason($writeChains, false, 'chains', PERM_READ), '');
check('grant: read may grant read', grant_denied_reason($readChains, false, 'chains', PERM_READ), '');
check('grant: read may NOT grant write', grant_denied_reason($readChains, false, 'chains', PERM_WRITE), 'escalation');
check(
    'grant: ungranted feature cannot be granted',
    grant_denied_reason($writeChains, false, 'users', PERM_READ),
    'escalation'
);
check(
    'grant: no grants at all cannot grant anything',
    grant_denied_reason([], false, 'chains', PERM_READ),
    'escalation'
);

// Role management is super-admin-only to grant, even for an admin who holds it
// at write - otherwise an admin cohort can replicate itself indefinitely with
// no super admin ever in the loop.
check(
    'grant: roles is super-only even at write',
    grant_denied_reason(['roles' => PERM_WRITE], false, 'roles', PERM_WRITE),
    'roles_super_only'
);
check(
    'grant: roles is super-only even at read',
    grant_denied_reason(['roles' => PERM_WRITE], false, 'roles', PERM_READ),
    'roles_super_only'
);

// An unknown feature is refused rather than ignored, so a typo cannot report
// success for a grant that was never made.
check('grant: unknown feature refused', grant_denied_reason($superLevels, true, 'nope', PERM_READ), 'unknown_feature');
check('grant: unknown feature refused for admin', grant_denied_reason($writeChains, false, 'nope', PERM_READ), 'unknown_feature');

// A junk stored level must not become a licence to grant write.
check(
    'grant: junk actor level still clamps',
    grant_denied_reason(['chains' => 99], false, 'chains', PERM_WRITE),
    ''
);
check(
    'grant: junk requested level clamps to write, not beyond',
    grant_denied_reason($readChains, false, 'chains', 99),
    'escalation'
);

// The features the app knows about. A feature removed from this list without a
// matching migration would silently strip access, so the list is asserted.
check('features: users present', in_array('users', ADMIN_FEATURES, true), true);
check('features: roles present', in_array('roles', ADMIN_FEATURES, true), true);
check('features: alert_pricing present', in_array('alert_pricing', ADMIN_FEATURES, true), true);
check('features: user_watches present', in_array('user_watches', ADMIN_FEATURES, true), true);
check('features: settings present', in_array('settings', ADMIN_FEATURES, true), true);

// =============================================================================
// Base-unit amount math (paid alerts)
// =============================================================================

check('base: normalise strips leading zeros', base_normalize('000200000000'), '200000000');
check('base: normalise all zeros', base_normalize('0000'), '0');
check('base: normalise plain', base_normalize('200000000'), '200000000');
// Strict on purpose - junk means a wrong assumption upstream, not a zero.
check('base: decimal rejected', base_normalize('1.5'), null);
check('base: negative rejected', base_normalize('-1'), null);
check('base: exponent rejected', base_normalize('1e6'), null);
check('base: whitespace rejected', base_normalize(' 12 '), null);
check('base: empty rejected', base_normalize(''), null);

check('base: equal', base_cmp('200000000', '200000000'), 0);
check('base: less', base_cmp('199999999', '200000000'), -1);
check('base: greater', base_cmp('200000001', '200000000'), 1);
// Differing widths must not be compared lexicographically alone.
check('base: shorter is smaller', base_cmp('999', '1000'), -1);
check('base: leading zeros do not change order', base_cmp('0000999', '1000'), -1);
check('base: junk compares to null', base_cmp('1.5', '1'), null);

// The whole point: values far past PHP_INT_MAX (~9.2e18) stay exact. An
// 18-decimal chain reaches this at ten tokens.
$huge = '10000000000000000000';          // 1e19
$hugePlusOne = '10000000000000000001';
check('base: beyond int max, less', base_cmp($huge, $hugePlusOne), -1);
check('base: beyond int max, greater', base_cmp($hugePlusOne, $huge), 1);
check('base: beyond int max, equal', base_cmp($huge, '10000000000000000000'), 0);

check('base: add simple', base_add('200000000', '1'), '200000001');
check('base: add with carry', base_add('999', '1'), '1000');
check('base: add zero', base_add('0', '0'), '0');
check('base: add different widths', base_add('1', '999999999999999999999'), '1000000000000000000000');
// Summing several MsgSend coins must not lose a unit at any width.
check('base: add beyond int max', base_add($huge, $huge), '20000000000000000000');
check('base: add rejects junk', base_add('1.5', '1'), null);

check('base: positive', base_is_positive('1'), true);
check('base: zero is not positive', base_is_positive('0'), false);
check('base: padded zero is not positive', base_is_positive('0000'), false);
check('base: junk is not positive', base_is_positive('-1'), false);

// =============================================================================
// Payment transaction parsing (paid alerts)
// =============================================================================

$COLLECT = 'panacea1a3mg2ek63ql9gh347uqyg75t0u3ns956ytxkhl';
$PAYER = 'panacea1hlpw58lg9fvwvwa3ryzgjqyw39tf2nmnaaaaaa';

$send = static fn(string $from, string $to, array $coins): array => [
    '@type' => '/cosmos.bank.v1beta1.MsgSend',
    'from_address' => $from,
    'to_address' => $to,
    'amount' => $coins,
];
$coin = static fn(string $denom, string $amount): array => ['denom' => $denom, 'amount' => $amount];

// The ordinary case.
$body = ['messages' => [$send($PAYER, $COLLECT, [$coin('umed', '200000000')])]];
check('tx: exact fee counted', msgsend_total_to($body, $COLLECT, 'umed')['total'], '200000000');
check('tx: sender captured', msgsend_total_to($body, $COLLECT, 'umed')['senders'], [$PAYER]);

// Overpayment is counted as what it is; the caller decides it is acceptable.
$body = ['messages' => [$send($PAYER, $COLLECT, [$coin('umed', '500000000')])]];
check('tx: overpayment counted in full', msgsend_total_to($body, $COLLECT, 'umed')['total'], '500000000');

// Several sends to the collector in one transaction add up exactly.
$body = ['messages' => [
    $send($PAYER, $COLLECT, [$coin('umed', '150000000')]),
    $send($PAYER, $COLLECT, [$coin('umed', '50000000')]),
]];
check('tx: multiple sends summed', msgsend_total_to($body, $COLLECT, 'umed')['total'], '200000000');

// Money that went somewhere else does not count towards our fee.
$body = ['messages' => [$send($PAYER, $PAYER, [$coin('umed', '200000000')])]];
check('tx: payment to another address ignored', msgsend_total_to($body, $COLLECT, 'umed')['total'], '0');

// An IBC voucher or any other denom is not the fee denom, even in the same tx.
$body = ['messages' => [$send($PAYER, $COLLECT, [
    $coin('ibc/AAAA', '999999999999'),
    $coin('umed', '200000000'),
])]];
check('tx: only the exact denom counts', msgsend_total_to($body, $COLLECT, 'umed')['total'], '200000000');
$body = ['messages' => [$send($PAYER, $COLLECT, [$coin('ibc/UMED', '200000000')])]];
check('tx: lookalike denom rejected', msgsend_total_to($body, $COLLECT, 'umed')['total'], '0');

// Message types we do not parse must not be half-understood.
$body = ['messages' => [[
    '@type' => '/cosmos.bank.v1beta1.MsgMultiSend',
    'outputs' => [['address' => $COLLECT, 'coins' => [$coin('umed', '200000000')]]],
]]];
check('tx: MsgMultiSend not counted', msgsend_total_to($body, $COLLECT, 'umed')['total'], '0');
$body = ['messages' => [[
    '@type' => '/cosmos.staking.v1beta1.MsgDelegate',
    'to_address' => $COLLECT,
    'amount' => [$coin('umed', '200000000')],
]]];
check('tx: non-bank message not counted', msgsend_total_to($body, $COLLECT, 'umed')['total'], '0');

// Malformed input must be skipped, never guessed at - skipping can only
// undercount, which fails towards refusing a payment.
$body = ['messages' => [$send($PAYER, $COLLECT, [$coin('umed', '1.5')])]];
check('tx: decimal amount skipped', msgsend_total_to($body, $COLLECT, 'umed')['total'], '0');
$body = ['messages' => [$send($PAYER, $COLLECT, [$coin('umed', '-200000000')])]];
check('tx: negative amount skipped', msgsend_total_to($body, $COLLECT, 'umed')['total'], '0');
check('tx: no messages key', msgsend_total_to([], $COLLECT, 'umed')['total'], '0');
check('tx: messages not a list', msgsend_total_to(['messages' => 'nope'], $COLLECT, 'umed')['total'], '0');
check('tx: empty collect address matches nothing', msgsend_total_to($body, '', 'umed')['total'], '0');
check('tx: empty denom matches nothing', msgsend_total_to($body, $COLLECT, '')['total'], '0');

// An 18-decimal chain: ten tokens already exceeds PHP_INT_MAX.
$body = ['messages' => [
    $send($PAYER, $COLLECT, [$coin('awei', '9000000000000000000')]),
    $send($PAYER, $COLLECT, [$coin('awei', '9000000000000000000')]),
]];
check('tx: sums past int max exactly', msgsend_total_to($body, $COLLECT, 'awei')['total'], '18000000000000000000');

// =============================================================================
echo "\n";
if ($failed > 0) {
    echo implode("\n", $failures) . "\n\n";
}
printf("PHP security tests: %d passed, %d failed\n", $passed, $failed);
exit($failed > 0 ? 1 : 0);
