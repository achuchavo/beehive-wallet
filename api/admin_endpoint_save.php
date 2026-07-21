<?php
require __DIR__ . '/common.php';

$db = get_db();
require_permission($db, 'chains');

$b = read_body();
$id = (int) ($b['id'] ?? 0);
$chainKey = trim($b['chain_key'] ?? '');
$kind = trim($b['kind'] ?? '');
$url = trim($b['url'] ?? '');
$priority = (int) ($b['priority'] ?? 0);
$isActive = !empty($b['is_active']) ? 1 : 0;

if (!in_array($kind, ['lcd', 'rpc'], true)) {
    json_error('Kind must be lcd or rpc');
}
if (!preg_match('#^https?://#', $url) || strlen($url) > 200) {
    json_error('Enter a valid http(s) URL');
}
$url = rtrim($url, '/');

if ($id > 0) {
    $db->prepare('UPDATE chain_endpoints SET kind = ?, url = ?, priority = ?, is_active = ? WHERE id = ?')
        ->execute([$kind, $url, $priority, $isActive, $id]);
} else {
    $stmt = $db->prepare('SELECT chain_key FROM chains WHERE chain_key = ?');
    $stmt->execute([$chainKey]);
    if (!$stmt->fetch()) {
        json_error('Unknown chain');
    }
    $db->prepare('INSERT INTO chain_endpoints (chain_key, kind, url, priority, is_active) VALUES (?, ?, ?, ?, ?)')
        ->execute([$chainKey, $kind, $url, $priority, $isActive]);
}

json_out(['ok' => true]);
