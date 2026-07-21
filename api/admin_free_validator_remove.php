<?php
require __DIR__ . '/common.php';

$db = get_db();
require_permission($db, 'chains');

$b = read_body();
$id = (int) ($b['id'] ?? 0);
$db->prepare('DELETE FROM chain_free_validators WHERE id = ?')->execute([$id]);

json_out(['ok' => true]);
