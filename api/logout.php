<?php
require __DIR__ . '/common.php';
require_post();
// Logout does not require an existing session (logging out when already signed
// out is harmless), but it MUST be same-origin: otherwise any site could force
// a logout via a cross-site POST.
require_same_origin();

session_logout();

json_out(['ok' => true]);
