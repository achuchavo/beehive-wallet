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
| `apcu` | proxy rate limiting falls back to the shared DB counter (`rate_counters`), then to per-server file counters. Correct, just slower. |
| `curl` | **currently NOT loadable in this deployment's Apache SAPI.** `api/common.php` therefore uses the HTTPS stream wrapper for outbound proxy calls. The cost is that a connection cannot be pinned to the pre-validated IP (no `CURLOPT_RESOLVE`), leaving a narrow DNS-rebinding window. Installing `php_curl.dll` and restarting Apache closes it. |

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

Known state after the 2026-07-22 restart:

| Extension | Status |
|---|---|
| `php_oci8_19.dll` | resolved — the extension line is commented out in php.ini (it was never used; the app is PDO MySQL) |
| `pdo_sqlite` | still failing, harmless — unused |
| `php_curl.dll` | still failing — see the table above; this is why outbound HTTP uses stream wrappers |

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
