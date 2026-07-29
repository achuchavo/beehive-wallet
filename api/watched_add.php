<?php
// Add a FREE watch. Anything the user has to pay for goes through
// watch_payment_submit.php instead, so there is exactly one path that can
// create a paid watch and it is the one that verifies a payment.
require __DIR__ . '/common.php';
require_once __DIR__ . '/watch_billing.php';
require_post();

$db = get_db();
$userId = require_user($db);
$body = read_body();

$chainKey = trim($body['chain_key'] ?? '');
$address = trim($body['address'] ?? '');
$label = trim($body['label'] ?? '');
$alarmType = trim($body['alarm_type'] ?? 'both');
$allowedTypes = ['sent', 'received', 'both', 'unbond'];
if (!in_array($alarmType, $allowedTypes, true)) {
    $alarmType = 'both';
}

// One registry for the whole app: the `chains` table, via chain_config().
// This used to read a static chains.json that only ever listed Medibloc, so
// watching a Chihuahua address failed with "Unknown chain".
$chain = chain_config($chainKey);
if ($chain === null) {
    json_error('Unknown chain');
}
if (!looks_like_address($address, $chain['bech32Prefix'])) {
    json_error("Enter a valid {$chain['chainName']} address");
}

// Already watched? Answer before any cap or price is considered. Re-submitting
// something the user already has is a no-op, and neither the global limit nor a
// fee should be raised against it.
$existing = $db->prepare(
    'SELECT id FROM watched_addresses WHERE user_id = ? AND chain_key = ? AND address = ?'
);
$existing->execute([$userId, $chainKey, $address]);
$existingId = $existing->fetchColumn();
if ($existingId !== false) {
    json_out(['ok' => true, 'id' => (int) $existingId, 'duplicate' => true]);
}

// Per-chain allowance. A chain with no pricing row is unmetered and behaves
// exactly as it always has - only the global cap below applies.
$quote = watch_quote($db, $userId, $chainKey, $chain);

if ($quote['metered'] && !$quote['alerts_enabled']) {
    json_error("Address alerts are switched off for {$chain['chainName']}");
}

if (!$quote['next_is_free']) {
    // 402 with the quote attached, so the app can show the fee, the collection
    // address and the cadence rather than a bare refusal. This endpoint never
    // creates a paid watch - the user pays, and watch_payment_submit.php
    // verifies it on chain before anything is enabled.
    json_out([
        'ok' => false,
        'error' => $quote['sellable']
            ? 'This address needs a payment before alerts can be switched on.'
            : 'You have used your free alerts on this network, and no more are available right now.',
        'code' => 'payment_required',
        'quote' => $quote,
    ], 402);
}

// The global cap is admin-configurable (app_settings.watch_limit) and applies
// on top of the per-chain allowance, including to paid watches - see
// watch_payment_submit.php, which enforces it too. The client-side guard is
// convenience, not control.
$limit = watch_limit($db);
$stmt = $db->prepare('SELECT COUNT(*) AS n FROM watched_addresses WHERE user_id = ?');
$stmt->execute([$userId]);
if ((int) $stmt->fetch()['n'] >= $limit) {
    json_error("Watch limit reached ({$limit} addresses)");
}

// Explicitly free-tier. INSERT IGNORE still guards the unique key against a
// duplicate that appeared between the check above and here.
$stmt = $db->prepare(
    "INSERT IGNORE INTO watched_addresses
        (user_id, chain_key, address, label, alarm_enabled, alarm_type,
         tier, paid_until, payment_state, created_at)
     VALUES (?, ?, ?, ?, 1, ?, 'free', NULL, 'active', NOW())"
);
$stmt->execute([$userId, $chainKey, $address, $label, $alarmType]);

if ($stmt->rowCount() === 0) {
    // Raced with another request adding the same address: return the existing
    // row's id with an explicit duplicate flag rather than a bogus zero.
    $existing->execute([$userId, $chainKey, $address]);
    json_out(['ok' => true, 'id' => (int) $existing->fetchColumn(), 'duplicate' => true]);
}

json_out(['ok' => true, 'id' => (int) $db->lastInsertId(), 'duplicate' => false]);
