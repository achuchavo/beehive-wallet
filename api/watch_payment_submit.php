<?php
// Verify an on-chain fee payment and enable (or renew) the watch it paid for.
//
// NON-CUSTODIAL. The user signed and broadcast a normal transfer themselves.
// This endpoint asks a node whether that transfer really happened and, if so,
// writes it down. It never holds funds, never holds keys, and cannot move
// anything.
//
// A CLIENT CLAIM IS NEVER TRUSTED. The only thing the client supplies that is
// taken at face value is the transaction hash to go and look up; every fact
// about that transaction - who it paid, how much, in what denomination, whether
// it succeeded, when it landed - comes from the chain.
//
// Checks run cheapest-first and, crucially, every validation that can reject
// without touching the chain runs BEFORE the payment is consumed. A rejected
// payment must leave nothing behind, so the user can fix the problem and retry
// with the same transaction.
require __DIR__ . '/common.php';
require_once __DIR__ . '/watch_billing.php';
require_post();

$db = get_db();
$userId = require_user($db);

// This endpoint makes an outbound node call, so it is metered per account -
// otherwise it is a free amplifier pointed at whoever runs the LCD.
sensitive_rate_limit("watchpay_{$userId}", 10);

$body = read_body();
$chainKey = trim($body['chain_key'] ?? '');
$memoCode = trim($body['memo_code'] ?? '');
$rawHash = trim($body['tx_hash'] ?? '');
$label = trim($body['label'] ?? '');
$alarmType = trim($body['alarm_type'] ?? 'both');

$allowedTypes = ['sent', 'received', 'both', 'unbond'];
if (!in_array($alarmType, $allowedTypes, true)) {
    $alarmType = 'both';
}

$chain = chain_config($chainKey);
if ($chain === null) {
    json_error('Unknown chain');
}

// Shape-check the hash before anything reaches the network. Cosmos transaction
// hashes are 32 bytes of hex; anything else is not a lookup we should make on a
// caller's say-so.
$txHash = strtoupper($rawHash);
if (!preg_match('/^[0-9A-F]{64}$/', $txHash)) {
    json_error('Enter the 64-character transaction hash');
}

// --- The intent -------------------------------------------------------------
// Scoped to this user, so one account cannot spend another's quote. This is
// also where the locked price comes from.
$stmt = $db->prepare(
    'SELECT * FROM watch_payment_intents
     WHERE memo_code = ? AND user_id = ? AND chain_key = ?'
);
$stmt->execute([$memoCode, $userId, $chainKey]);
$intent = $stmt->fetch();

if (!$intent) {
    json_error('This payment request was not found. Start again to get a new one.', 404);
}
if ($intent['consumed_at'] !== null) {
    json_error('This payment request has already been used.', 409);
}
if (strtotime((string) $intent['expires_at']) < time()) {
    json_error('This payment request has expired. Start again to get a new one.', 410);
}

$isRenew = $intent['kind'] === 'renew';
$address = $isRenew ? (string) $intent['address'] : trim($body['address'] ?? '');

if (!looks_like_address($address, $chain['bech32Prefix'])) {
    json_error("Enter a valid {$chain['chainName']} address");
}

// --- Everything that can be refused without spending the payment ------------
$existingWatch = null;
if ($isRenew) {
    $stmt = $db->prepare(
        'SELECT id, address, tier, paid_until FROM watched_addresses
         WHERE id = ? AND user_id = ? AND chain_key = ?'
    );
    $stmt->execute([(int) $intent['watch_id'], $userId, $chainKey]);
    $existingWatch = $stmt->fetch();
    if (!$existingWatch) {
        json_error('Watch not found', 404);
    }
} else {
    // Already watching it? Then there is nothing to sell, and consuming a real
    // payment for a no-op would be the worst possible outcome here.
    $stmt = $db->prepare(
        'SELECT id FROM watched_addresses WHERE user_id = ? AND chain_key = ? AND address = ?'
    );
    $stmt->execute([$userId, $chainKey, $address]);
    if ($stmt->fetch()) {
        json_error('You are already watching this address');
    }

    // The GLOBAL cap still applies on top of the per-chain allowance. A paid
    // tier must not become a way around the audited absolute limit - so this is
    // checked before the payment is taken, not after.
    $limit = watch_limit($db);
    $stmt = $db->prepare('SELECT COUNT(*) FROM watched_addresses WHERE user_id = ?');
    $stmt->execute([$userId]);
    if ((int) $stmt->fetchColumn() >= $limit) {
        json_error("Watch limit reached ({$limit} addresses)");
    }
}

// --- Ask the chain ----------------------------------------------------------
$lookup = lcd_get($db, $chainKey, '/cosmos/tx/v1beta1/txs/' . $txHash);

