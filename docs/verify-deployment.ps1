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

Write-Host "`n=== Required PHP extensions ===" -ForegroundColor Cyan
if (Test-Path $PhpExe) {
    $out = & $PhpExe -m 2>&1 | Out-String
    # The startup warning itself is a finding (audit #17).
    if ($out -match 'Unable to load dynamic library') {
        $lib = ([regex]::Match($out, "dynamic library '([^']+)'")).Groups[1].Value
        Bad "PHP emits a startup warning loading '$lib' - remove/disable it in php.ini"
    } else { Ok "no PHP startup extension warnings" }

    foreach ($ext in @('pdo_mysql', 'openssl', 'json', 'mbstring', 'curl')) {
        if ($out -match "(?im)^\s*$ext\s*$") { Ok "ext $ext" } else { Bad "ext $ext MISSING" }
    }
    # Rate-limit backend: APCu preferred, DB fallback otherwise (see audit #4).
    if ($out -match '(?im)^\s*apcu\s*$') { Ok "ext apcu (in-memory rate limiting)" }
    else { Warn "apcu absent - proxy rate limiting uses the slower DB fallback (rate_counters)" }
} else {
    Warn "PHP not found at $PhpExe - skipped extension checks"
}

Write-Host "`n=== Summary ===" -ForegroundColor Cyan
Write-Host "  failures: $script:fail   warnings: $script:warn"
if ($script:fail -gt 0) { exit 1 }
exit 0
