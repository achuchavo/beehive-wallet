<?php
// Full chain list (including inactive) plus all endpoints, for the admin UI.
require __DIR__ . '/common.php';

$db = get_db();
// Read-only listing: an admin granted chains at READ can inspect the registry
// without being able to change it. Every mutating chain endpoint still
// requires PERM_WRITE (the default).
require_permission($db, 'chains', PERM_READ);

$chains = $db->query('SELECT * FROM chains ORDER BY sort_order, chain_name')->fetchAll();
$endpoints = $db->query('SELECT * FROM chain_endpoints ORDER BY chain_key, kind, priority, id')->fetchAll();
$freeValidators = $db->query('SELECT id, chain_key, valoper FROM chain_free_validators ORDER BY chain_key, id')->fetchAll();

json_out([
    'ok' => true,
    'chains' => $chains,
    'endpoints' => $endpoints,
    'free_validators' => $freeValidators,
]);
