<?php
// "What would the next address alert on this chain cost me?"
//
// Answers with the price AND, when there is something to buy, issues a payment
// intent: a locked quote plus the memo code that binds a payment to this
// account. Nothing is charged here and no watch is created - this is the screen
// the user reads before deciding.
//
// POST rather than GET because it writes an intent row.
require __DIR__ . '/common.php';
require_once __DIR__ . '/watch_billing.php';
require_post();

$db = get_db();
$userId = require_user($db);

// Issuing intents is cheap but not free, and each one is a row. Meter it.
sensitive_rate_limit("quote_{$userId}", 30);

$body = read_body();
$chainKey = trim($body['chain_key'] ?? '');
$address = trim($body['address'] ?? '');
$kind = ($body['kind'] ?? 'new') === 'renew' ? 'renew' : 'new';
$watchId = (int) ($body['watch_id'] ?? 0);

$chain = chain_config($chainKey);
if ($chain === null) {
    json_error('Unknown chain');
}

// A renewal must name a paid watch this user actually owns. Checked before any
// price is quoted, so a probe cannot learn whether a watch id exists.
$existing = null;
if ($kind === 'renew') {
    $stmt = $db->prepare(
        'SELECT id, address, tier, paid_until FROM watched_addresses
         WHERE id = ? AND user_id = ? AND chain_key = ?'
    );
    $stmt->execute([$watchId, $userId, $chainKey]);
    $existing = $stmt->fetch();
    if (!$existing) {
        json_error('Watch not found', 404);
    }
    if ($existing['tier'] !== 'paid') {
        json_error('This alert is not a paid one and does not need renewing');
    }
    $address = (string) $existing['address'];
}

$quote = watch_quote($db, $userId, $chainKey, $chain);

// Nothing to sell: either the next watch is already free, the chain is
// unmetered, alerts are switched off, or the pricing is not in a state we are
// willing to take money against (see pricing_sellable). The caller renders the
// reason; no intent is issued because there is nothing to pay for.
// An exempt account owes nothing, including on a renewal - otherwise a watch
// bought before the account was promoted would keep asking it to pay.
$needsPayment = !$quote['exempt'] && ($kind === 'renew' || !$quote['next_is_free']);
if (!$needsPayment || !$quote['sellable']) {
    json_out([
        'ok' => true,
        'quote' => $quote,
        'needs_payment' => $needsPayment,
        'intent' => null,
    ]);
}

// Opportunistic cleanup, in the style of the other tables here.
if (random_int(1, 50) === 1) {
    try {
        $db->exec('DELETE FROM watch_payment_intents WHERE consumed_at IS NULL AND expires_at < NOW() - INTERVAL 7 DAY');
    } catch (Throwable $e) {
        error_log('watch_quote: intent cleanup failed: ' . $e->getMessage());
    }
}

// Issue the intent. The memo code is unique across the table, so a collision is
// retried rather than allowed to fail the request - at ~50 bits of entropy this
// effectively never runs twice.
$memoCode = '';
for ($attempt = 0; $attempt < 5; $attempt++) {
    $candidate = issue_memo_code();
    try {
        $stmt = $db->prepare(
            'INSERT INTO watch_payment_intents
                (user_id, chain_key, kind, address, watch_id, memo_code,
                 fee_amount, fee_denom, collect_address, cadence,
                 expires_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW() + INTERVAL ' . INTENT_TTL_SECONDS . ' SECOND, NOW())'
        );
        $stmt->execute([
            $userId,
            $chainKey,
            $kind,
            mb_substr($address, 0, 120),
            $kind === 'renew' ? $watchId : null,
            $candidate,
            // The PRICE SNAPSHOT. Verification uses these, not the live pricing
            // row, so an admin edit cannot move a quote under someone who is
            // part-way through paying it.
            $quote['fee_amount'],
            $quote['fee_denom'],
            $quote['collect_address'],
            $quote['cadence'],
        ]);
        $memoCode = $candidate;
        break;
    } catch (PDOException $e) {
        // 23000 = integrity constraint violation, i.e. the memo code collided.
        if ($e->getCode() !== '23000') {
            error_log('watch_quote: intent insert failed: ' . $e->getMessage());
            json_error('Could not start the payment. Please try again.', 500);
        }
    }
}

if ($memoCode === '') {
    error_log('watch_quote: could not allocate a unique memo code');
    json_error('Could not start the payment. Please try again.', 500);
}

$stmt = $db->prepare('SELECT expires_at FROM watch_payment_intents WHERE memo_code = ?');
$stmt->execute([$memoCode]);
$expiresAt = $stmt->fetchColumn();

json_out([
    'ok' => true,
    'quote' => $quote,
    'needs_payment' => true,
    'intent' => [
        'memo_code' => $memoCode,
        'expires_at' => $expiresAt,
        // Echoed from the snapshot rather than from live pricing: this is the
        // price that will actually be accepted.
        'fee_amount' => $quote['fee_amount'],
        'fee_denom' => $quote['fee_denom'],
        'collect_address' => $quote['collect_address'],
        'cadence' => $quote['cadence'],
        'kind' => $kind,
        'watch_id' => $kind === 'renew' ? $watchId : null,
    ],
]);
