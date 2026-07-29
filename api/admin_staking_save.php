<?php
// Set a chain's staking policy, and the fee charged for delegating outside the
// allowed list.
//
// Rejects rather than clamps, like admin_setting_set.php and
// admin_alert_pricing_save.php: this screen sets a PRICE and an address that
// receives it, and quietly correcting either is how money ends up somewhere
// nobody intended.
require __DIR__ . '/common.php';
require_once __DIR__ . '/watch_billing.php';
require_post();

$db = get_db();
$adminId = require_permission($db, 'staking', PERM_WRITE);

sensitive_rate_limit("staking_{$adminId}", 30);

$body = read_body();
$chainKey = trim($body['chain_key'] ?? '');

$stmt = $db->prepare('SELECT chain_key, chain_name, denom, bech32_prefix FROM chains WHERE chain_key = ?');
$stmt->execute([$chainKey]);
$chain = $stmt->fetch();
if (!$chain) {
    json_error('Unknown chain');
}

$policy = trim($body['staking_policy'] ?? 'all');
if (!in_array($policy, STAKING_POLICIES, true)) {
    json_error('Unknown staking policy');
}

// BASE UNITS as a string, never a float. The admin screen converts from display
// units and shows the stored value before saving.
$fee = base_normalize(trim((string) ($body['service_fee'] ?? '0')));
if ($fee === null) {
    json_error('The fee must be a whole number of base units');
}

// Full bech32 validation - HRP and checksum - not a prefix guess. Empty is
// allowed and means no fee can be collected.
$collector = trim($body['fee_collector'] ?? '');
if ($collector !== '' && !is_account_address($collector, (string) $chain['bech32_prefix'])) {
    json_error("Enter a valid {$chain['chain_name']} address to collect fees, or leave it empty");
}

// A policy that charges for something it cannot collect is refused outright
// rather than saved and silently ignored at delegation time.
if ($policy === 'allowlist_paid') {
    if (!base_is_positive($fee)) {
        json_error('Set a fee, or choose a different policy - paid staking with a zero fee charges nothing');
    }
    if ($collector === '') {
        json_error('Set a collection address for the staking fee');
    }
}

// An allow-list policy with nothing on the list would offer users no validator
// at all. Caught here because the symptom - an empty validator screen with no
// explanation - is indistinguishable from a loading failure.
if ($policy !== 'all') {
    $count = $db->prepare('SELECT COUNT(*) FROM chain_free_validators WHERE chain_key = ?');
    $count->execute([$chainKey]);
    if ((int) $count->fetchColumn() === 0) {
        json_error('Add at least one allowed validator before restricting staking to a list');
    }
}

$db->prepare(
    'UPDATE chains SET staking_policy = ?, service_fee = ?, fee_collector = ? WHERE chain_key = ?'
)->execute([$policy, $fee, $collector, $chainKey]);

audit_admin_action(
    $db,
    $adminId,
    0,
    'staking_policy_save',
    "{$chainKey} policy={$policy} fee={$fee}{$chain['denom']}"
);

json_out(['ok' => true]);
