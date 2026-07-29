<?php
require __DIR__ . '/common.php';
require_once __DIR__ . '/watch_billing.php';
require_post();

$db = get_db();
// Moved from 'chains' to 'staking' (migration 013) - see the note in
// admin_free_validator_add.php.
require_permission($db, 'staking', PERM_WRITE);

$b = read_body();
$id = (int) ($b['id'] ?? 0);

// Removing the LAST allowed validator on a restricted chain would leave users
// with nothing they may delegate to, and the symptom - an empty validator list
// - looks like a loading failure rather than a policy. Refused, with the fix
// named: change the policy first, or add a replacement.
$stmt = $db->prepare(
    'SELECT v.chain_key, c.staking_policy,
            (SELECT COUNT(*) FROM chain_free_validators x WHERE x.chain_key = v.chain_key) AS n
     FROM chain_free_validators v
     JOIN chains c ON c.chain_key = v.chain_key
     WHERE v.id = ?'
);
$stmt->execute([$id]);
$row = $stmt->fetch();

if ($row && (int) $row['n'] <= 1 && in_array($row['staking_policy'], ['allowlist', 'allowlist_paid'], true)) {
    json_error(
        'This is the only allowed validator on a chain restricted to the list. '
        . 'Add another first, or switch the chain to allow all validators.',
        409
    );
}

$db->prepare('DELETE FROM chain_free_validators WHERE id = ?')->execute([$id]);

json_out(['ok' => true]);
