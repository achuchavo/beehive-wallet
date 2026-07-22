<?php
// Cross-language verification tests for the ADR-036 address-ownership proof
// (audit #19). The vectors below were produced independently by CosmJS
// (app/scripts/adr36-testvector.mjs), so a pass proves the PHP verifier agrees
// with the client that will actually generate these signatures.
//
//   php api/tests/adr36_test.php

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

// --- CosmJS-generated vector -------------------------------------------------
$V = [
    'address' => 'panacea16q6g46va64az2gvgsykqzhmp7gvzmqw28qngsc',
    'prefix'  => 'panacea',
    'message' => "Beehive ownership proof\nnonce: a/b+c=\naddress: panacea16q6g46va64az2gvgsykqzhmp7gvzmqw28qngsc",
    'signDoc' => '{"account_number":"0","chain_id":"","fee":{"amount":[],"gas":"0"},"memo":"","msgs":[{"type":"sign/MsgSignData","value":{"data":"QmVlaGl2ZSBvd25lcnNoaXAgcHJvb2YKbm9uY2U6IGEvYitjPQphZGRyZXNzOiBwYW5hY2VhMTZxNmc0NnZhNjRhejJndmdzeWtxemhtcDdndnptcXcyOHFuZ3Nj","signer":"panacea16q6g46va64az2gvgsykqzhmp7gvzmqw28qngsc"}}],"sequence":"0"}',
    'pubkey'  => 'BHgqvYcZLLpnJMvuDU3EusugS6sCr8/hrKAicDndSarV7qpyISGh9DUNyVpLEz4L1hujjFqc+doMeg3WTCUZnGw=',
    'sig'     => 'SteIxBzCFa+NMcN4tRtNiN67b1/k1do5O/IZ/I0h+L8bUB5wo/hCxhocM6dFtDp0a3pYvJ8RrdMWKSyPAtZOmg==',
];

// The sign doc must match CosmJS byte-for-byte. This is the subtle one: PHP
// escapes '/' by default and the base64 payload contains '/', so without
// JSON_UNESCAPED_SLASHES every signature would silently fail to verify.
check('sign doc matches CosmJS exactly', adr36_sign_doc($V['message'], $V['address']), $V['signDoc']);

// Address derivation from the public key.
$pub = base64_decode($V['pubkey'], true);
check('pubkey is 65-byte uncompressed', strlen($pub) === 65 && $pub[0] === "\x04", true);
check('point is on secp256k1', secp256k1_point_on_curve($pub), true);
check('compressed pubkey is 33 bytes', strlen(secp256k1_compress($pub)), 33);
check(
    'address derives from pubkey',
    cosmos_address_from_pubkey(secp256k1_compress($pub), $V['prefix']),
    $V['address']
);
// Round-trip through our own bech32 decoder.
check('derived address passes bech32 validation', is_account_address($V['address'], 'panacea'), true);

// --- The actual verification -------------------------------------------------
check(
    'valid signature accepted',
    verify_address_ownership($V['message'], $V['address'], $V['prefix'], $V['pubkey'], $V['sig']),
    ''
);

// --- Negative cases: every one of these must be rejected ---------------------
check(
    'tampered message rejected',
    verify_address_ownership($V['message'] . 'x', $V['address'], $V['prefix'], $V['pubkey'], $V['sig']),
    'signature_invalid'
);

// A different address with the same signature - the core attack this prevents.
check(
    'claiming a different address rejected',
    verify_address_ownership(
        $V['message'],
        'panacea1a3mg2ek63ql9gh347uqyg75t0u3ns956ytxkhl',
        $V['prefix'],
        $V['pubkey'],
        $V['sig']
    ),
    'address_mismatch'
);

// Flip one bit of the signature.
$sigRaw = base64_decode($V['sig'], true);
$sigRaw[10] = chr(ord($sigRaw[10]) ^ 0x01);
check(
    'corrupted signature rejected',
    verify_address_ownership($V['message'], $V['address'], $V['prefix'], $V['pubkey'], base64_encode($sigRaw)),
    'signature_invalid'
);

// A pubkey that is not on the curve (flip a byte of x).
$badPub = base64_decode($V['pubkey'], true);
$badPub[5] = chr(ord($badPub[5]) ^ 0xff);
check(
    'off-curve pubkey rejected',
    verify_address_ownership($V['message'], $V['address'], $V['prefix'], base64_encode($badPub), $V['sig']),
    'pubkey_not_on_curve'
);

check(
    'compressed pubkey submitted instead of uncompressed rejected',
    verify_address_ownership(
        $V['message'],
        $V['address'],
        $V['prefix'],
        base64_encode(secp256k1_compress($pub)),
        $V['sig']
    ),
    'bad_pubkey_format'
);
check(
    'short signature rejected',
    verify_address_ownership($V['message'], $V['address'], $V['prefix'], $V['pubkey'], base64_encode('short')),
    'bad_signature_length'
);
check(
    'non-base64 rejected',
    verify_address_ownership($V['message'], $V['address'], $V['prefix'], '!!!not base64!!!', $V['sig']),
    'bad_encoding'
);
// Right key, right signature, but the caller claims a different chain's prefix.
check(
    'wrong bech32 prefix rejected',
    verify_address_ownership($V['message'], $V['address'], 'cosmos', $V['pubkey'], $V['sig']),
    'address_mismatch'
);

// --- bech32_encode round-trip ------------------------------------------------
$payload = array_values(unpack('C*', hash('sha256', 'beehive', true)));
$enc = bech32_encode('panacea', array_slice($payload, 0, 20));
$dec = bech32_decode($enc);
check('bech32 encode/decode round-trips', $dec !== null && $dec['hrp'] === 'panacea', true);
check('bech32 round-trip payload length', $dec === null ? -1 : count($dec['data']), 20);

echo "\n";
if ($failed > 0) {
    echo implode("\n", $failures) . "\n\n";
}
printf("ADR-036 ownership tests: %d passed, %d failed\n", $passed, $failed);
exit($failed > 0 ? 1 : 0);
