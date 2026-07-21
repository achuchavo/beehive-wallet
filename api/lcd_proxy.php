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

proxy_rate_limit(client_ip());

$pathInfo = $_SERVER['PATH_INFO'] ?? '';
// /<chainKey>/cosmos/... - path allowlist: only the read-only cosmos REST tree.
if (!preg_match('#^/([a-z0-9_-]+)(/cosmos/[A-Za-z0-9_./-]*)$#', $pathInfo, $m)) {
    json_out(['error' => 'Path must be /<chain>/cosmos/...'], 400);
}
$chainKey = $m[1];
$lcdPath = $m[2];

if (strlen($_SERVER['QUERY_STRING'] ?? '') > 4096) {
    json_out(['error' => 'Query string too long'], 414);
}

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
    if (!proxy_url_ok($base)) {
        continue; // never fetch a non-HTTPS or private-IP endpoint (SSRF guard)
    }
    $ctx = stream_context_create(['http' => ['method' => 'GET', 'timeout' => 30, 'ignore_errors' => true]]);
    // Cap the response we read into memory (8 MB) against a hostile/huge upstream.
    $body = @file_get_contents(rtrim($base, '/') . $suffix, false, $ctx, 0, 8 * 1024 * 1024);
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
