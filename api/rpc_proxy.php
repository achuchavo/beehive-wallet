<?php
// JSON-RPC relay to the chain's Tendermint RPC for the browser (CosmJS),
// since the public RPC sends no CORS headers. POST-only, method-whitelisted -
// this is NOT an open proxy. Unnecessary once our own node is behind nginx.

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'POST only']);
    exit;
}

$raw = file_get_contents('php://input');
$req = json_decode($raw === false ? '' : $raw, true);

$allowedMethods = [
    'status', 'abci_info', 'abci_query', 'health',
    'broadcast_tx_sync', 'broadcast_tx_async',
    'tx', 'tx_search', 'block', 'block_results', 'header', 'commit',
    'validators', 'num_unconfirmed_txs',
];

if (!is_array($req) || !in_array($req['method'] ?? '', $allowedMethods, true)) {
    http_response_code(400);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$chains = json_decode(file_get_contents(__DIR__ . '/chains.json'), true);
$rpc = $chains[0]['rpc'];

$ctx = stream_context_create([
    'http' => [
        'method' => 'POST',
        'header' => "Content-Type: application/json\r\n",
        'content' => $raw,
        'timeout' => 60,
        'ignore_errors' => true,
    ],
]);
$body = @file_get_contents($rpc, false, $ctx);

if ($body === false) {
    http_response_code(502);
    echo json_encode(['error' => 'Chain RPC unreachable']);
    exit;
}

$status = 502;
if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) {
    $status = (int) $m[1];
}
http_response_code($status);
echo $body;
