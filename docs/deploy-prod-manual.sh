#!/usr/bin/env bash
# Manual prod deploy of a GitHub release artifact to wallet.beehive.kr.
#
# This is the script that actually deploys production (first used for
# v0.3.0/v0.3.1 on 2026-08-03); the installed copy lives on the box at
# /root/deploy-v030.sh. It replaces the docs/deploy-prod.sh artifact path,
# which was never installed - the repo went public, so downloading release
# assets needs no token and the simpler path below is enough.
#
# Run as root on the box:  /root/deploy-v030.sh <tag>
# Prereqs: the tag's release workflow is green, and any pending migration has
# been applied FIRST (see deploying-production.md - order is non-negotiable).
set -euo pipefail

TAG="${1:?usage: deploy-prod-manual.sh <tag>}"
BASE="https://github.com/achuchavo/beehive-wallet/releases/download/${TAG}"
REL="/var/www/beehive/releases/${TAG}"
WORK="$(mktemp -d /tmp/deploy-${TAG}.XXXX)"

[ -e "$REL" ] && { echo "release dir ${REL} already exists"; exit 1; }

echo "== download + digest check"
curl -fsSL -o "${WORK}/deploy.tar.gz" "${BASE}/beehive-deploy-${TAG}.tar.gz"
curl -fsSL -o "${WORK}/deploy.tar.gz.sha256" "${BASE}/beehive-deploy-${TAG}.tar.gz.sha256"
echo "$(cat "${WORK}/deploy.tar.gz.sha256")  ${WORK}/deploy.tar.gz" | sha256sum -c -

echo "== unpack + per-file hash check"
mkdir "${WORK}/stage"
tar -xzf "${WORK}/deploy.tar.gz" -C "${WORK}/stage"
(cd "${WORK}/stage" && sha256sum -c deploy-SHA256SUMS.txt --quiet)

echo "== build release dir (docroot = dist contents + api/)"
mkdir -p "$REL"
cp -r "${WORK}/stage/dist/." "$REL/"
cp -r "${WORK}/stage/api" "$REL/api"
# The shared secret is linked in, never copied (rule 1 of the deploy doc).
ln -s /var/www/beehive/shared/db_config.php "$REL/api/db_config.php"
chown -R www-data:www-data "$REL"

echo "== atomic swap + php reload"
ln -s "$REL" /var/www/beehive/current.new
mv -Tf /var/www/beehive/current.new /var/www/beehive/current
systemctl reload php8.2-fpm

echo "== watcher"
# Restart only when the RUNNING code actually changed - a frontend-only
# release should not bounce a service that is mid-poll. The test file is
# kept in sync regardless; it never affects the running process.
if ! cmp -s "${WORK}/stage/watcher/test_watcher.py" /opt/beehive-watcher/test_watcher.py; then
  install -o beehive -g beehive -m 644 "${WORK}/stage/watcher/test_watcher.py" /opt/beehive-watcher/test_watcher.py
fi
if cmp -s "${WORK}/stage/watcher/watcher.py" /opt/beehive-watcher/watcher.py; then
  echo "watcher.py unchanged - not restarting"
else
  install -o beehive -g beehive -m 644 "${WORK}/stage/watcher/watcher.py" /opt/beehive-watcher/watcher.py
  systemctl restart beehive-watcher
  sleep 2
  systemctl is-active beehive-watcher
fi

echo "== origin sanity (localhost, never an asset URL through Cloudflare)"
code=$(curl -sk -o /dev/null -w '%{http_code}' -H 'Host: wallet.beehive.kr' "https://127.0.0.1/?cb=$RANDOM")
echo "origin / -> ${code}"
api=$(curl -sk -H 'Host: wallet.beehive.kr' "https://127.0.0.1/api/announcement_get.php")
echo "announcement_get -> ${api}"

echo "== done: $(readlink /var/www/beehive/current)"
