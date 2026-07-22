<?php
// Link (or clear) the account's main wallet address.
//
// Linking now REQUIRES an ADR-036 signature over a server-issued, single-use
// challenge (audit #19). This matters because main_address doubles as a login
// identifier in login.php and is UNIQUE, so an unproven claim would let an
// attacker squat a victim's address and turn it into their own sign-in handle.

require __DIR__ . '/common.php';
require_post();

$db = get_db();
$userId = require_user($db);
$body = read_body();

$mainAddress = trim($body['main_address'] ?? '');

// --- Clearing the address needs no proof -------------------------------------
if ($mainAddress === '') {
    $db->prepare('UPDATE users SET main_address = NULL WHERE id = ?')->execute([$userId]);
    json_out(['ok' => true, 'main_address' => null]);
}

$nonce = trim($body['nonce'] ?? '');
$pubkey = trim($body['pubkey'] ?? '');
$signature = trim($body['signature'] ?? '');

if ($nonce === '' || $pubkey === '' || $signature === '') {
    json_error('Address ownership proof is required', 400);
}
if (!preg_match('/^[0-9a-f]{64}$/', $nonce)) {
    json_error('Invalid challenge', 400);
}

$db->beginTransaction();
try {
    // Lock the challenge row so a nonce cannot be redeemed twice concurrently.
    // Expiry is evaluated by MySQL, not PHP: the two run in different timezones
    // on this host, so comparing a stored DATETIME with PHP's time() would be
    // off by hours and could either expire everything instantly or never at all.
    $stmt = $db->prepare(
        'SELECT id, address, chain_key, domain, action, expires_at, used_at,
                (expires_at > NOW()) AS still_valid
         FROM address_challenges
         WHERE nonce = ? AND user_id = ?
         FOR UPDATE'
    );
    $stmt->execute([$nonce, $userId]);
    $chal = $stmt->fetch();

    // One generic error for every challenge problem - do not tell a caller
    // which of "unknown / expired / already used / wrong user" applied.
    if (!$chal || $chal['used_at'] !== null || (int) $chal['still_valid'] !== 1) {
        $db->rollBack();
        json_error('That verification expired or was already used. Please try again.', 400);
    }
    if (!hash_equals((string) $chal['address'], $mainAddress)) {
        $db->rollBack();
        json_error('That verification was issued for a different address.', 400);
    }

    $chain = chain_config((string) $chal['chain_key']);
    if ($chain === null) {
        $db->rollBack();
        json_error('Unknown chain', 400);
    }

    // Burn the nonce BEFORE verifying, so a failed attempt cannot be retried
    // against the same challenge.
    $db->prepare('UPDATE address_challenges SET used_at = NOW() WHERE id = ?')->execute([$chal['id']]);

    // Rebuild the signed text from OUR stored row, never from the request.
    // The expiry is used verbatim as stored, so it matches the string that was
    // signed at issue time byte-for-byte with no timezone conversion.
    $message = address_challenge_message(
        $userId,
        (string) $chal['address'],
        $nonce,
        (string) $chal['domain'],
        (string) $chal['expires_at']
    );

    $reason = verify_address_ownership(
        $message,
        $mainAddress,
        (string) $chain['bech32Prefix'],
        $pubkey,
        $signature
    );
    if ($reason !== '') {
        $db->commit(); // keep the nonce burned
        error_log("account_set_address: ownership proof failed ({$reason}) for user {$userId}");
        json_error('Could not verify that you control this address.', 400);
    }

    // Re-check uniqueness inside the transaction: another account may have
    // claimed this address between challenge issuance and redemption.
    $stmt = $db->prepare('SELECT id FROM users WHERE main_address = ? AND id <> ? FOR UPDATE');
    $stmt->execute([$mainAddress, $userId]);
    if ($stmt->fetch()) {
        $db->commit();
        json_error('That address is already linked to another account', 409);
    }

    $db->prepare('UPDATE users SET main_address = ? WHERE id = ?')->execute([$mainAddress, $userId]);
    $db->commit();
} catch (Throwable $e) {
    if ($db->inTransaction()) {
        $db->rollBack();
    }
    error_log('account_set_address failed: ' . $e->getMessage());
    json_error('Could not update the address', 500);
}

json_out(['ok' => true, 'main_address' => $mainAddress, 'verified' => true]);
