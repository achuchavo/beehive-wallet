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

> The CLI and Apache SAPIs load `php.ini` **independently**. `php -m` on the
> command line is not evidence that Apache loaded the same set — check
> `D:\WebServer\Apache24\logs\error.log` for `Unable to load dynamic library`.

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

Known remaining warning: Apache still advertises its exact version. Fix in the
main server config (needs a restart):

```apache
ServerTokens Prod
ServerSignature Off
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
