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

$query = $_SERVER['QUERY_STRING'] ?? '';
$suffix = $lcdPath . ($query !== '' ? '?' . $query : '');

// The failover loop itself lives in common.php (lcd_fetch), shared with the
// server-side payment verification so both get the same SSRF revalidation,
// redirect refusal and bounded read.
$res = lcd_fetch($db, $chainKey, $suffix);

switch ($res['error']) {
    case '':
        http_response_code($res['status']);
        echo $res['body'];
        exit;
    case 'no_endpoint':
        json_out(['error' => 'No LCD endpoint for chain'], 502);
        // no break - json_out exits
    case 'too_large':
        json_out(['error' => 'Upstream response too large'], 502);
        // no break - json_out exits
    default:
        json_out(['error' => 'All LCD endpoints failed'], 502);
}
