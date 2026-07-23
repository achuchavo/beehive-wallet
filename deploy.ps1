# Build and deploy Beehive Wallet.
#   .\deploy.ps1          -> path build  (achumuamah.com/wallet)  -> beeweb\wallet
#   .\deploy.ps1 -Sub     -> also subdomain build (wallet.achumuamah.com) -> beeweb\walletapp
param([switch]$Sub)
$ErrorActionPreference = "Stop"

$pathDest = "D:\WebServer\Apache24\beeweb\wallet"
$subDest = "D:\WebServer\Apache24\beeweb\walletapp"

function Deploy($dest) {
  robocopy "$PSScriptRoot\app\dist" $dest /MIR /XD api /NJH /NJS /NDL /NFL | Out-Null
  robocopy "$PSScriptRoot\api" "$dest\api" /MIR /XF db_config.php.example /NJH /NJS /NDL /NFL | Out-Null
  # config/chains.json is NOT deployed any more. It was a second source of
  # truth that had to be redeployed to match the `chains` table, and it drifted:
  # it listed Medibloc only, so every Chihuahua address link, watched address
  # and uptime subscription failed with "Unknown chain". chain_config() now
  # reads the database, like the frontend and the watcher already did.
  Remove-Item "$dest\api\chains.json" -Force -ErrorAction SilentlyContinue
}

Set-Location "$PSScriptRoot\app"

# Path build (base /wallet/)
$env:VITE_BASE = "/wallet/"
npm run build
if ($LASTEXITCODE -ne 0) { throw "path build failed" }
Deploy $pathDest
Write-Host "Deployed path build to $pathDest"

if ($Sub) {
  # Subdomain build (base /) into a separate docroot
  $env:VITE_BASE = "/"
  cmd /c "npm run build 2>&1"
  if ($LASTEXITCODE -ne 0) { throw "subdomain build failed" }
  New-Item -ItemType Directory -Force -Path $subDest | Out-Null
  Deploy $subDest
  # SPA fallback for root base. app/public/.htaccess ships RewriteBase /wallet/,
  # which on this host makes every deep link 500 while / still returns 200 - so
  # it must be rewritten after the copy, and a deep link (not just /) is what
  # proves it worked.
  #
  # Derived from the deployed file rather than written from scratch: that file
  # also carries the security headers verify-deployment.ps1 asserts, and an
  # earlier version of this block replaced the whole thing and dropped them.
  $htaccess = Get-Content "$pathDest\.htaccess" -Raw
  if ($htaccess -notmatch 'RewriteBase /wallet/') { throw "unexpected .htaccess in $pathDest" }
  $htaccess = $htaccess -replace 'RewriteBase /wallet/', 'RewriteBase /'
  $htaccess = $htaccess -replace '(?m)^(RewriteCond %\{REQUEST_FILENAME\} !-f)',
    "RewriteCond %{REQUEST_URI} !^/\.well-known/acme-challenge/ [NC]`r`n`$1"
  # No BOM: Apache reads it as part of the first directive.
  [IO.File]::WriteAllText("$subDest\.htaccess", $htaccess, (New-Object Text.UTF8Encoding $false))
  # db_config.php is created once by hand on the server; keep the path build's copy
  if (Test-Path "$pathDest\api\db_config.php") {
    Copy-Item "$pathDest\api\db_config.php" "$subDest\api\db_config.php" -Force
  }
  Write-Host "Deployed subdomain build to $subDest"
}

$env:VITE_BASE = $null
