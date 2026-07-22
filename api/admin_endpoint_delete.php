<?php
require __DIR__ . '/common.php';
require_post();

$db = get_db();
require_permission($db, 'chains');

$b = read_body();
$id = (int) ($b['id'] ?? 0);
$db->prepare('DELETE FROM chain_endpoints WHERE id = ?')->execute([$id]);

json_out(['ok' => true]);