if (!$lookup['ok']) {
    // RETRIABLE failures are reported as such and consume nothing. A node that
    // has not indexed the transaction yet is the single most likely thing to go
    // wrong in this flow, and telling the user "payment failed" for it would be
    // a false statement about their money.
    if ($lookup['error'] === 'not_found') {
        json_out([
            'ok' => false,
            'error' => 'The network has not confirmed this transaction yet. Wait a few seconds and try again.',
            'code' => 'not_indexed',
            'retriable' => true,
        ], 404);
    }
    error_log("watch_payment_submit: lcd {$lookup['error']} for {$chainKey}/{$txHash}");
    json_out([
        'ok' => false,
        'error' => 'Could not reach the network to check this payment. Please try again shortly.',
        'code' => 'lcd_unavailable',
        'retriable' => true,
    ], 503);
}

$data = $lookup['data'];
$txResponse = is_array($data['tx_response'] ?? null) ? $data['tx_response'] : [];
$tx = is_array($data['tx'] ?? null) ? $data['tx'] : [];
$txBody = is_array($tx['body'] ?? null) ? $tx['body'] : [];

// The node must be answering about the transaction we asked for.
if (strtoupper((string) ($txResponse['txhash'] ?? '')) !== $txHash) {
    json_error('The network returned a different transaction. Please try again.', 502);
}

// A transaction that failed on chain moved no money, whatever it contained.
if ((int) ($txResponse['code'] ?? -1) !== 0) {
    json_out([
        'ok' => false,
        'error' => 'That transaction failed on the network, so no payment was made.',
        'code' => 'tx_failed',
        'retriable' => false,
    ], 400);
}

// Committed and in a block. No confirmation DEPTH is required: a Tendermint
// block is final the moment it commits, and a hash lookup only ever returns a
// committed transaction. Waiting for "n confirmations" here would be a Bitcoin
// habit applied to a chain that does not work that way.
$height = (int) ($txResponse['height'] ?? 0);
if ($height <= 0) {
    json_out([
        'ok' => false,
        'error' => 'The network has not confirmed this transaction yet. Wait a few seconds and try again.',
        'code' => 'not_indexed',
        'retriable' => true,
    ], 409);
}

// The transaction must be NEWER than the request it is paying. This is what
// stops someone finding an old, unrelated transfer that happens to have gone to
// the collection address and claiming it as their fee.
$txTime = strtotime((string) ($txResponse['timestamp'] ?? ''));
$intentCreated = strtotime((string) $intent['created_at']);
if ($txTime === false || $txTime <= 0) {
    json_error('Could not read the transaction time. Please try again.', 502);
}
// A small allowance for clock skew between the node and this server.
if ($txTime < $intentCreated - 300) {
    json_out([
        'ok' => false,
        'error' => 'That transaction is older than this payment request. Pay again with a new request.',
        'code' => 'tx_too_old',
        'retriable' => false,
    ], 400);
}

// --- Who paid, and how much -------------------------------------------------
// Against the SNAPSHOT in the intent, never the live pricing row.
$expectedTo = (string) $intent['collect_address'];
$expectedDenom = (string) $intent['fee_denom'];
$expectedFee = (string) $intent['fee_amount'];

$paid = msgsend_total_to($txBody, $expectedTo, $expectedDenom);
$total = $paid['total'];

if (!base_is_positive($total)) {
    json_out([
        'ok' => false,
        'error' => 'That transaction did not pay the collection address in the expected currency.',
        'code' => 'no_matching_payment',
        'retriable' => false,
    ], 400);
}

$cmp = base_cmp($total, $expectedFee);
if ($cmp === null) {
    error_log("watch_payment_submit: unparseable amounts total={$total} fee={$expectedFee}");
    json_error('Could not check the payment amount. Please contact support.', 500);
}
if ($cmp < 0) {
    // UNDERPAYMENT. Nothing is consumed, so the user still holds a usable
    // request - but a second transfer will not top this one up, because a
    // payment is one transaction. Say so plainly.
    json_out([
        'ok' => false,
        'error' => 'That payment was too small. The full fee has to be sent in a single transaction.',
        'code' => 'underpaid',
        'paid' => $total,
        'required' => $expectedFee,
        'denom' => $expectedDenom,
        'retriable' => false,
    ], 400);
}
// Overpayment is accepted and recorded as what it was. It is not credited
// towards a later period and not refunded; the UI says so before they pay.

// --- Binding: is this payment THIS user's? ----------------------------------
// Transaction hashes are public, so without this anyone could submit someone
// else's fee payment and consume it.
$memoInTx = trim((string) ($txBody['memo'] ?? ''));
$memoMatches = $memoInTx !== '' && hash_equals((string) $intent['memo_code'], $memoInTx);

