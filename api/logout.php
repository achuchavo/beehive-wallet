<?php
require __DIR__ . '/common.php';

session_logout();

json_out(['ok' => true]);
