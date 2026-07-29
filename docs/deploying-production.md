# Deploying to production (wallet.beehive.kr)

Production is a Vultr box (158.247.200.83, Ubuntu 24.04) running Nginx +
PHP 8.2-FPM + MySQL 8 behind Cloudflare. Staging/verify is
`wallet.achumuamah.com`, which is a different machine with its own `deploy.ps1`.

**The order is always: develop here → verify on achumuamah → ship to beehive.kr
only after the owner confirms.**

Deploys pull an artifact that GitHub Actions built from a tagged commit. Nothing
is built on the production box: it has no Node toolchain and does not need one,
and building there would mean the running site was never the attested build.

---

## The three rules that must never bend

1. **`db_config.php` is never overwritten and never travels.** It lives in
   `/var/www/beehive/shared/` and is symlinked into each release. It is not in
   git, not in the artifact, and not on the swap path. The release workflow
   fails the build if it finds one in the checkout, and `deploy-prod.sh` refuses
   an artifact that contains one.
2. **Migrations are run by hand, with the privileged account, before the swap.**
   The app user (`beehive_wallet`) is DML-only. A deploy that can silently
   reshape the schema is a deploy that can silently destroy it.
3. **Never request an asset URL that is not deployed yet.** See
   [The Cloudflare trap](#the-cloudflare-trap).

---

## One-time setup

Everything here is done once. `deploy-prod.sh` checks for each and refuses to
run if any is missing.

### 1. Directory layout

```bash
sudo mkdir -p /var/www/beehive/{releases,shared} /etc/beehive /opt/beehive-deploy

# Move the live secret out of the docroot and into shared/.
sudo cp /var/www/wallet.beehive.kr/api/db_config.php /var/www/beehive/shared/db_config.php
sudo chown www-data:www-data /var/www/beehive/shared/db_config.php
sudo chmod 640 /var/www/beehive/shared/db_config.php
```

The docroot becomes a symlink, so the nginx `root` directive does not change:

```
/var/www/wallet.beehive.kr -> /var/www/beehive/current -> /var/www/beehive/releases/<tag>
```

Do this swap **after** the first successful `--dry-run`, so there is a verified
release to point at. Keep the launch build as a fallback:

```bash
sudo mv /var/www/wallet.beehive.kr /var/www/beehive/releases/launch-backup
sudo ln -sfn /var/www/beehive/releases/launch-backup /var/www/beehive/current
sudo ln -sfn /var/www/beehive/current /var/www/wallet.beehive.kr
```

### 2. The nginx `/assets/` exception — do this first

The site block uses `try_files $uri $uri/ /index.html`, so a request for a
**missing** asset returns **HTTP 200 with `index.html`**. Cloudflare then caches
HTML against a `.js` URL. On 2026-07-26 that white-screened production for about
six minutes.

In `/etc/nginx/sites-enabled/wallet.beehive.kr`, above the SPA fallback:

```nginx
location /assets/ {
    try_files $uri =404;
    add_header Cache-Control "public, max-age=31536000, immutable";
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Hashed filenames make `immutable` safe: a changed file gets a new name.
`deploy-prod.sh` refuses to run until this block exists.

### 3. GitHub token

The repo is private, so downloading a release asset needs auth. Create a
**fine-grained PAT** scoped to this repository with **Contents: read** — nothing
else. It cannot push, cannot read other repos, and cannot act on your account.

```bash
sudo install -m 600 /dev/null /etc/beehive/github-token
sudo tee /etc/beehive/github-token >/dev/null <<< 'github_pat_...'
```

### 4. The script itself

```bash
sudo install -m 750 deploy-prod.sh /opt/beehive-deploy/deploy-prod.sh
sudo apt-get install -y jq rsync   # curl is already present
```

---

## Releasing

### 1. Verify on staging first

Deploy to `wallet.achumuamah.com` (`.\deploy.ps1 -Sub`) and confirm the change
there. Production is not where features get discovered.

### 2. Tag

```bash
git tag v0.2.0 && git push origin v0.2.0
```

That triggers `.github/workflows/release.yml`, which builds the frontend
reproducibly, hashes it, attests provenance, and publishes:

| Asset | What it is |
|---|---|
| `beehive-wallet-<tag>.zip` | frontend only — the public verification artifact |
| `beehive-deploy-<tag>.tar.gz` | the deployable set: frontend + api + watcher |
| `beehive-deploy-<tag>.tar.gz.sha256` | digest of the above |
| `deploy-SHA256SUMS.txt` | per-file hashes inside the tarball |
| `deploy-release.txt` | tag, commit, tarball digest |
| `build-manifest.json`, `SHA256SUMS.txt` | frontend hashes (see VERIFYING-THE-BUILD.md) |

Wait for the workflow to finish before deploying.

### 3. Migrations — before the swap, always

Check what production is on, and apply anything newer **in order**:

```bash
mysql -u <privileged> -p beehive_wallet -e "SELECT MAX(version) FROM schema_version;"
```

Back up first. The dump contains emails and password hashes, so keep it off the
web root:

```bash
mysqldump -u <privileged> -p beehive_wallet > ~/backups/before_<version>.sql
mysql -u <privileged> -p beehive_wallet < docs/migrations/0NN_*.sql
```

**Why before, not after:** every migration here adds columns with defaults, so
the currently-live *old* code simply ignores them. The reverse order breaks the
site — `watched_list.php` selects `tier`, `paid_until` and `payment_state`
directly, so new code against an un-migrated database is a 500 on the Alarms
page for every user.

Migrations are idempotent and guarded, so re-running one is safe.

### 4. Dry run, then deploy

```bash
sudo /opt/beehive-deploy/deploy-prod.sh v0.2.0 --dry-run
sudo /opt/beehive-deploy/deploy-prod.sh v0.2.0
```

The dry run downloads and fully verifies the artifact without changing
anything — it is the cheap way to catch a missing token, a half-published
release, or a bad digest.

The real run installs to `releases/<tag>`, links the shared secret, flips
`current` with a single rename, reloads PHP-FPM, updates and restarts the
watcher **only if its code changed**, verifies the docroot against the manifest,
and prints the deployed tag and commit.

### 5. Confirm

The script already checks the docroot hashes and that `/` returns 200. Then look
at the site's own footer — the Build · Verify badge shows the commit, so "what is
live" is answered by production itself rather than by inference.

---

## Rollback

```bash
sudo /opt/beehive-deploy/deploy-prod.sh --rollback
```

One symlink flip back to the previous release, then a PHP-FPM reload. This is
why old releases are kept (`KEEP_RELEASES=5`) instead of being cleaned up
eagerly.

**A rollback does not undo a migration.** Every migration in this repo is
additive, so older code ignores the new columns and keeps working — but if you
ever write a destructive one, that assumption dies with it. Each migration file
documents its own rollback.

---

## The Cloudflare trap

**Never fetch an asset URL that is not deployed yet.** Because of the SPA
fallback, a missing `/assets/index-<hash>.js` returns 200 with `index.html`, and
Cloudflare caches it. The next visitor gets HTML where JavaScript should be, and
the site white-screens until the cache entry expires.

This is why:

- `deploy-prod.sh` only ever probes `/`, and always with a cache-buster.
- Verification is done by **hashing the docroot**, not by fetching URLs.
- Old releases stay on disk, so a browser holding a cached `index.html` can
  still resolve the assets it was built against.

If a bad entry is ever cached again: the symptom is a `.js` URL returning
`content-type: text/html` at ~3.4 KB with `cf-cache-status: HIT`. Adding
`?cb=<random>` returns the real JavaScript, which proves the origin is fine and
only the CDN entry is poisoned. Purging needs Cloudflare credentials, which the
deploy does not have — ask the owner.

---

## What this does not cover

- **Cloudflare cache purging** — no credentials on the box, by design.
- **TLS certificates** — handled by Cloudflare (Full-strict) and the origin cert.
- **Creating the database or the watcher venv** — one-time setup done at launch.
- **Rolling a migration back** — deliberately manual; see the file's own header.
