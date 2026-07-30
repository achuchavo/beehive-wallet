<?php
// Public endpoint - the announcement shows to everyone, logged in or not.
//
// id travels with the content: the client keys its dismissed/snoozed state in
// localStorage by announcement id, so a NEW announcement must arrive with a new
// id to break through an old dismissal. body/cta_* are announcement v2
// (migration 015); body is a safe markdown subset the client renders itself -
// it is never HTML, here or there.
require __DIR__ . '/common.php';

$db = get_db();

$row = $db->query(
    "SELECT id, message, body, cta_label, cta_path, severity
     FROM announcements
     WHERE is_active = 1
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY id DESC
     LIMIT 1"
)->fetch();

if ($row) {
    $row['id'] = (int) $row['id'];
    $row['body'] = $row['body'] ?? '';
}

json_out(['ok' => true, 'announcement' => $row ?: null]);
