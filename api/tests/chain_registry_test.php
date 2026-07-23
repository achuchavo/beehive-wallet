<?php
/**
 * Integration check: every ACTIVE chain in the database is usable by every
 * backend feature that takes a chain key.
 *
 * This needs a real database, so it is not part of the dependency-free
 * api/tests/run.php suite. Run it directly:
 *
 *   D:\WebServer\php\php.exe api\tests\chain_registry_test.php
 *
 * It is read-only: it inserts nothing and validates address formats against the
 * same helpers the endpoints use. The bug it exists to catch is a chain that
 * the UI offers but the API rejects as "Unknown chain" - which is exactly what
 * happened when chain_config() read a static chains.json listing Medibloc only
 * while the frontend served Medibloc AND Chihuahua from the database.
 */

declare(strict_types=1);

// The endpoints run inside a session; the CLI does not need one, and
// common.php's session_start() is harmless here but noisy. Suppress the
// headers-already-sent path by declaring CLI intent.
if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "CLI only\n");
    exit(1);
}

require_once __DIR__ . '/../common.php';

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
        "FAIL %s\n  expected: %s\n  actual:   %s",
        $name,
        var_export($expected, true),
        var_export($actual, true)
    );
}

function ok(string $name, bool $cond): void
{
    check($name, $cond, true);
}

// ---------------------------------------------------------------------------
$chains = active_chains();
ok('registry is not empty', count($chains) > 0);
echo 'Active chains: ' . implode(', ', array_column($chains, 'key')) . "\n\n";

// A silent default is the specific failure mode being guarded against here.
check('empty chain key resolves to nothing', chain_config(''), null);
check('unknown chain key resolves to nothing', chain_config('not-a-chain'), null);

foreach ($chains as $c) {
    $key = $c['key'];

    // 1. Every active chain must be resolvable by key.
    $resolved = chain_config($key);
    ok("$key: chain_config resolves", $resolved !== null);
    if ($resolved === null) {
        continue;
    }

    // 2. Fields the endpoints actually dereference must be present, or they
    //    fatal at runtime rather than returning a clean error.
    foreach (['chainId', 'chainName', 'bech32Prefix', 'denom', 'displayDenom'] as $field) {
        ok("$key: has $field", ($resolved[$field] ?? '') !== '');
    }
    ok("$key: decimals is an int", is_int($resolved['decimals']));

    // 3. Address validation - the gate in watched_add.php, register.php and
    //    address_challenge.php. Build a syntactically valid address for THIS
    //    chain by re-encoding a known payload under its prefix.
    $sample = bech32_encode($resolved['bech32Prefix'], bech32_decode(
        'panacea1hlpw58lg9fvwvwa3ryzgjqyw39tf2nmnhhr072'
    )['data']);
    ok("$key: accepts its own account address", looks_like_address($sample, $resolved['bech32Prefix']));
    ok("$key: is_account_address accepts it", is_account_address($sample, $resolved['bech32Prefix']));

    // 4. Validator address gate in uptime_apply.php.
    $valoper = bech32_encode($resolved['bech32Prefix'] . 'valoper', bech32_decode(
        'panacea1hlpw58lg9fvwvwa3ryzgjqyw39tf2nmnhhr072'
    )['data']);
    ok(
        "$key: accepts its own valoper address",
        looks_like_address($valoper, $resolved['bech32Prefix'] . 'valoper')
    );

    // 5. Cross-chain rejection: one chain's address must not validate against
    //    another's prefix, or an alert could be filed under the wrong network.
    foreach ($chains as $other) {
        if ($other['key'] === $key || $other['bech32Prefix'] === $resolved['bech32Prefix']) {
            continue;
        }
        ok(
            "$key: address rejected by {$other['key']}",
            !looks_like_address($sample, $other['bech32Prefix'])
        );
    }

    // 6. Explorer links must be configured, or history/alert rows link nowhere.
    //    Read straight from the table - chain_config() does not carry these.
    $db = get_db();
    $stmt = $db->prepare('SELECT explorer_tx_url, explorer_validator_url FROM chains WHERE chain_key = ?');
    $stmt->execute([$key]);
    $ex = $stmt->fetch();
    ok("$key: has an explorer tx url", ($ex['explorer_tx_url'] ?? '') !== '');
    ok(
        "$key: explorer tx url is https",
        str_starts_with((string) ($ex['explorer_tx_url'] ?? ''), 'https://')
    );

    // 7. At least one active LCD endpoint, or every read for this chain 502s.
    ok("$key: has an lcd endpoint", $resolved['lcd'] !== '');
}

echo "\n";
if ($failed > 0) {
    echo implode("\n", $failures) . "\n\n";
}
printf("Chain registry tests: %d passed, %d failed\n", $passed, $failed);
exit($failed > 0 ? 1 : 0);
