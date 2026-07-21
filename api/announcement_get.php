<?php
// Public endpoint - the banner shows to everyone, logged in or not.
require __DIR__ . '/common.php';

$db = get_db();

$row = $db->query(
    "SELECT message, severity
     FROM announcements
     WHERE is_active = 1
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY id DESC
     LIMIT 1"
)->fetch();

json_out(['ok' => true, 'announcement' => $row ?: null]);
