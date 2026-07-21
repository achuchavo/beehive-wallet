<?php
// Cached fiat price proxy (CoinGecko). Server-side + 5-min cache so we stay
// well under rate limits and avoid browser CORS issues.
//   price.php?id=medibloc&currency=krw
require __DIR__ . '/common.php';

$id = preg_replace('/[^a-z0-9-]/', '', strtolower($_GET['id'] ?? ''));
$currency = preg_replace('/[^a-z]/', '', strtolower($_GET['currency'] ?? 'krw'));
if ($id === '') {
    json_error('Missing coin id');
}

$currencies = 'krw,usd,eur,jpy,gbp';
$cacheDir = __DIR__ . '/cache';
if (!is_dir($cacheDir)) {
    @mkdir($cacheDir, 0775, true);
}
$cacheFile = "$cacheDir/price_$id.json";
$data = null;

if (is_file($cacheFile) && time() - filemtime($cacheFile) < 300) {
    $data = json_decode((string) file_get_contents($cacheFile), true);
}

if ($data === null) {
    $url = "https://api.coingecko.com/api/v3/simple/price?ids=$id&vs_currencies=$currencies";
    $ctx = stream_context_create([
        'http' => [
            'timeout' => 15,
            'ignore_errors' => true,
            'header' => "User-Agent: BeehiveWallet/1.0\r\nAccept: application/json\r\n",
        ],
    ]);
    $body = @file_get_contents($url, false, $ctx);
    if ($body !== false && json_decode($body, true) !== null) {
        file_put_contents($cacheFile, $body);
        $data = json_decode($body, true);
    } elseif (is_file($cacheFile)) {
        $data = json_decode((string) file_get_contents($cacheFile), true); // stale fallback
    }
}

$price = $data[$id][$currency] ?? null;
json_out(['ok' => true, 'id' => $id, 'currency' => $currency, 'price' => $price]);
