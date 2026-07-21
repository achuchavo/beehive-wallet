<?php
// LCD relay with endpoint failover. Path form:
//   lcd_proxy.php/<chainKey>/cosmos/...  (+ optional query string)
// Reads the chain's active LCD endpoints from the DB and tries each in
// priority order until one answers, so a dead endpoint fails over to the next.

declare(strict_types=1);
require __DIR__ . '/common.php';

header('Content-Type: application/json; charset=utf-8');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    json_out(['error' => 'GET only'], 405);
}

$pathInfo = $_SERVER['PATH_INFO'] ?? '';
// /<chainKey>/cosmos/...
if (!preg_match('#^/([a-z0-9_-]+)(/cosmos/.*)$#', $pathInfo, $m)) {
    json_out(['error' => 'Path must be /<chain>/cosmos/...'], 400);
}
$chainKey = $m[1];
$lcdPath = $m[2];

$db = get_db();
$stmt = $db->prepare(
    "SELECT url FROM chain_endpoints
     WHERE chain_key = ? AND kind = 'lcd' AND is_active = 1
     ORDER BY priority, id"
);
$stmt->execute([$chainKey]);
$endpoints = array_column($stmt->fetchAll(), 'url');

if (!$endpoints) {
    json_out(['error' => 'No LCD endpoint for chain'], 502);
}

$query = $_SERVER['QUERY_STRING'] ?? '';
$suffix = $lcdPath . ($query !== '' ? '?' . $query : '');

foreach ($endpoints as $base) {
    $ctx = stream_context_create(['http' => ['method' => 'GET', 'timeout' => 90, 'ignore_errors' => true]]);
    $body = @file_get_contents(rtrim($base, '/') . $suffix, false, $ctx);
    if ($body === false) {
        continue; // endpoint unreachable - try the next
    }
    $status = 502;
    if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $mm)) {
        $status = (int) $mm[1];
    }
    // 5xx from an endpoint means try the next; otherwise return this response.
    if ($status >= 500) {
        continue;
    }
    http_response_code($status);
    echo $body;
    exit;
}

json_out(['error' => 'All LCD endpoints failed'], 502);
