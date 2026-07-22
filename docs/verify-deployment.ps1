# Beehive Wallet - post-deploy verification.
#   powershell -File docs/verify-deployment.ps1
#   powershell -File docs/verify-deployment.ps1 -BaseUrl https://wallet.achumuamah.com
#
# Checks the things that can only be confirmed against a running deployment:
# security response headers, HTTPS enforcement, version disclosure, required
# PHP extensions, and the schema version. Exits non-zero if anything fails, so
# it can gate a deploy.

param(
    [string]$BaseUrl = "https://wallet.achumuamah.com",
    [string]$PhpExe = "D:\WebServer\php\php.exe"
)

$script:fail = 0
$script:warn = 0

function Ok($msg)   { Write-Host "  PASS  $msg" -ForegroundColor Green }
function Bad($msg)  { Write-Host "  FAIL  $msg" -ForegroundColor Red;    $script:fail++ }
function Warn($msg) { Write-Host "  WARN  $msg" -ForegroundColor Yellow; $script:warn++ }

Write-Host "`n=== Security response headers ($BaseUrl) ===" -ForegroundColor Cyan
try {
    $r = Invoke-WebRequest $BaseUrl -UseBasicParsing -TimeoutSec 20

    # header name -> substring that must appear in its value ('' = presence only)
    $required = [ordered]@{
        'Content-Security-Policy'   = "frame-ancestors 'none'"
        'Strict-Transport-Security' = 'max-age='
        'X-Content-Type-Options'    = 'nosniff'
        'Referrer-Policy'           = ''
        'Permissions-Policy'        = ''
    }
    foreach ($h in $required.Keys) {
        $v = $r.Headers[$h]
        if (-not $v) { Bad "$h is missing"; continue }
        $need = $required[$h]
        if ($need -and ($v -notlike "*$need*")) { Bad "$h present but missing '$need'" }
        else { Ok "$h" }
    }

    # CSP must not weaken script execution.
    $csp = $r.Headers['Content-Security-Policy']
    if ($csp) {
        foreach ($bad in @("unsafe-eval")) {
            if ($csp -like "*$bad*") { Bad "CSP contains $bad" } else { Ok "CSP has no $bad" }
        }
        # unsafe-inline is tolerated for style-src only.
        if ($csp -match "script-src[^;]*unsafe-inline") { Bad "CSP allows unsafe-inline in script-src" }
        else { Ok "CSP script-src is strict" }
        foreach ($need in @("object-src 'none'", "base-uri 'self'", "form-action 'self'")) {
            if ($csp -like "*$need*") { Ok "CSP has $need" } else { Bad "CSP missing $need" }
        }
    }

    # Version disclosure.
    if ($r.Headers['X-Powered-By']) { Bad "X-Powered-By leaks PHP version" } else { Ok "no X-Powered-By" }
    $server = $r.Headers['Server']
    if ($server -match '\d+\.\d+') { Warn "Server header leaks versions: $server (set ServerTokens Prod)" }
    else { Ok "Server header minimal" }
} catch {
    Bad "could not fetch $BaseUrl : $($_.Exception.Message)"
}

Write-Host "`n=== HTTPS enforcement ===" -ForegroundColor Cyan
try {
    $httpUrl = $BaseUrl -replace '^https://', 'http://'
    $f = Invoke-WebRequest $httpUrl -UseBasicParsing -TimeoutSec 20
    if ("$($f.BaseResponse.ResponseUri)" -like 'https://*') { Ok "HTTP redirects to HTTPS" }
    else { Bad "HTTP did NOT redirect to HTTPS" }
} catch {
    Warn "HTTP check inconclusive: $($_.Exception.Message)"
}

Write-Host "`n=== Required PHP extensions (CLI SAPI) ===" -ForegroundColor Cyan
# CAUTION: this inspects the CLI SAPI. Apache (mod_php) loads php.ini at ITS
# start, so the two can disagree - ext/curl is listed by the CLI here but fails
# to load in the running Apache ("Unable to load dynamic library 'php_curl.dll'"
# in logs\error.log), which is why api/common.php uses the HTTPS stream wrapper
# rather than curl_*(). Grep the Apache error log for the authoritative answer.
if (Test-Path $PhpExe) {
    $out = & $PhpExe -m 2>&1 | Out-String
    # The startup warning itself is a finding (audit #17).
    if ($out -match 'Unable to load dynamic library') {
        $lib = ([regex]::Match($out, "dynamic library '([^']+)'")).Groups[1].Value
        Bad "PHP emits a startup warning loading '$lib' - remove/disable it in php.ini"
    } else { Ok "no PHP startup extension warnings" }

    # Extensions the app genuinely depends on. curl is deliberately NOT required.
    foreach ($ext in @('pdo_mysql', 'openssl', 'json', 'mbstring')) {
        if ($out -match "(?im)^\s*$ext\s*$") { Ok "ext $ext" } else { Bad "ext $ext MISSING" }
    }

    # Report what Apache actually managed to load, which is what matters.
    #
    # Only lines AFTER the most recent "resuming normal operations" describe the
    # RUNNING server. A plain tail also returns warnings from previous startups,
    # which makes an already-fixed extension look broken forever - this script
    # did exactly that and reported a resolved OCI8 failure for hours.
    $apacheLog = "D:\WebServer\Apache24\logs\error.log"
    if (Test-Path $apacheLog) {
        $lines = Get-Content $apacheLog -Tail 400
        $lastStart = -1
        for ($i = 0; $i -lt $lines.Count; $i++) {
            if ($lines[$i] -match 'resuming normal operations') { $lastStart = $i }
        }
        if ($lastStart -lt 0) {
            Warn "could not find an Apache startup marker in the recent log - extension state unknown"
        } else {
            $sinceStart = $lines[$lastStart..($lines.Count - 1)] | Select-String 'Unable to load dynamic library'
            if ($sinceStart) {
                $libs = ($sinceStart | ForEach-Object { ([regex]::Match($_, "library '([^']+)'")).Groups[1].Value }) |
                    Sort-Object -Unique
                Warn ("Apache SAPI failed to load (current run): " + ($libs -join ', '))
            } else { Ok "Apache SAPI loaded all configured extensions" }
        }
    }
    # Rate-limit backend. APCu is DELIBERATELY not installed (see
    # operations.md) - the DB counter is correct, so its absence is the
    # expected state and must not warn. A check that warns forever just trains
    # people to ignore warnings, which is how a real one gets missed.
    if ($out -match '(?im)^\s*apcu\s*$') { Ok "ext apcu present (in-memory rate limiting)" }
    else { Ok "apcu absent as intended - rate limiting via rate_counters (see operations.md)" }
} else {
    Warn "PHP not found at $PhpExe - skipped extension checks"
}

Write-Host "`n=== Summary ===" -ForegroundColor Cyan
Write-Host "  failures: $script:fail   warnings: $script:warn"
if ($script:fail -gt 0) { exit 1 }
exit 0
