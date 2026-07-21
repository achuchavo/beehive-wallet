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
  Copy-Item "$PSScriptRoot\config\chains.json" "$dest\api\chains.json" -Force
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
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "subdomain build failed" }
  New-Item -ItemType Directory -Force -Path $subDest | Out-Null
  Deploy $subDest
  # SPA fallback for root base (overrides the /wallet/ .htaccess from public/)
  Set-Content -Path "$subDest\.htaccess" -Encoding ascii -Value @"
DirectoryIndex index.html index.php
RewriteEngine On
RewriteBase /
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . index.html [L]
"@
  # db_config.php is created once by hand on the server; keep the path build's copy
  if (Test-Path "$pathDest\api\db_config.php") {
    Copy-Item "$pathDest\api\db_config.php" "$subDest\api\db_config.php" -Force
  }
  Write-Host "Deployed subdomain build to $subDest"
}

$env:VITE_BASE = $null
