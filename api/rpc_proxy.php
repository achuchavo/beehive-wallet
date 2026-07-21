<?php
// Tendermint JSON-RPC relay with endpoint failover, for CosmJS in the browser.
//   rpc_proxy.php?chain=<chainKey>   (POST JSON-RPC body)
// Tries the chain's active RPC endpoints in priority order.

declare(strict_types=1);
require __DIR__ . '/common.php';

header('Content-Type: application/json; charset=utf-8');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    json_out(['error' => 'POST only'], 405);
}

proxy_rate_limit(client_ip());

$chainKey = preg_replace('/[^a-z0-9_-]/', '', $_GET['chain'] ?? '');
if ($chainKey === '') {
    json_out(['error' => 'Missing chain'], 400);
}

$raw = file_get_contents('php://input');
if ($raw !== false && strlen($raw) > 262144) { // 256 KB
    json_out(['error' => 'Request body too large'], 413);
}
$req = json_decode($raw === false ? '' : $raw, true);

$allowedMethods = [
    'status', 'abci_info', 'abci_query', 'health',
    'broadcast_tx_sync', 'broadcast_tx_async',
    'tx', 'tx_search', 'block', 'block_results', 'header', 'commit',
    'validators', 'num_unconfirmed_txs',
];
if (!is_array($req) || !in_array($req['method'] ?? '', $allowedMethods, true)) {
    json_out(['error' => 'Method not allowed'], 400);
}

$db = get_db();
$stmt = $db->prepare(
    "SELECT url FROM chain_endpoints
     WHERE chain_key = ? AND kind = 'rpc' AND is_active = 1
     ORDER BY priority, id"
);
$stmt->execute([$chainKey]);
$endpoints = array_column($stmt->fetchAll(), 'url');

if (!$endpoints) {
    json_out(['error' => 'No RPC endpoint for chain'], 502);
}

foreach ($endpoints as $base) {
    if (!proxy_url_ok($base)) {
        continue; // never fetch a non-HTTPS or private-IP endpoint (SSRF guard)
    }
    $ctx = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/json\r\n",
            'content' => $raw,
            'timeout' => 20,
            'ignore_errors' => true,
        ],
    ]);
    // Cap the response we read into memory (4 MB) against a hostile/huge upstream.
    $body = @file_get_contents(rtrim($base, '/'), false, $ctx, 0, 4 * 1024 * 1024);
    if ($body === false) {
        continue;
    }
    $status = 502;
    if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $mm)) {
        $status = (int) $mm[1];
    }
    if ($status >= 500) {
        continue;
    }
    http_response_code($status);
    echo $body;
    exit;
}

json_out(['error' => 'All RPC endpoints failed'], 502);
