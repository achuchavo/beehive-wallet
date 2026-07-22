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
echo "\n";
if ($failed > 0) {
    echo implode("\n", $failures) . "\n\n";
}
printf("PHP security tests: %d passed, %d failed\n", $passed, $failed);
exit($failed > 0 ? 1 : 0);
