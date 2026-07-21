# Point the service at the watcher venv python. Run as Administrator.
$nssm = "C:\nssm\win64\nssm.exe"
$dir = "D:\projects\beehive-wallet\watcher"

& $nssm set BeehiveWalletWatcher Application "$dir\venv\Scripts\python.exe"
& $nssm set BeehiveWalletWatcher AppParameters "$dir\watcher.py"
& $nssm restart BeehiveWalletWatcher
& $nssm status BeehiveWalletWatcher
