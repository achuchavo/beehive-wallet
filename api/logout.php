<?php
require __DIR__ . '/common.php';
require_post();
// Logout does not require an existing session (logging out when already signed
// out is harmless), but it MUST be same-origin: otherwise any site could force
// a logout via a cross-site POST.
require_same_origin();

// Revoke the persistent token too, otherwise "log out" would leave a cookie
// that silently signs the user back in on the next request.
try {
    remember_revoke_current(get_db());
} catch (Throwable $e) {
    error_log('logout: could not revoke remember token: ' . $e->getMessage());
    remember_clear_cookie();
}

session_logout();

json_out(['ok' => true]);
