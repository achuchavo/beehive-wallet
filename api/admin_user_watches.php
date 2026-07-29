<?php
// Which addresses each user monitors, per chain, and how each one is paid for.
//
// This is USER PII and BILLING data together - the addresses people watch, the
// names they gave them, and what they have paid. It is gated on its own
// feature, separate from 'wallet_alerts', for the reason set out beside
// ADMIN_FEATURES: an operator who needs alert-volume statistics does not
// thereby need a named person's payment history.
//
// Read-only. There is no admin path that edits a user's watches: switching off
// something a user set up to watch their own money is not an administrative
// action, and giving it a button would invite it.
require __DIR__ . '/common.php';
require_once __DIR__ . '/watch_billing.php';

$db = get_db();
require_permission($db, 'user_watches', PERM_READ);

$search = trim($_GET['q'] ?? '');
$chainFilter = trim($_GET['chain_key'] ?? '');
$tierFilter = trim($_GET['tier'] ?? '');

// Paged by ACCOUNT, not by watch.
//
// The screen groups addresses under the person watching them, so paging by row
// would split an account across a page boundary - you would expand someone and
// see four of their six addresses, with no indication the other two exist. The
// page size is therefore a number of accounts, and every matching watch for
// those accounts is returned with them.
//
// Still bounded: a user cannot hold more than app_settings.watch_limit
// addresses (default 20, hard maximum 500), so accounts-per-page times that cap
// is the worst case rather than "every row in the deployment".
$perPage = 25;
$page = max(1, (int) ($_GET['page'] ?? 1));
$offset = ($page - 1) * $perPage;

$where = [];
$params = [];

if ($search !== '') {
    // Email, address or label. The address and label are what an admin has to
    // hand when a user writes in about an alert.
    $where[] = '(u.email LIKE ? OR w.address LIKE ? OR w.label LIKE ?)';
    $like = '%' . $search . '%';
    $params[] = $like;
    $params[] = $like;
    $params[] = $like;
}
if ($chainFilter !== '') {
    $where[] = 'w.chain_key = ?';
    $params[] = $chainFilter;
}
if ($tierFilter === 'paid' || $tierFilter === 'free') {
    $where[] = $tierFilter === 'paid' ? "w.tier = 'paid'" : "w.tier <> 'paid'";
} elseif ($tierFilter === 'lapsed') {
    $where[] = "w.tier = 'paid' AND w.paid_until IS NOT NULL AND w.paid_until < NOW()";
}

$whereSql = $where ? 'WHERE ' . implode(' AND ', $where) : '';

/** Deployment-wide counts, independent of the current filter or page. */
function deployment_totals(PDO $db): array
{
    $row = $db->query(
        "SELECT COUNT(*) AS total,
                SUM(tier = 'paid') AS paid,
                SUM(tier <> 'paid') AS free,
                SUM(tier = 'paid' AND paid_until IS NOT NULL AND paid_until < NOW()) AS lapsed
         FROM watched_addresses"
    )->fetch();
    return [
        'total' => (int) $row['total'],
        'paid' => (int) $row['paid'],
        'free' => (int) $row['free'],
        'lapsed' => (int) $row['lapsed'],
    ];
}

// How many ACCOUNTS match, for the pager.
$countStmt = $db->prepare(
    "SELECT COUNT(DISTINCT w.user_id) FROM watched_addresses w JOIN users u ON u.id = w.user_id {$whereSql}"
);
$countStmt->execute($params);
$totalAccounts = (int) $countStmt->fetchColumn();

// The accounts on this page. Ordered by email so the list is stable between
// requests - an unordered LIMIT/OFFSET can repeat or skip rows as data changes.
$accountStmt = $db->prepare(
    "SELECT w.user_id, u.email, COUNT(*) AS watch_count
     FROM watched_addresses w
     JOIN users u ON u.id = w.user_id
     {$whereSql}
     GROUP BY w.user_id, u.email
     ORDER BY u.email
     LIMIT {$perPage} OFFSET {$offset}"
);
$accountStmt->execute($params);
$accountRows = $accountStmt->fetchAll();

