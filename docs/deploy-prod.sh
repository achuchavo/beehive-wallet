#!/usr/bin/env bash
#
# Deploy a tagged release to wallet.beehive.kr.
#
# Runs ON THE PRODUCTION SERVER. Pulls the artifact GitHub Actions already built
# from a tagged commit, verifies it byte-for-byte, and swaps it in atomically.
# Nothing is built here: prod has no Node toolchain and does not need one, and
# building on the box would mean the running site was never the attested build.
#
#   sudo /opt/beehive-deploy/deploy-prod.sh v0.2.0
#   sudo /opt/beehive-deploy/deploy-prod.sh --rollback
#   sudo /opt/beehive-deploy/deploy-prod.sh v0.2.0 --dry-run
#
# WHAT IT DELIBERATELY DOES NOT DO:
#   * Run database migrations. Schema changes are applied by hand with the
#     privileged MySQL account, BEFORE this script (see docs/deploying-production.md).
#     The app user is DML-only, and a deploy that can silently reshape the
#     database is a deploy that can silently destroy it.
#   * Touch db_config.php. It lives in shared/ and is symlinked in, so it is not
#     in the artifact, not in git, and not on the swap path.
#   * Purge Cloudflare. No credentials here; see the cache note below.
set -euo pipefail

REPO="achuchavo/beehive-wallet"
BASE="/var/www/beehive"
RELEASES="$BASE/releases"
SHARED="$BASE/shared"
CURRENT="$BASE/current"
DOCROOT="/var/www/wallet.beehive.kr"   # a symlink -> $CURRENT
WATCHER_DIR="/opt/beehive-watcher"
TOKEN_FILE="/etc/beehive/github-token"  # root-only, fine-grained PAT, Contents:read
KEEP_RELEASES=5
SITE="https://wallet.beehive.kr"

die() { echo "ERROR: $*" >&2; exit 1; }
say() { echo "==> $*"; }

[ "$(id -u)" -eq 0 ] || die "run with sudo"

DRY_RUN=0
TAG=""
ROLLBACK=0
for arg in "$@"; do
  case "$arg" in
    --dry-run)  DRY_RUN=1 ;;
    --rollback) ROLLBACK=1 ;;
    v*)         TAG="$arg" ;;
    *)          die "unknown argument: $arg" ;;
  esac
done

# --- Rollback ---------------------------------------------------------------
# Old releases are kept on disk precisely so this is a symlink flip. It is also
# why the previous release's ASSETS survive a deploy: a browser holding a cached
# index.html still resolves its hashed .js, instead of getting nginx's SPA
# fallback (200 + index.html) where JavaScript should be.
if [ "$ROLLBACK" -eq 1 ]; then
  [ -L "$CURRENT" ] || die "$CURRENT is not a symlink; nothing to roll back"
  cur="$(basename "$(readlink -f "$CURRENT")")"
  prev="$(ls -1dt "$RELEASES"/*/ 2>/dev/null | sed -n '2p' | xargs -r basename)"
  [ -n "$prev" ] || die "no previous release to roll back to"
  say "rolling back: $cur -> $prev"
  [ "$DRY_RUN" -eq 1 ] && { echo "(dry run)"; exit 0; }
  ln -sfn "$RELEASES/$prev" "$CURRENT"
  systemctl reload php8.2-fpm
  say "now serving $prev"
  exit 0
fi

[ -n "$TAG" ] || die "usage: deploy-prod.sh <tag> [--dry-run] | --rollback"

# --- Preflight --------------------------------------------------------------
# Every check that can fail without changing anything runs here, before a single
# byte moves. A deploy that aborts halfway is worse than one that never starts.
say "preflight"
[ -r "$TOKEN_FILE" ] || die "missing $TOKEN_FILE (fine-grained PAT, Contents: read)"
[ -r "$SHARED/db_config.php" ] || die "missing $SHARED/db_config.php - see docs/deploying-production.md"
command -v curl >/dev/null || die "curl not installed"
command -v jq   >/dev/null || die "jq not installed"

# The nginx SPA fallback returns 200 + index.html for a MISSING asset, and
# Cloudflare caches that against a .js URL - which white-screened prod for six
# minutes on 2026-07-26. The fix is a location block; refuse to automate deploys
# until it is in place, because automating this means automating that outage.
if ! grep -rqs 'location /assets/' /etc/nginx/sites-enabled/; then
  die "nginx is missing the /assets/ exception - see docs/deploying-production.md step 2"
fi

TOKEN="$(cat "$TOKEN_FILE")"
api() { curl -fsSL -H "Authorization: Bearer $TOKEN" \
                  -H "Accept: application/vnd.github+json" "$@"; }

say "resolving $TAG"
rel="$(api "https://api.github.com/repos/$REPO/releases/tags/$TAG")" \
  || die "no release for tag $TAG (has the tag been pushed and the workflow finished?)"