$senderMatches = false;
if (!$memoMatches) {
    // Fallback: they paid from an address they have already PROVEN they
    // control. An unverified main_address does not count - it is an unproven
    // claim, and honouring it would let someone name a victim's address and
    // then harvest payments sent from it.
    $owned = verified_addresses($db, $userId);
    foreach ($paid['senders'] as $sender) {
        if (in_array($sender, $owned, true)) {
            $senderMatches = true;
            break;
        }
    }
}

if (!$memoMatches && !$senderMatches) {
    json_out([
        'ok' => false,
        'error' => 'That payment could not be matched to your account. The memo must contain your payment code.',
        'code' => 'not_bound',
        'expected_memo' => (string) $intent['memo_code'],
        'retriable' => false,
    ], 400);
}

$paidFrom = $paid['senders'][0] ?? '';

// --- Record it --------------------------------------------------------------
// One transaction. The unique key on (chain_key, tx_hash) is what consumes the
// payment: two concurrent submits of the same hash resolve to one INSERT winner
// and one duplicate-key error, with no locking needed.
$cadence = in_array($intent['cadence'], WATCH_CADENCES, true) ? $intent['cadence'] : 'one_time';
$interval = cadence_interval_sql($cadence);

$paidUntil = null;
if ($interval !== null) {
    // Renewing early EXTENDS rather than resets: measured from the later of now
    // and the current expiry, so paying ahead of time is never punished.
    $existingUntil = $existingWatch['paid_until'] ?? null;
    $q = $db->prepare(
        "SELECT DATE_FORMAT(GREATEST(NOW(), COALESCE(?, NOW())) + {$interval}, '%Y-%m-%d %H:%i:%s')"
    );
    $q->execute([$existingUntil]);
    $paidUntil = (string) $q->fetchColumn();
}

$db->beginTransaction();
try {
    $ins = $db->prepare(
        'INSERT INTO watch_payments
            (user_id, chain_key, tx_hash, watched_address_id, amount, denom,
             collect_address, fee_amount, cadence, memo_code, paid_from,
             height, tx_time, period_start, paid_until, verified_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, FROM_UNIXTIME(?), NOW(), ?, NOW())'
    );
    $ins->execute([
        $userId,
        $chainKey,
        $txHash,
        $total,
        $expectedDenom,
        $expectedTo,
        $expectedFee,
        $cadence,
        (string) $intent['memo_code'],
        mb_substr($paidFrom, 0, 120),
        $height,
        $txTime,
        $paidUntil,
    ]);
    $paymentId = (int) $db->lastInsertId();

    if ($isRenew) {
        $watchId = (int) $existingWatch['id'];
        $db->prepare(
            "UPDATE watched_addresses
             SET tier = 'paid', paid_until = ?, payment_state = 'active'
             WHERE id = ? AND user_id = ?"
        )->execute([$paidUntil, $watchId, $userId]);
    } else {
        $db->prepare(
            "INSERT INTO watched_addresses
                (user_id, chain_key, address, label, alarm_enabled, alarm_type,
                 tier, paid_until, payment_state, created_at)
             VALUES (?, ?, ?, ?, 1, ?, 'paid', ?, 'active', NOW())"
        )->execute([$userId, $chainKey, $address, $label, $alarmType, $paidUntil]);
        $watchId = (int) $db->lastInsertId();
    }

    // Link the ledger row to what it bought.
    $db->prepare('UPDATE watch_payments SET watched_address_id = ? WHERE id = ?')
        ->execute([$watchId, $paymentId]);

    $db->prepare('UPDATE watch_payment_intents SET consumed_at = NOW() WHERE id = ?')
        ->execute([(int) $intent['id']]);

    $db->commit();
} catch (PDOException $e) {
    if ($db->inTransaction()) {
        $db->rollBack();
    }
    // 23000 on this path means the hash was already recorded - either the user
    // double-submitted, or someone tried to claim a payment already spent.
    if ($e->getCode() === '23000') {
        json_out([
            'ok' => false,
            'error' => 'That payment has already been used for another alert.',
            'code' => 'already_used',
            'retriable' => false,
        ], 409);
    }
    error_log('watch_payment_submit failed: ' . $e->getMessage());
    json_error('Could not record the payment. Please contact support with your transaction hash.', 500);
} catch (Throwable $e) {
    if ($db->inTransaction()) {
        $db->rollBack();
    }
    error_log('watch_payment_submit failed: ' . $e->getMessage());
    json_error('Could not record the payment. Please contact support with your transaction hash.', 500);
}

json_out([
    'ok' => true,
    'id' => $watchId,
    'tier' => 'paid',
    'paid_until' => $paidUntil,
    'cadence' => $cadence,
    'amount' => $total,
    'denom' => $expectedDenom,
]);
