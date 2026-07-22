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

// Bounded read: stop at the limit + 1 byte rather than pulling an arbitrarily
// large body into memory and measuring it afterwards.
const RPC_MAX_REQUEST = 262144; // 256 KB
$in = fopen('php://input', 'rb');
$raw = $in === false ? '' : (string) stream_get_contents($in, RPC_MAX_REQUEST + 1);
if ($in !== false) {
    fclose($in);
}
if (strlen($raw) > RPC_MAX_REQUEST) {
    json_out(['error' => 'Request body too large'], 413);
}
$req = json_decode($raw, true);

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

$sawTooLarge = false;

foreach ($endpoints as $base) {
    // proxy_fetch re-resolves DNS and rejects private/redirecting targets on
    // every call, so a hostname that later points inside the network is caught.
    $res = proxy_fetch(rtrim($base, '/'), [
        'timeout' => 20,
        'max_bytes' => 4 * 1024 * 1024,
        'post' => $raw,
    ]);

    if ($res['too_large']) {
        // Never emit a truncated body as a successful upstream response.
        $sawTooLarge = true;
        continue;
    }
    if ($res['error'] !== '' || $res['status'] === 0) {
        continue;
    }
    if ($res['status'] >= 500) {
        continue;
    }
    http_response_code($res['status']);
    echo $res['body'];
    exit;
}

if ($sawTooLarge) {
    json_out(['error' => 'Upstream response too large'], 502);
}
json_out(['error' => 'All RPC endpoints failed'], 502);
