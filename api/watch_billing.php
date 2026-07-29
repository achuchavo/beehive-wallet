<?php
// Paid address alerts: pricing lookup, entitlement, and payment bookkeeping.
//
// NON-CUSTODIAL, and this file is where that is easiest to lose sight of, so:
// nothing here moves, holds or can spend funds. The USER signs and broadcasts a
// normal transfer to an address the admin configured. All this code does is ask
// a node whether that transfer really happened, and write down that it did.
// There is no key material anywhere in this path.
//
// Required by the watch_* and admin_alert_pricing_* endpoints; common.php is
// required first by those endpoints.

declare(strict_types=1);

// Billing periods. A string rather than an enum so adding 'quarterly' is an
// application change, not a database migration.
const WATCH_CADENCES = ['one_time', 'weekly', 'monthly'];

/**
 * Per-chain staking policy (migration 013).
 *
 *   all             every validator, no fee; the allow list is ignored.
 *   allowlist       ONLY the listed validators are offered, at any price.
 *   allowlist_paid  listed validators are free, others bundle service_fee.
 *
 * SCOPE: this governs what the APP offers. A delegation is a transaction the
 * user signs and broadcasts themselves, so no server rule can stop someone
 * staking elsewhere from another wallet. It is a product policy, not a chain
 * one, and the admin screen says so.
 */
const STAKING_POLICIES = ['all', 'allowlist', 'allowlist_paid'];

// How long a quote (and its memo code) stays valid. Long enough to open a
// wallet, fund it and send; short enough that an abandoned intent does not sit
// around indefinitely. A transaction is only accepted if it is NEWER than the
// intent, so this is also the window in which a payment must land.
const INTENT_TTL_SECONDS = 7200; // 2 hours

// Upper bound on how many watches one payment can be worth. Purely a sanity
// rail on admin input; see admin_alert_pricing_save.php.
const FREE_CAP_MAX = 1000;
const GRACE_DAYS_MAX = 90;

/**
 * Pricing for a chain, or null when the chain is UNMETERED.
 *
 * Unmetered is the shipped default and means exactly today's behaviour: no
 * per-chain cap, no fee, only the global app_settings.watch_limit applies.
 *
 * FAILS OPEN, deliberately and only here. If the table is missing (migration
 * 011 not yet applied) or unreadable, the answer is "unmetered" rather than an
 * error, because failing closed would refuse every watch add - taking a working
 * feature offline over a billing lookup. The cost of this choice is that we
 * might not charge for a while, which is a revenue problem, not a security one.
 * The VERIFICATION path below never fails open.
 */
function alert_pricing(PDO $db, string $chainKey): ?array
{
    if ($chainKey === '') {
        return null;
    }
    try {
        $stmt = $db->prepare('SELECT * FROM chain_alert_pricing WHERE chain_key = ?');
        $stmt->execute([$chainKey]);
        $row = $stmt->fetch();
    } catch (Throwable $e) {
        error_log('alert_pricing: unavailable, treating chain as unmetered: ' . $e->getMessage());
        return null;
    }
    if (!$row) {
        return null;
    }

    // Normalised and bounded on READ, for the same reason watch_limit() is:
    // this table is editable by anyone with database access, and a junk value
    // must not be able to remove a cap or invent a price.
    $cadence = in_array($row['cadence'], WATCH_CADENCES, true) ? $row['cadence'] : 'one_time';
    $freeCap = (int) $row['free_cap'];
    if ($freeCap < 0 || $freeCap > FREE_CAP_MAX) {
        $freeCap = 0;
    }
    $graceDays = (int) $row['grace_days'];
    if ($graceDays < 0 || $graceDays > GRACE_DAYS_MAX) {
        $graceDays = 0;
    }
    // A fee that is not a clean base-unit integer is not a price we will quote.
    $fee = base_normalize((string) $row['fee_amount']);

    return [
        'chain_key' => $row['chain_key'],
        'alerts_enabled' => (int) $row['alerts_enabled'] === 1,
        'free_cap' => $freeCap,
        'fee_amount' => $fee ?? '0',
        'fee_denom' => (string) $row['fee_denom'],
        'collect_address' => (string) $row['collect_address'],
        'cadence' => $cadence,
        'grace_days' => $graceDays,
    ];
}

