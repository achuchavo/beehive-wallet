<?php
require __DIR__ . '/common.php';
require_post();

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
// SSRF guard: node endpoints must be public HTTPS URLs. This rejects http://,
// private/loopback/link-local hosts and the cloud metadata address, and resolves
// the hostname so a domain pointing at an internal IP is refused. (A deliberate
// local dev node must be added by direct DB insert.)
if (strlen($url) > 200 || !is_safe_public_url($url)) {
    json_error('Endpoint must be a public HTTPS URL (no private, loopback or link-local hosts)');
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
