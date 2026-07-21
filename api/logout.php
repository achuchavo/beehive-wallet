<?php
require __DIR__ . '/common.php';

$_SESSION = [];
session_destroy();

json_out(['ok' => true]);