/**
 * Whether we can actually SELL a watch on this chain right now.
 *
 * Every one of these must hold, and if any fails the paid tier is UNAVAILABLE -
 * never silently free, and never for sale. Taking money to an address nobody
 * controls is the single worst outcome available here, so this fails closed.
 */
function pricing_sellable(array $pricing, array $chain): bool
{
    if (!$pricing['alerts_enabled']) {
        return false;
    }
    // A zero or malformed fee is not a price.
    if (!base_is_positive($pricing['fee_amount'])) {
        return false;
    }
    // The denom must be the chain's own. Anything else could not be paid.
    if ($pricing['fee_denom'] === '' || $pricing['fee_denom'] !== ($chain['denom'] ?? '')) {
        return false;
    }
    // Full bech32 validation, not a prefix guess: a typo'd collection address
    // that happens to start correctly would send fees into the void.
    if (!is_account_address($pricing['collect_address'], (string) ($chain['bech32Prefix'] ?? ''))) {
        return false;
    }
    return true;
}

/**
 * How many of this user's watches on this chain occupy a FREE slot.
 *
 * Paid watches are excluded on purpose: the allowance is "n free, plus whatever
 * you have paid for". Counting a paid watch against the free cap would mean
 * buying one silently consumed a free slot the user still had.
 *
 * Anything not explicitly paid counts, which is also what grandfathers watches
 * created before a cap existed: they occupy the free slots they already have,
 * keep working, and simply leave nothing spare. Introducing a cap therefore
 * needs no backfill pass and disables nothing.
 */
function free_slots_used(PDO $db, int $userId, string $chainKey): int
{
    $stmt = $db->prepare(
        "SELECT COUNT(*) FROM watched_addresses
         WHERE user_id = ? AND chain_key = ? AND tier <> 'paid'"
    );
    $stmt->execute([$userId, $chainKey]);
    return (int) $stmt->fetchColumn();
}

/**
 * Whether this account is exempt from alert charges.
 *
 * Super admins are. They operate the deployment and own the collection address,
 * so "charging" one means asking it to pay itself - the money would go from an
 * operator's wallet to the operator's own address, and the ledger would record
 * a sale that was never a sale.
 *
 * Deliberately SUPER admins only, not every admin. A delegated admin with, say,
 * chains:WRITE is an ordinary user of the alert feature and is metered like
 * anyone else; exemption follows owning the deployment, not holding a grant.
 */