asset_id() { echo "$rel" | jq -r --arg n "$1" '.assets[] | select(.name==$n) | .id'; }
fetch_asset() {
  local id; id="$(asset_id "$1")"
  [ -n "$id" ] && [ "$id" != "null" ] || die "release $TAG has no asset named $1"
  curl -fsSL -H "Authorization: Bearer $TOKEN" \
             -H "Accept: application/octet-stream" \
             "https://api.github.com/repos/$REPO/releases/assets/$id" -o "$2"
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

TARBALL="beehive-deploy-$TAG.tar.gz"
say "downloading $TARBALL"
fetch_asset "$TARBALL"            "$work/$TARBALL"
fetch_asset "$TARBALL.sha256"     "$work/$TARBALL.sha256"
fetch_asset "deploy-SHA256SUMS.txt" "$work/deploy-SHA256SUMS.txt"
fetch_asset "deploy-release.txt"  "$work/deploy-release.txt"

# --- Verify -----------------------------------------------------------------
# Twice: the tarball against its published digest, then every unpacked file
# against the per-file sums. The point is that what lands on disk is provably
# the artifact the workflow attested, not merely something that downloaded
# without error.
say "verifying tarball digest"
expected="$(tr -d '[:space:]' < "$work/$TARBALL.sha256")"
actual="$(sha256sum "$work/$TARBALL" | cut -d' ' -f1)"
[ "$expected" = "$actual" ] || die "tarball digest mismatch
  expected $expected
  actual   $actual"

say "unpacking"
mkdir -p "$work/unpacked"
tar -xzf "$work/$TARBALL" -C "$work/unpacked"

say "verifying every file"
(cd "$work/unpacked" && sha256sum --quiet -c deploy-SHA256SUMS.txt) \
  || die "per-file hash check failed - the artifact is not intact"

# Belt and braces. The workflow excludes these and refuses to build if they are
# present, but this is the last point before they would reach a public web root.
for f in api/db_config.php api/db_config.php.example api/chains.json watcher/db_config.json watcher/vapid_private.pem; do
  [ -e "$work/unpacked/$f" ] && die "artifact contains $f - refusing to deploy"
done
[ -d "$work/unpacked/api/tests" ] && die "artifact contains api/tests - refusing to deploy"

COMMIT="$(grep '^commit=' "$work/deploy-release.txt" | cut -d= -f2)"
say "release $TAG is commit $COMMIT"

DEST="$RELEASES/$TAG"
if [ -e "$DEST" ]; then
  say "note: $DEST already exists and will be replaced"
fi

if [ "$DRY_RUN" -eq 1 ]; then
  say "dry run: verified $TAG ($COMMIT). Nothing was changed."
  exit 0
fi

# --- Install ----------------------------------------------------------------
say "installing to $DEST"
rm -rf "$DEST.new"
mkdir -p "$DEST.new"
cp -r "$work/unpacked/dist/." "$DEST.new/"
cp -r "$work/unpacked/api"    "$DEST.new/api"

# The secret is linked, never copied. Nothing in the release can shadow it, and
# a release directory is safe to delete without taking the credential with it.
ln -sfn "$SHARED/db_config.php" "$DEST.new/api/db_config.php"

chown -R www-data:www-data "$DEST.new"
find "$DEST.new" -type d -exec chmod 755 {} +
find "$DEST.new" -type f -exec chmod 644 {} +

rm -rf "$DEST"
mv "$DEST.new" "$DEST"

# --- Swap -------------------------------------------------------------------
# One rename. Requests are served either entirely from the old release or
# entirely from the new one, never from a half-copied directory.
prev_target="$(readlink -f "$CURRENT" 2>/dev/null || true)"
say "switching current -> $TAG"
ln -sfn "$DEST" "$CURRENT.tmp"
mv -Tf "$CURRENT.tmp" "$CURRENT"

systemctl reload php8.2-fpm
say "php-fpm reloaded"

# --- Watcher ----------------------------------------------------------------
# Restarted only when its code actually changed: a needless restart drops the
# current poll cycle, and the watcher is what raises the alerts people signed up
# for. Its config and VAPID key live in the directory and are left alone.
if ! diff -rq --exclude='db_config.json' --exclude='vapid_private.pem' \
              --exclude='venv' --exclude='__pycache__' --exclude='logs' \
              "$work/unpacked/watcher" "$WATCHER_DIR" >/dev/null 2>&1; then
  say "watcher code changed - updating"
  rsync -a --exclude 'db_config.json' --exclude 'vapid_private.pem' \
           --exclude 'venv/' --exclude '__pycache__/' --exclude 'logs/' \
           "$work/unpacked/watcher/" "$WATCHER_DIR/"
  chown -R beehive:beehive "$WATCHER_DIR"
  systemctl restart beehive-watcher
  sleep 3
  systemctl is-active --quiet beehive-watcher \
    || die "beehive-watcher did not come back up - check: journalctl -u beehive-watcher -n 50"
  say "watcher restarted and running"
else
  say "watcher unchanged - not restarted"
fi

# --- Verify what is actually being served -----------------------------------
# On disk first, because that is the check that cannot lie. An HTTP probe tells
# you something answered; comparing the docroot to the manifest tells you the
# bytes are the attested build.
say "verifying deployed files"
(cd "$CURRENT" && sha256sum --quiet -c <(grep ' \./dist/' "$work/deploy-SHA256SUMS.txt" | sed 's| \./dist/| ./|')) \
  || die "deployed files do not match the manifest"

# Only the root document, and only with a cache-buster. NEVER request an asset
# URL: if it is missing, nginx answers 200 with index.html and Cloudflare caches
# that against a .js path - the exact sequence that white-screened prod.
code="$(curl -s -o /dev/null -w '%{http_code}' "$SITE/?deploycheck=$RANDOM")"
[ "$code" = "200" ] || die "site returned HTTP $code through Cloudflare"

say "prune: keeping the newest $KEEP_RELEASES releases"
# Old releases are kept on purpose - see the note on rollback and cached
# index.html above. Pruning too aggressively is how you strand a user mid-visit.
ls -1dt "$RELEASES"/*/ | tail -n +$((KEEP_RELEASES + 1)) | xargs -r rm -rf

echo
say "DEPLOYED"
echo "    tag:      $TAG"
echo "    commit:   $COMMIT"
echo "    docroot:  $DOCROOT -> $(readlink -f "$CURRENT")"
echo "    previous: ${prev_target:-none}"
echo "    rollback: sudo $0 --rollback"
