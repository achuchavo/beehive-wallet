# Security headers & CSP

This app currently ships **no** explicit security headers in production. The file
[`security-headers.conf`](./security-headers.conf) is a ready-to-include Apache
snippet that adds a Content-Security-Policy plus the standard defense-in-depth
headers. It is **not** enforced by any frontend code — it must be deployed at the
web-server layer.

## How to deploy

1. Ensure `mod_headers` is enabled (`LoadModule headers_module ...`).
2. Add `Include .../docs/security-headers.conf` inside the wallet vhost
   (`wallet.achumuamah.com`), or paste its contents there.
3. In the main server config set `ServerTokens Prod` and `ServerSignature Off`.
4. In `php.ini` set `expose_php = Off`.
5. Reload Apache and verify with `curl -I https://wallet.achumuamah.com/`.

## Why the CSP looks the way it does

The policy was derived from the app's real network activity, not a generic
template:

| Origin | Used for | In CSP |
|---|---|---|
| self | HTML/JS/CSS, `/api/*` JSON, RPC/LCD proxies | `default-src 'self'` |
| CoinGecko | prices | **not needed** — `api/price.php` fetches them server-side |
| keybase.io | validator avatar lookup (`fetch`) | `connect-src https://keybase.io` |
| Keybase CDN | validator avatar image | covered by `img-src https:` |

- **No `unsafe-eval`.** CosmJS/Vite output does not require it.
- **`script-src 'self'`** — strict; no inline scripts.
- **`style-src 'self' 'unsafe-inline'`** — React inline `style={}` attributes and
  Tailwind's runtime need inline styles. Style injection cannot execute code, so
  this is a much smaller risk than inline scripts. Removing it would require a
  nonce/hash pass over the build.
- **`img-src 'self' data: https:`** — `data:` for the PWA icons/QR; `https:` for
  Keybase avatars, whose exact host varies (Keybase serves them off a CDN). Images
  cannot execute, so allowing `https:` images is the accepted trade-off.

## Tightening to `self`-only (recommended follow-up)

The only third-party exceptions are the two Keybase ones. Proxying Keybase through
the backend (a small `api/avatar.php` that fetches
`https://keybase.io/_/api/1.0/user/lookup.json` and, optionally, streams the image)
would let the CSP become:

```
connect-src 'self';
img-src 'self' data:;
```

i.e. a fully same-origin policy. That is the cleanest end state; it was left as a
follow-up because it needs a new backend endpoint and a small change to
`ValidatorAvatar`.
