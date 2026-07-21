<?php
// Shared bootstrap for all wallet API endpoints.
// The server only ever stores PUBLIC data: emails, addresses, alarm settings.
// Private keys never reach this API in any form.

declare(strict_types=1);

session_start();
header('Content-Type: application/json; charset=utf-8');

ini_set('display_errors', '0');
error_reporting(E_ALL);

function json_out(array $data, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($data);
    exit;
}

function json_error(string $message, int $status = 400): void
{
    json_out(['ok' => false, 'error' => $message], $status);
}

function read_body(): array
{
    $raw = file_get_contents('php://input');
    $data = json_decode($raw === false ? '' : $raw, true);
    return is_array($data) ? $data : [];
}

function get_db(): PDO
{
    $cfg = require __DIR__ . '/db_config.php';
    $dsn = "mysql:host={$cfg['host']};port={$cfg['port']};dbname={$cfg['database']};charset=utf8mb4";
    $pdo = new PDO($dsn, $cfg['user'], $cfg['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    return $pdo;
}

function require_user(): int
{
    if (empty($_SESSION['user_id'])) {
        json_error('Not logged in', 401);
    }
    return (int) $_SESSION['user_id'];
}

function require_admin(PDO $db): int
{
    $userId = require_user();
    $stmt = $db->prepare('SELECT is_admin FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $row = $stmt->fetch();
    if (!$row || (int) $row['is_admin'] !== 1) {
        json_error('Admins only', 403);
    }
    return $userId;
}

// Basic bech32 shape check (not full checksum validation - the watcher
// verifies addresses against the chain before first poll).
function looks_like_address(string $address, string $prefix): bool
{
    return (bool) preg_match('/^' . preg_quote($prefix, '/') . '1[a-z0-9]{20,80}$/', $address);
}
