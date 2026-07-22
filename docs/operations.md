# Beehive Wallet — operations guide

Everything an operator needs that is not obvious from the code. Companion to
`security-headers.md` (header policy) and `docs/migrations/` (schema history).

---

## Required PHP extensions

Verified automatically by `docs/verify-deployment.ps1`.

| Extension | Why |
|---|---|
| `pdo_mysql` | all database access |
| `openssl`   | ADR-036 signature verification, TLS to upstream nodes |
| `json`      | every API response |
| `mbstring`  | safe string truncation of user input |
| `bcmath`    | secp256k1 on-curve check for address-ownership proofs |

**Optional but recommended**

| Extension | Effect if missing |
|---|---|
| `apcu` | **Deliberately not installed** — see below. Proxy rate limiting uses the shared DB counter (`rate_counters`), falling back to per-server file counters. Correct, just one small write per proxy request. |
| `curl` | **Loaded (7.85.0 / OpenSSL 3.0.8) as of 2026-07-23.** `proxy_fetch()` uses it and pins each connection to the addresses validated moments earlier via `CURLOPT_RESOLVE`, closing the DNS-rebinding window. If curl is ever absent the code falls back to the HTTPS stream wrapper automatically — still safe, but unable to pin. |

### The php.ini trap

Apache and the CLI read the **same file** — `httpd.conf` sets
`PHPIniDir "D:/WebServer/php"`, so both use `D:\WebServer\php\php.ini` — but
each only re-reads it **when that process restarts**. Editing php.ini therefore
fixes the CLI immediately and does nothing for the web server until Apache is
restarted. `php -m` on the command line is not evidence of what Apache loaded.

The authoritative check is Apache's own log, read **by timestamp**:

```powershell
Get-Content D:\WebServer\Apache24\logs\error.log -Tail 40 |
  Select-String 'resuming normal operations|Unable to load dynamic library'
```

Only the `Unable to load` lines appearing **after** the most recent
`resuming normal operations` reflect the running server. Reading a plain tail
will happily show you warnings from a startup days ago and send you chasing a
problem that is already fixed.

All extension load failures are resolved as of 2026-07-23; the check above
should report nothing.

### Why APCu is not installed (decision, 2026-07-23)

APCu would let `proxy_rate_limit()` count in shared memory instead of writing a
`rate_counters` row per proxy request. It is a performance optimisation, not a
correctness or security fix — the DB-backed limiter is fully correct, and is
itself backed by a per-server file counter if the database is unreachable.

Unlike `php_curl.dll`, APCu does **not** ship with PHP. Installing it means
fetching an **unsigned** third-party binary (`php_apcu-<ver>-8.2-ts-vs16-x64`
from `windows.php.net/downloads/pecl/releases/apcu/`) and loading native code
into the web server that fronts a wallet backend. Weighed against a modest
saving at current traffic, the owner chose not to take on that supply-chain
step. Revisit if proxy volume ever makes the per-request write matter.

If it is installed later, the build must match exactly: **PHP 8.2, Thread Safe
(TS), VS16, x64** (`Zend Extension Build => API420220829,TS,VS16`). A
mismatched DLL will fail to load or destabilise Apache. `proxy_rate_limit()`
already prefers APCu automatically when present — no code change is needed.

### "Unable to load dynamic library" when the DLL clearly exists

This one is badly worded by Windows and cost real time. `php_curl.dll` and
`php_pdo_sqlite.dll` both failed with *"The specified module could not be
found"* while sitting in `ext\`, correctly built, and enabled in php.ini — and
the CLI loaded curl the whole time.

