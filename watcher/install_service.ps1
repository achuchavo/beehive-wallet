# Registers the wallet watcher as a Windows service via NSSM.
# Run as Administrator. Mirrors the BeehiveChainMonitorAlarmBot setup.
$nssm = "C:\nssm\win64\nssm.exe"
$py = (Get-Command python).Source
$dir = "D:\projects\beehive-wallet\watcher"

New-Item -ItemType Directory -Force -Path "$dir\logs" | Out-Null

& $nssm install BeehiveWalletWatcher $py "$dir\watcher.py"
& $nssm set BeehiveWalletWatcher AppDirectory $dir
& $nssm set BeehiveWalletWatcher AppStdout "$dir\logs\watcher_stdout.log"
& $nssm set BeehiveWalletWatcher AppStderr "$dir\logs\watcher_stderr.log"
& $nssm set BeehiveWalletWatcher DisplayName "Beehive Wallet Watcher"
& $nssm set BeehiveWalletWatcher Description "Polls chain LCD for outgoing transactions from watched wallet addresses and writes alerts for the Beehive Wallet app."
& $nssm set BeehiveWalletWatcher Start SERVICE_AUTO_START
& $nssm start BeehiveWalletWatcher
& $nssm status BeehiveWalletWatcher
