# Serving Beehive Wallet at wallet.achumuamah.com

The server side is done: a root-based build deploys to
`D:\WebServer\Apache24\beeweb\walletapp`, and an Apache HTTP vhost for
`wallet.achumuamah.com` is live (verified locally). The `/wallet` path deploy
still works, so nothing is disrupted.

Deploy both builds with:

    .\deploy.ps1 -Sub

## To make it reachable publicly (needs your Cloudflare + a cert)

1. **Cloudflare DNS** — add a record for `wallet`:
   - Type `A` to the same origin IP as `achumuamah.com` (or `CNAME` -> `achumuamah.com`), proxy **ON** (orange cloud), like your other subdomains.

2. **Origin certificate** — the origin needs HTTPS for Cloudflare "Full" mode.
   Easiest: a **Cloudflare Origin Certificate** (dashboard -> SSL/TLS -> Origin
   Server -> Create) that covers `*.achumuamah.com`; save the cert/key on the
   box. Or issue a per-subdomain cert with win-acme like the others, once DNS
   resolves.

3. **Enable the HTTPS vhost** — add this to
   `conf\extra\httpd-ssl.conf`, pointing at the cert from step 2, then
   validate (`httpd.exe -t`) and restart Apache:

       <VirtualHost *:443>
           ServerName wallet.achumuamah.com
           DocumentRoot "D:/WebServer/Apache24/beeweb/walletapp"
           SSLEngine on
           SSLCertificateFile      "PATH\wallet-or-wildcard-crt.pem"
           SSLCertificateKeyFile   "PATH\wallet-or-wildcard-key.pem"
           SSLCertificateChainFile "PATH\wallet-or-wildcard-chain.pem"
           <Directory "D:/WebServer/Apache24/beeweb/walletapp">
               Options FollowSymLinks
               AllowOverride All
               Require all granted
           </Directory>
           DirectoryIndex index.html index.php
           ErrorLog "logs/wallet-ssl-error.log"
           CustomLog "logs/wallet-ssl-access.log" common
       </VirtualHost>

4. Optionally redirect the old path: add to the main site vhost
   `RewriteRule ^/?wallet/?(.*)$ https://wallet.achumuamah.com/$1 [R=301,L,NC]`
   once you're happy the subdomain works, to retire `/wallet`.

## Notes

- The subdomain build talks to `wallet.achumuamah.com/api` (same origin), so
  login sessions and the chain proxies work without CORS changes.
- Push notifications: the service worker scope is `/` on the subdomain, which
  is cleaner than `/wallet/` for iOS home-screen installs.
