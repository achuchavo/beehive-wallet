<?php
require __DIR__ . '/common.php';
require_once __DIR__ . '/watch_billing.php';

$db = get_db();
$userId = require_user($db);

$stmt = $db->prepare(
    'SELECT id, chain_key, address, label, alarm_enabled, alarm_type, created_at,
            tier, paid_until, payment_state,
            -- Evaluated against the database clock, not the watcher cursor, so
            -- an expiry that passed since the last sweep is already visible
            -- here. The watcher does the same test before raising an alert, so
            -- this display can never claim a lapsed watch is still armed.
            (tier = \'paid\' AND paid_until IS NOT NULL AND paid_until < NOW()) AS is_lapsed
     FROM watched_addresses
     WHERE user_id = ?
     ORDER BY created_at DESC'
);
$stmt->execute([$userId]);
$rows = $stmt->fetchAll();

$addresses = [];
foreach ($rows as $row) {
    $lapsed = (int) $row['is_lapsed'] === 1;
    unset($row['is_lapsed']);
    $row['payment_state'] = $lapsed ? 'lapsed' : (($row['payment_state'] ?? 'active') === 'lapsed' ? 'lapsed' : 'active');
    $addresses[] = $row;
}

// Per-chain allowance, so the page can say "2 of 2 free MED alerts used" and
// show the price of the next one before the user fills in a form. Only chains
// the user can actually see are included.
$quotes = [];
foreach (active_chains() as $chain) {
    $quotes[$chain['key']] = watch_quote($db, $userId, $chain['key'], $chain);
}

// The global limit rides along too, so the page can show "n of N" and stop
// offering the form at the cap without a second round trip.
json_out([
    'ok' => true,
    'addresses' => $addresses,
    'limit' => watch_limit($db),
    'quotes' => (object) $quotes,
]);
