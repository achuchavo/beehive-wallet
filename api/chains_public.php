<?php
// Public chain registry for the frontend and watcher: active chains with their
// active endpoints in priority order. No auth - this is public config.
require __DIR__ . '/common.php';

$db = get_db();

$chains = $db->query('SELECT * FROM chains WHERE is_active = 1 ORDER BY sort_order, chain_name')->fetchAll();

$epStmt = $db->prepare(
    'SELECT kind, url FROM chain_endpoints
     WHERE chain_key = ? AND is_active = 1
     ORDER BY priority, id'
);

$out = [];
foreach ($chains as $c) {
    $epStmt->execute([$c['chain_key']]);
    $lcd = [];
    $rpc = [];
    foreach ($epStmt->fetchAll() as $ep) {
        if ($ep['kind'] === 'lcd') $lcd[] = $ep['url'];
        elseif ($ep['kind'] === 'rpc') $rpc[] = $ep['url'];
    }
    $out[] = [
        'key' => $c['chain_key'],
        'chainId' => $c['chain_id'],
        'chainName' => $c['chain_name'],
        'bech32Prefix' => $c['bech32_prefix'],
        'denom' => $c['denom'],
        'displayDenom' => $c['display_denom'],
        'decimals' => (int) $c['decimals'],
        'coinType' => (int) $c['coin_type'],
        'gasPrice' => $c['gas_price'],
        'explorerTxUrl' => $c['explorer_tx_url'],
        'explorerValidatorUrl' => $c['explorer_validator_url'],
        'beehiveValidator' => $c['beehive_validator'],
        'beehiveMoniker' => $c['beehive_moniker'],
        'serviceFee' => $c['service_fee'],
        'feeCollector' => $c['fee_collector'],
        'lcdEndpoints' => $lcd,
        'rpcEndpoints' => $rpc,
    ];
}

json_out(['ok' => true, 'chains' => $out]);
