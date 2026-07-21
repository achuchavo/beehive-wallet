<?php
// GET-only relay to the chain LCD, because public LCD endpoints send no CORS
// headers so browsers block direct calls. Whitelisted to /cosmos/ paths -
// this is NOT an open proxy. Becomes unnecessary once our own node (with
// CORS configured in nginx) replaces the public endpoint.

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    http_response_code(405);
    echo json_encode(['error' => 'GET only']);
    exit;
}

$path = $_SERVER['PATH_INFO'] ?? '';
if (strpos($path, '/cosmos/') !== 0 || strpos($path, '..') !== false) {
    http_response_code(400);
    echo json_encode(['error' => 'Path not allowed']);
    exit;
}

$chains = json_decode(file_get_contents(__DIR__ . '/chains.json'), true);
$chain = $chains[0];

$url = $chain['lcd'] . $path;
if (!empty($_SERVER['QUERY_STRING'])) {
    $url .= '?' . $_SERVER['QUERY_STRING'];
}

// PHP streams instead of curl - the curl extension is not enabled on this server.
$ctx = stream_context_create([
    'http' => ['method' => 'GET', 'timeout' => 90, 'ignore_errors' => true],
]);
$body = @file_get_contents($url, false, $ctx);

if ($body === false) {
    http_response_code(502);
    echo json_encode(['error' => 'Chain API unreachable']);
    exit;
}

$status = 502;
if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) {
    $status = (int) $m[1];
}
http_response_code($status);
echo $body;
