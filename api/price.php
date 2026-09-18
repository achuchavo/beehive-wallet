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

// Operational markers for the admin overview. A proxy that serves null is a
// working process degrading silently - the app just stops drawing fiat values
// (exactly the missing-KRW report of 2026-09-18) - so nulls must be visible
// somewhere an admin looks. Only ids configured on a chain count: a stray
// curl with a junk id is not a product failure and must not paint the row.
// The marker write must never break the price response itself.
try {
    $db = get_db();
    $known = $db->prepare('SELECT COUNT(*) FROM chains WHERE coingecko_id = ?');
    $known->execute([$id]);
    if ((int) $known->fetchColumn() > 0) {
        $key = $price === null ? 'price_last_null' : 'price_last_ok';
        $stmt = $db->prepare(
            'INSERT INTO app_settings (setting_key, setting_value, updated_at)
             VALUES (?, NOW(), NOW())
             ON DUPLICATE KEY UPDATE setting_value = NOW(), updated_at = NOW()'
        );
        $stmt->execute([$key]);
    }
} catch (Throwable $e) {
    // Price first; the marker is best-effort.
}

json_out(['ok' => true, 'id' => $id, 'currency' => $currency, 'price' => $price]);
