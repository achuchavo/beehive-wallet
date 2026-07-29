<?php
// Save (or clear) one chain's address-alert pricing.
//
// Validation is strict rather than forgiving, and rejects instead of clamping,
// for the same reason admin_setting_set.php does: silently storing 500 when the
// admin typed 5000 looks like the save worked as asked. On a screen that sets a
// PRICE and a COLLECTION ADDRESS, quietly correcting input is how money ends up
// somewhere nobody intended.
require __DIR__ . '/common.php';
require_once __DIR__ . '/watch_billing.php';
require_post();

$db = get_db();
$adminId = require_permission($db, 'alert_pricing', PERM_WRITE);

sensitive_rate_limit("alertprice_{$adminId}", 30);

$body = read_body();
$chainKey = trim($body['chain_key'] ?? '');

// The chain must exist. Read from the table directly rather than through
// chain_config(), which only answers for active chains - pricing an inactive
// chain ahead of switching it on is legitimate.
$stmt = $db->prepare('SELECT chain_key, chain_name, denom, bech32_prefix FROM chains WHERE chain_key = ?');
$stmt->execute([$chainKey]);
$chain = $stmt->fetch();
if (!$chain) {
    json_error('Unknown chain');
}

// Clearing returns the chain to UNMETERED: no cap and no fee, exactly as it
// behaved before any pricing existed. Existing watches are untouched.
if (!empty($body['clear'])) {
    $db->prepare('DELETE FROM chain_alert_pricing WHERE chain_key = ?')->execute([$chainKey]);
    audit_admin_action($db, $adminId, 0, 'alert_pricing_clear', $chainKey);
    json_out(['ok' => true, 'cleared' => true]);
}

$alertsEnabled = !empty($body['alerts_enabled']);

$freeCap = filter_var($body['free_cap'] ?? null, FILTER_VALIDATE_INT);
if ($freeCap === false || $freeCap < 0 || $freeCap > FREE_CAP_MAX) {
    json_error('Free allowance must be a whole number between 0 and ' . FREE_CAP_MAX);
}

$graceDays = filter_var($body['grace_days'] ?? 0, FILTER_VALIDATE_INT);
if ($graceDays === false || $graceDays < 0 || $graceDays > GRACE_DAYS_MAX) {
    json_error('Grace period must be a whole number of days between 0 and ' . GRACE_DAYS_MAX);
}

$cadence = trim($body['cadence'] ?? 'one_time');
if (!in_array($cadence, WATCH_CADENCES, true)) {
    json_error('Unknown billing period');
}

// BASE UNITS as a string, never a number. 200 MED is '200000000' umed; the
// admin screen does the conversion from display units and shows the result
// before saving, so what is stored is what was confirmed.
$feeAmount = base_normalize(trim((string) ($body['fee_amount'] ?? '')));
if ($feeAmount === null) {
    json_error('The fee must be a whole number of base units');
}

// The denomination has to be the chain's own - nothing else could be paid, and
// an exact string match is what stops an IBC lookalike being configured.
$feeDenom = trim($body['fee_denom'] ?? '');
if ($feeDenom === '') {
    $feeDenom = (string) $chain['denom'];
}
if ($feeDenom !== (string) $chain['denom']) {
    json_error("The fee must be priced in {$chain['denom']}, this network's own denomination");
}

// Full bech32 validation - HRP and checksum - not a prefix guess. A typo here
// sends every fee to an address nobody controls, and it would look like it
// worked. Empty is allowed and means "not selling yet": the paid tier is then
// unavailable, and users over the free cap simply cannot add more.
$collect = trim($body['collect_address'] ?? '');
if ($collect !== '' && !is_account_address($collect, (string) $chain['bech32_prefix'])) {
    json_error("Enter a valid {$chain['chain_name']} address to collect fees, or leave it empty");
}

// A configuration that charges for something it cannot collect is refused
// outright rather than saved and quietly ignored at enforcement time.
if ($alertsEnabled && base_is_positive($feeAmount) && $collect === '') {
    json_error('Set a collection address, or set the fee to zero to stop selling extra alerts');
}

$stmt = $db->prepare(
    'INSERT INTO chain_alert_pricing
        (chain_key, alerts_enabled, free_cap, fee_amount, fee_denom,
         collect_address, cadence, grace_days, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
        alerts_enabled = VALUES(alerts_enabled),
        free_cap = VALUES(free_cap),
        fee_amount = VALUES(fee_amount),
        fee_denom = VALUES(fee_denom),
        collect_address = VALUES(collect_address),
        cadence = VALUES(cadence),
        grace_days = VALUES(grace_days),
        updated_by = VALUES(updated_by),
        updated_at = NOW()'
);
$stmt->execute([
    $chainKey,
    $alertsEnabled ? 1 : 0,
    $freeCap,
    $feeAmount,
    $feeDenom,
    $collect,
    $cadence,
    $graceDays,
    $adminId,
]);

// NOTHING is written to existing watches here, and that is the whole
// grandfathering story: introducing or lowering a cap only ever gates the NEXT
// add. Someone who set up five alerts under the old rules keeps all five and
// simply cannot add a sixth without paying. Silently switching off something a
// user relies on to watch their own money would be the wrong way to introduce a
// price - and it is the same promise the watched-addresses limit already makes.
//
// No backfill pass is needed for this to hold: free_slots_used() counts the
// rows that exist, so a user over the cap has no free slots until they remove
// one, and a user under it keeps the difference.

audit_admin_action(
    $db,
    $adminId,
    0,
    'alert_pricing_save',
    "{$chainKey} cap={$freeCap} fee={$feeAmount}{$feeDenom} cadence={$cadence}"
);

json_out(['ok' => true]);