The message refers to the DLL's **dependencies**, not the DLL named in it.
`php_curl.dll` needs `libcrypto-3-x64.dll`, `libssl-3-x64.dll`, `libssh2.dll`
and `nghttp2.dll`; `php_pdo_sqlite.dll` needs `libsqlite3.dll`. All live in the
PHP **root**, not `ext\`. Windows searches the *loading executable's* directory,
so `php.exe` (in `D:\WebServer\php`) finds them and `httpd.exe` does not —
and `D:\WebServer\php` is not on the machine PATH.

Fixed with `LoadFile` directives in `httpd.conf`, immediately **before**
`LoadModule php_module` (order matters: `libssl` depends on `libcrypto`):

```apache
LoadFile "D:/WebServer/php/libcrypto-3-x64.dll"
LoadFile "D:/WebServer/php/libssl-3-x64.dll"
LoadFile "D:/WebServer/php/libssh2.dll"
LoadFile "D:/WebServer/php/nghttp2.dll"
LoadFile "D:/WebServer/php/libsqlite3.dll"
```

Preferred over adding the PHP directory to the machine PATH: explicit,
self-documenting, and it does not affect other software on the box.

**Before downloading a replacement DLL, check whether the file is already
there.** It almost certainly is, and replacing it fixes nothing.

---

## Database migrations

Migrations are the authoritative schema; `docs/schema.sql` is the fresh-install
snapshot kept in sync with them. They are forward-only and idempotent.

The application user (`beehive_wallet`) is **DML-only** — `SELECT, INSERT,
UPDATE, DELETE` on `beehive_wallet.*` and no DDL. Migrations need the privileged
account.

```bash
# ALWAYS back up first — outside the repo. A dump contains user emails and
# password hashes and must never be committed.
mysqldump -u chavo -p beehive_wallet > D:\WebServer\backups\before_00N.sql
mysql -u chavo -p beehive_wallet < docs/migrations/00N_name.sql
```

Check the applied version:

```sql
SELECT MAX(version) FROM schema_version;
```

| Version | Adds |
|---|---|
| 4 | `login_attempts`, `chain_free_validators`, `chains.coingecko_id`, `rate_counters`, `admin_audit_log`, `schema_version` |
| 5 | `address_challenges` (address-ownership proofs) |
| 6 | `users.main_address_verified` (forces re-verification of legacy links) |
| 7 | `remember_tokens` (rotating persistent sign-in) |

Rollback for each is documented in the migration file's header. All of 5–7 hold
only transient data and can be dropped; dropping `remember_tokens` merely signs
out anyone using "keep me signed in".

> **Timezone trap:** PHP runs `Europe/Berlin` while MySQL runs the system zone
> (~7h apart). Never compare a stored `DATETIME` using PHP's `strtotime()`/
> `time()`. Let MySQL evaluate expiry (`expires_at > NOW()`) and write it with
> `NOW() + INTERVAL n SECOND`.

---

## Security headers

Shipped in the app's `.htaccess` (so no Apache restart is needed) and mirrored
in `docs/security-headers.conf`. **Keep the two in sync.**

Because the subdomain deploy overwrites `.htaccess` with a root-base rewrite,
the header block must be re-emitted whenever that file is regenerated.

Verify against the running site — never assume:

```bash
powershell -File docs/verify-deployment.ps1
```

### Version disclosure — applied 2026-07-22

Responses used to advertise `Apache/2.4.57 (Win64) OpenSSL/3.0.8 PHP/8.2.5`,
a free CVE-matching inventory. Now `Server: Apache`, with no `X-Powered-By`.

Two settings, both requiring an Apache restart:

| Setting | File | Line |
|---|---|---|
| `ServerTokens Prod` + `ServerSignature Off` | `D:\WebServer\Apache24\conf\httpd.conf` | ~232 |
| `expose_php=Off` | `D:\WebServer\php\php.ini` | ~369 |

**Do not "fix" this in `conf/extra/httpd-default.conf`.** That file already
contains `ServerTokens Full`, but `httpd.conf` does **not** `Include` it, so
editing it changes nothing while looking entirely correct. The real cause was
that Apache's built-in default for `ServerTokens` *is* `Full` when unset. Check
what is actually loaded before editing:

```powershell
Select-String -Path D:\WebServer\Apache24\conf\httpd.conf -Pattern '^\s*Include'
```

**Always validate before restarting** — a bad config leaves the site down:

```powershell
D:\WebServer\Apache24\bin\httpd.exe -t      # must print "Syntax OK"
Restart-Service Apache2.4                   # needs an ELEVATED shell
```

Restarting Apache or the watcher requires administrator rights; a normal shell
fails with `Cannot open <service> service on computer '.'`. The stop is refused
outright rather than half-applied, so a failed attempt is harmless.

Config backups live in `D:\WebServer\backups\` (`httpd.conf.bak-*`,
`php.ini.bak-*`). These are **server files, outside the repo** — they are not
under version control, so record changes here.

Confirm afterwards:

```powershell
(Invoke-WebRequest https://wallet.achumuamah.com/ -UseBasicParsing).Headers['Server']
```

---

## Watcher: cursor gaps and recovery

Each watched address keeps a per-direction cursor (the last transaction hash
seen). `fetch_new_since()` pages backwards until it finds that cursor.

A **CURSOR GAP** is logged when an *established* cursor cannot be found — the
provider pruned history, a reorg orphaned it, or the backlog exceeded
`MAX_PAGES`. The watcher then deliberately **does not advance the cursor**,
because doing so would silently skip everything between the fetched window and
the cursor. Alerts it could see are still recorded (deduplicated by the unique
`(watched_address_id, tx_hash)` constraint), so a gap never causes a replay
storm.

Exhausting history with **no** cursor yet (first contact) is normal baselining,
not a gap.

**Recovery**

1. Look for `CURSOR GAP` in the watcher log and note the address and direction.
2. Confirm the range is genuinely unreadable — check the address on the explorer.
3. Either raise `MAX_PAGES` (if it was simply a large backlog) and let it catch
   up, or accept the gap and re-baseline by clearing that direction's cursor:

```sql
-- direction columns: last_seen_tx_hash | last_seen_received_tx | last_seen_unbond_tx
UPDATE watched_addresses SET last_seen_tx_hash = '' WHERE id = <id>;
```

Setting `''` (the sentinel) re-baselines from the current tip. Setting `NULL`
does the same but suppresses alerts for the baseline pass.

**Before restarting the watcher**, dry-run the cursor logic against live data —
it writes nothing and is safe while the service is running:

```bash
watcher\venv\Scripts\python.exe dryrun_cursors.py
```

Then restart (needs an **elevated** shell):

```bash
Restart-Service BeehiveWalletWatcher
```

Watch `cursor_gaps` in the cycle metrics afterwards; it should stay `0`.

---

## Colour contrast (WCAG AA)

Audited by measuring the **rendered DOM**, not by reading the palette: for every
element with a text node, take the computed colour, walk up for the first opaque
background, blend any alpha, and compute the WCAG 2.1 ratio (4.5:1 normal text,
3:1 for ≥24px or ≥18.66px bold).

Two traps worth knowing if you re-run this:

1. **Tailwind v4 emits `oklch()`.** A naive `rgb()` regex silently returns null
   and the audit reports nonsense (an amber button measured as white-on-white).
   Resolve colours by painting them to a 1×1 canvas and reading the pixel back —
   that handles any syntax the browser supports.
2. **Probing a utility class only works if that class exists in the output.**
   `bg-amber-600` is used exclusively as `hover:bg-amber-600`, so a probe element
   with `class="bg-amber-600"` has *no* background and measures as black (a
   bogus 21:1). Read Tailwind's theme variables instead:
   `getComputedStyle(document.documentElement).getPropertyValue('--color-amber-600')`.

Fixes applied (all measured before/after):

| Was | Ratio | Now | Ratio |
|---|---|---|---|
| `text-white` on `bg-amber-500` (primary button) | **2.13** | `text-slate-900` on `bg-amber-500` | **8.35** |
| `text-slate-400` (muted, 66 uses) | **2.63** | `text-slate-500` | **4.76** |
| `text-amber-600` (wordmark/links) | **3.06** | `text-amber-700` | **4.81** |
| `text-green-600` (status) | **3.22** | `text-green-700` | **4.95** |

The brand amber was deliberately **kept** — darkening buttons to `amber-700`
would also pass (5.03) but changes the brand colour; dark text on the vivid
amber scores far higher and preserves it.

Current state: **0 failures** across dashboard, docs, settings, alarms, staking,
rewards, history and send.

## Authentication notes

- **Remember-me** issues a rotating selector/verifier token (`remember_tokens`),
  never a long-lived session. Only a SHA-256 of the verifier is stored. Tokens
  are revoked on logout, on any fresh sign-in, and when an account is disabled.
  A previous verifier stays valid for 60s so concurrent browser requests are not
  mistaken for replay.
- **There is no password-change endpoint yet.** When one is added it **must**
  call `remember_revoke_all()`, or old tokens would survive a password reset.
- **Address ownership** requires an ADR-036 signature over a single-use,
  account-bound challenge. Only a *verified* address works as a login
  identifier; an unverified holder loses the address to whoever can sign for it.

## Adding a chain

The registry is entirely DB-driven: `chains` + `chain_endpoints`, served by
`api/chains_public.php`. The proxies read endpoints from the same tables, so no
PHP or allowlist change is needed. `app/src/chains.ts` ships a **bootstrap**
array containing Medibloc only — that is the fallback used when
`chains_public.php` cannot be reached, not the source of truth.

Chihuahua (migration 008) is the worked example. Verify each of these against
the live chain rather than assuming:

1. **Identity** — `chain_id` from `/status` on more than one RPC node, plus
   `bech32_prefix`, `denom`, `decimals` and `coin_type` from the Cosmos
   chain-registry. `coin_type` drives the derivation path
   (`m/44'/<coinType>'/0'/0/0`), so getting it wrong yields valid-looking but
   wrong addresses. Medibloc's 371 is the outlier; most chains are 118.
2. **Gas price** — do not copy the registry's "average" blindly. Sample recent
   transactions and see what actually gets included:
   `/cosmos/tx/v1beta1/txs?query=message.action='/cosmos.staking.v1beta1.MsgDelegate'&order_by=ORDER_BY_DESC`,
   then divide `auth_info.fee.amount[0].amount` by `fee.gas_limit`. Store the
   value the app's "Low" tier should mean, because `SPEED_OPTIONS` multiplies it
   by 1 / 1.5 / 2. Fractional gas prices are fine — `feeReserve` handles them
   exactly (it did not before 2026-07-23; see the commit that fixed it).
3. **Endpoints** — request each candidate with redirects disabled. `proxy_fetch`
   pins the connection to pre-validated IPs and refuses to follow redirects, so
   an endpoint that 301s or 403s is unusable. Chihuahua's publicnode REST host
   was dropped for exactly this reason (403).
4. **CoinGecko id** — confirm through the deployed endpoint, not coingecko.com:
   `api/price.php?id=<id>&currency=krw`. A wrong id fails silently and just
   leaves the fiat column blank.
5. **Sort order** — append (`MAX(sort_order) + 1`). The frontend's
   `DEFAULT_CHAIN` is `CHAINS[0]`, so changing the first row changes the default
   network for every wallet-less operation.

**No house validator is a supported state.** Leave `beehive_validator`,
`beehive_moniker` and `fee_collector` empty until one is actually running.
`serviceFeeActive()` is false while `fee_collector` is `''`, so no fee is
bundled into a delegation; `isFree()` matches nothing, so the validator list
sorts purely by stake; and the dashboard CTA falls back to "Start staking"
instead of advertising a Beehive validator the user cannot find.

**Trap: the frontend must wait for the registry.** The dashboard resolves each
wallet's chain with `findChain(w.chainKey)`. Its loaders are memoised, so if
they run before `chains_public.php` resolves, every DB-only chain resolves to
"network not configured" and never retries. Both loaders are now gated on
`chainsSettled` from `useChains()`. Medibloc hid this for as long as it was the
only chain, because it is the one entry in the bootstrap array. Any new page
that resolves a chain per wallet needs the same gate.

### Trap: the tx-search parameter name is not the same on every chain

The LCD tx-search filter parameter was renamed across Cosmos SDK versions, and
the two spellings are mutually exclusive (verified 2026-07-23):

| chain | `events=` | `query=` |
|---|---|---|
| Medibloc (`panacea-3`, older SDK) | 200 | 400 |
| Chihuahua (`chihuahua-1`, newer SDK) | 500 | 200 |

`app/src/wallet/txsearch.ts` detects this rather than making it configuration,
because chains are added by an admin who should not need to know their node's
SDK version. It probes `query=` first and caches the winner per chain key.

The order is deliberate and load-bearing: a chain that rejects `query=` answers
**4xx**, which `lcd_proxy` returns immediately, whereas a chain that rejects
`events=` answers **5xx**, which makes the proxy fail over across every
configured endpoint first — 32s measured on Chihuahua. Probing in the other
order would put that 32s stall on every newer chain. There is a test pinning
this; do not "simplify" it by reordering.

The same 5xx-triggers-failover behaviour is why `fetchWalletPortfolio` no longer
requests `/distribution/.../validators/<valoper>/commission` unconditionally:
the result is discarded for non-validators, but on Chihuahua the request itself
cost 32s and blocked the dashboard behind it. Only ask once the validator lookup
has confirmed the address actually is one.