function watch_charges_exempt(PDO $db, int $userId): bool
{
    $stmt = $db->prepare('SELECT is_super_admin FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    return (int) $stmt->fetchColumn() === 1;
}

/**
 * What the next watch on this chain would cost this user.
 *
 * `next_is_free` is the question the add path actually asks. `sellable` says
 * whether, when it is not free, we are in a position to take payment at all -
 * the two are separate because "you are over your free allowance" and "and we
 * cannot sell you another one" are different messages for the user.
 *
 * `exempt` is reported alongside rather than folded into `next_is_free` so the
 * caller can say WHY it is free. "You have 3 of 5 free left" and "you are not
 * charged for these" are different statements, and showing the first to an
 * exempt account would be a lie that starts counting down towards a wall it
 * will never hit.
 */
function watch_quote(PDO $db, int $userId, string $chainKey, array $chain): array
{
    $pricing = alert_pricing($db, $chainKey);

    if (watch_charges_exempt($db, $userId)) {
        // The chain's real configuration is still reported, so the admin screens
        // show what everyone else is subject to - only the charge is waived.
        return [
            'metered' => $pricing !== null,
            'alerts_enabled' => $pricing === null ? true : $pricing['alerts_enabled'],
            'free_cap' => $pricing['free_cap'] ?? 0,
            'free_used' => free_slots_used($db, $userId, $chainKey),
            'next_is_free' => true,
            'exempt' => true,
            'sellable' => false, // nothing to sell to an account that owes nothing
            'fee_amount' => $pricing['fee_amount'] ?? '0',
            'fee_denom' => $pricing['fee_denom'] ?? '',
            'collect_address' => $pricing['collect_address'] ?? '',
            'cadence' => $pricing['cadence'] ?? 'one_time',
            'grace_days' => $pricing['grace_days'] ?? 0,
        ];
    }

    if ($pricing === null) {
        // Unmetered: today's behaviour, and the shipped default.
        return [
            'metered' => false,
            'alerts_enabled' => true,
            'free_cap' => 0,
            'free_used' => 0,
            'next_is_free' => true,
            'exempt' => false,
            'sellable' => false,
            'fee_amount' => '0',
            'fee_denom' => '',
            'collect_address' => '',
            'cadence' => 'one_time',
            'grace_days' => 0,
        ];
    }

    $used = free_slots_used($db, $userId, $chainKey);

    return [
        'metered' => true,
        'alerts_enabled' => $pricing['alerts_enabled'],
        'free_cap' => $pricing['free_cap'],
        'free_used' => $used,
        'next_is_free' => $used < $pricing['free_cap'],
        'exempt' => false,
        'sellable' => pricing_sellable($pricing, $chain),
        'fee_amount' => $pricing['fee_amount'],
        'fee_denom' => $pricing['fee_denom'],
        'collect_address' => $pricing['collect_address'],
        'cadence' => $pricing['cadence'],
        'grace_days' => $pricing['grace_days'],
    ];
}

/**
 * A memo code the payer puts in their transaction.
 *
 * This is what binds a payment to one account. Transaction hashes are PUBLIC -
 * without a binding, anyone watching the chain could see another user's fee
 * payment and submit that hash first, and the unique key on watch_payments
 * would hand them someone else's money.
 *
 * Short enough to retype from a phone, random enough not to be guessed:
 * 10 characters from a 32-symbol alphabet is ~50 bits, and a wrong guess has to
 * hit a live, unconsumed intent belonging to someone else within its 2-hour
 * window. Ambiguous glyphs (0/O, 1/I/L) are excluded so a transcription error
 * is a rejected code rather than a wrong one.
 */
function issue_memo_code(): string
{
    $alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    $out = '';
    $max = strlen($alphabet) - 1;
    for ($i = 0; $i < 10; $i++) {
        $out .= $alphabet[random_int(0, $max)];
    }
    return 'BH-' . $out;
}

/** SQL interval for a recurring cadence, or null for one_time (never expires). */
function cadence_interval_sql(string $cadence): ?string
{
    switch ($cadence) {
        case 'weekly':
            return 'INTERVAL 7 DAY';
        case 'monthly':
            return 'INTERVAL 1 MONTH';
        default:
            return null;
    }
}

/**
 * The addresses this user has PROVEN they control.
 *
 * Used as the fallback binding when a payment carries no memo code: someone who
 * paid from their own linked wallet and forgot the memo has still demonstrably
 * paid, and refusing a real payment over a missing note would mean manual
 * intervention on every occurrence.
 *
 * Only VERIFIED addresses count. An unverified main_address is an unproven
 * claim - accepting one would let an attacker name a victim's address and then
 * claim payments sent from it.
 */
function verified_addresses(PDO $db, int $userId): array
{
    $stmt = $db->prepare(
        'SELECT main_address FROM users
         WHERE id = ? AND main_address IS NOT NULL AND main_address_verified = 1'
    );
    $stmt->execute([$userId]);
    $out = [];
    foreach ($stmt->fetchAll() as $r) {
        if (!empty($r['main_address'])) {
            $out[] = (string) $r['main_address'];
        }
    }
    return $out;
}

/**
 * Public shape of a watch's billing state, for the app and the admin screens.
 * Kept in one place so the user-facing list and the admin view cannot drift.
 */
function watch_billing_state(array $row): array
{
    $tier = ($row['tier'] ?? 'free') === 'paid' ? 'paid' : 'free';
    return [
        'tier' => $tier,
        'paid_until' => $row['paid_until'] ?? null,
        'payment_state' => ($row['payment_state'] ?? 'active') === 'lapsed' ? 'lapsed' : 'active',
    ];
}