$userIds = array_map(static fn(array $r): int => (int) $r['user_id'], $accountRows);
if (!$userIds) {
    json_out([
        'ok' => true,
        'accounts' => [],
        'page' => $page,
        'per_page' => $perPage,
        'total_accounts' => $totalAccounts,
        'totals' => deployment_totals($db),
    ]);
}
// Safe to interpolate: every element came through an (int) cast above, so this
// cannot carry anything but digits and commas.
$idList = implode(',', $userIds);
// Built separately rather than appended to $whereSql, which is empty when no
// filter is active - "{$whereSql} AND ..." would then emit a bare AND.
$scopedWhere = 'WHERE ' . implode(' AND ', array_merge($where, ["w.user_id IN ({$idList})"]));

// The newest payment per watch is what says whether it is still covered and
// when it was last paid for. Older rows are the renewal history and are
// summarised as a count rather than listed.
$stmt = $db->prepare(
    "SELECT w.id, w.user_id, u.email, w.chain_key, w.address, w.label,
            w.alarm_enabled, w.alarm_type, w.created_at,
            w.tier, w.paid_until, w.payment_state,
            (w.tier = 'paid' AND w.paid_until IS NOT NULL AND w.paid_until < NOW()) AS is_lapsed,
            (SELECT COUNT(*) FROM watch_payments p WHERE p.watched_address_id = w.id) AS payment_count,
            (SELECT p.tx_hash FROM watch_payments p
              WHERE p.watched_address_id = w.id ORDER BY p.verified_at DESC LIMIT 1) AS last_tx_hash,
            (SELECT p.amount FROM watch_payments p
              WHERE p.watched_address_id = w.id ORDER BY p.verified_at DESC LIMIT 1) AS last_amount,
            (SELECT p.denom FROM watch_payments p
              WHERE p.watched_address_id = w.id ORDER BY p.verified_at DESC LIMIT 1) AS last_denom,
            (SELECT p.cadence FROM watch_payments p
              WHERE p.watched_address_id = w.id ORDER BY p.verified_at DESC LIMIT 1) AS last_cadence,
            (SELECT p.verified_at FROM watch_payments p
              WHERE p.watched_address_id = w.id ORDER BY p.verified_at DESC LIMIT 1) AS last_paid_at
     FROM watched_addresses w
     JOIN users u ON u.id = w.user_id
     {$scopedWhere}
     ORDER BY u.email, w.chain_key, w.created_at"
);
$stmt->execute($params);

// Bucket the watches under the account that owns them.
$byUser = [];
foreach ($stmt->fetchAll() as $row) {
    $lapsed = (int) $row['is_lapsed'] === 1;
    unset($row['is_lapsed']);
    $row['tier'] = $row['tier'] === 'paid' ? 'paid' : 'free';
    // Same rule the user's own list and the watcher apply, so the three views
    // can never disagree about whether an alert is armed.
    $row['payment_state'] = $lapsed ? 'lapsed' : 'active';
    $row['payment_count'] = (int) $row['payment_count'];
    $byUser[(int) $row['user_id']][] = $row;
}

$accounts = [];
foreach ($accountRows as $acct) {
    $uid = (int) $acct['user_id'];
    $watches = $byUser[$uid] ?? [];
    // Per-account summary, so the collapsed row is worth reading on its own.
    $paid = 0;
    $lapsed = 0;
    foreach ($watches as $w) {
        if ($w['tier'] === 'paid') {
            $paid++;
        }
        if ($w['payment_state'] === 'lapsed') {
            $lapsed++;
        }
    }
    $accounts[] = [
        'user_id' => $uid,
        'email' => $acct['email'],
        'watches' => $watches,
        'counts' => [
            'total' => count($watches),
            'paid' => $paid,
            'free' => count($watches) - $paid,
            'lapsed' => $lapsed,
        ],
    ];
}

json_out([
    'ok' => true,
    'accounts' => $accounts,
    'page' => $page,
    'per_page' => $perPage,
    'total_accounts' => $totalAccounts,
    'totals' => deployment_totals($db),
]);
