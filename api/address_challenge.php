<?php
// Issue a single-use, short-lived challenge that the caller must sign with the
// wallet key for the address they want to link (audit #19).
//
// The signed text is rebuilt server-side at redemption from the stored row, so
// the client cannot influence what a signature actually authorises.

require __DIR__ . '/common.php';
require_post();

$db = get_db();
$userId = require_user($db);

$body = read_body();
$address = trim($body['address'] ?? '');
$chainKey = preg_replace('/[^a-z0-9_-]/', '', (string) ($body['chain_key'] ?? ''));

$chain = chain_config($chainKey);
if ($chain === null) {
    json_error('Unknown chain');
}
if (!is_account_address($address, $chain['bech32Prefix'])) {
    json_error("Enter a valid {$chain['chainName']} address");
}

// Refuse early only if a VERIFIED owner already holds this address. An
// unverified holder (a squatter, or a row linked before proofs existed) does
// not block someone who can actually sign for it - redemption reassigns it.
// The same check runs again inside the redemption transaction.
$stmt = $db->prepare(
    'SELECT id FROM users WHERE main_address = ? AND main_address_verified = 1 AND id <> ?'
);
$stmt->execute([$address, $userId]);
if ($stmt->fetch()) {
    json_error('That address is already linked to another account', 409);
}

// Rate-limit challenge issuance so this cannot be used to hammer the table.
if (count_recent_failures($db, 'ip', client_ip(), 'address_challenge') >= 20) {
    rate_limited();
}
record_attempt($db, client_ip(), (string) $userId, 'address_challenge', false);

// Opportunistically drop expired/spent rows.
if (random_int(1, 20) === 1) {
    $db->exec('DELETE FROM address_challenges WHERE expires_at < NOW() - INTERVAL 1 DAY');
}

$nonce = bin2hex(random_bytes(32));
$domain = preg_replace('/:\d+$/', '', (string) ($_SERVER['HTTP_HOST'] ?? ''));

// IMPORTANT: the expiry is written and compared using MySQL's clock only.
// PHP and MySQL run in different timezones on this host (Europe/Berlin vs the
// system zone, ~7h apart), so any strtotime()/time() comparison of a stored
// DATETIME is wrong in one direction or the other. Keeping a single clock -
// and echoing the stored string verbatim into the signed message - removes the
// conversion entirely.
$stmt = $db->prepare(
    'INSERT INTO address_challenges
        (user_id, address, chain_key, nonce, action, domain, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW() + INTERVAL ' . ADDRESS_CHALLENGE_TTL . ' SECOND, NOW())'
);
$stmt->execute([$userId, $address, $chainKey, $nonce, ADDRESS_CHALLENGE_ACTION, $domain]);

// Read the stored expiry back so the message is built from exactly the value
// the verifier will read later.
$stmt = $db->prepare('SELECT expires_at FROM address_challenges WHERE nonce = ?');
$stmt->execute([$nonce]);
$expiresAt = (string) $stmt->fetchColumn();

json_out([
    'ok' => true,
    'nonce' => $nonce,
    'expires_at' => $expiresAt,
    // Returned for display/convenience only - the server rebuilds this exact
    // string from the stored row when verifying, and never trusts the client's.
    'message' => address_challenge_message($userId, $address, $nonce, $domain, $expiresAt),
]);
