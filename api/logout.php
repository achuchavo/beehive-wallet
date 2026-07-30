<?php
require __DIR__ . '/common.php';
require_post();
// Logout does not require an existing session (logging out when already signed
// out is harmless), but a cookie caller MUST be same-origin: otherwise any site
// could force a logout via a cross-site POST. A bearer caller is exempt for the
// usual reason - see require_trusted_caller().
require_trusted_caller();

// Revoke the persistent credential too, otherwise "log out" would leave
// something behind that silently signs the user back in on the next request.
// Both kinds are attempted: the request presents at most one, and revoking the
// one that is absent is a no-op.
try {
    $db = get_db();
    remember_revoke_current($db);
    device_token_revoke_current($db);
} catch (Throwable $e) {
    error_log('logout: could not revoke persistent credential: ' . $e->getMessage());
    remember_clear_cookie();
}

session_logout();

json_out(['ok' => true]);
