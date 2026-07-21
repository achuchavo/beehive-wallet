# Build the app and deploy app + api to Apache (achumuamah.com/wallet).
$ErrorActionPreference = "Stop"
$dest = "D:\WebServer\Apache24\beeweb\wallet"

Set-Location "$PSScriptRoot\app"
npm run build
if ($LASTEXITCODE -ne 0) { throw "build failed" }

robocopy "$PSScriptRoot\app\dist" $dest /MIR /XD api /NJH /NJS /NDL /NFL
robocopy "$PSScriptRoot\api" "$dest\api" /MIR /XF db_config.php.example /NJH /NJS /NDL /NFL
Copy-Item "$PSScriptRoot\config\chains.json" "$dest\api\chains.json" -Force
Write-Host "Deployed to $dest"
