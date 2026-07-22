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

$sawTooLarge = false;

foreach ($endpoints as $base) {
    // proxy_fetch re-resolves DNS, pins the connection to the validated
    // addresses and refuses redirects, so each hop cannot escape the guard.
    $res = proxy_fetch(rtrim($base, '/') . $suffix, [
        'timeout' => 30,
        'max_bytes' => 8 * 1024 * 1024,
    ]);

    if ($res['too_large']) {
        // A truncated body is not a valid response - never pass it off as one.
        $sawTooLarge = true;
        continue;
    }
    if ($res['error'] !== '' || $res['status'] === 0) {
        continue; // endpoint unreachable - try the next
    }
    // 5xx from an endpoint means try the next; otherwise return this response.
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
json_out(['error' => 'All LCD endpoints failed'], 502);
