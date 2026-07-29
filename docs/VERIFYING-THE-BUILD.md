# Verifying the Beehive Wallet build

Beehive Wallet is **non-custodial**: your keys never leave your browser. The only
code that could ever touch a key is the **frontend JavaScript your browser runs**.
This page lets anyone confirm that the app served at https://wallet.beehive.kr was
built from this public source, with no hidden changes.

## How it works, in one line

Our build is **reproducible** — building the same commit always produces
byte-identical files. Every release publishes those files' SHA-256 hashes, and
GitHub cryptographically attests that they came from this repo. So you can rebuild
it yourself and confirm the hashes match.

## What each release publishes

- **`build-manifest.json`** — the source commit, a single whole-bundle `bundleHash`,
  and a SHA-256 for every file.
- **`SHA256SUMS.txt`** — the same per-file hashes in the standard `sha256sum` format.
- **A build-provenance attestation** — a signed statement (GitHub / Sigstore) that
  these exact files were produced by our GitHub Actions workflow from that commit:
  ```
  gh attestation verify beehive-wallet-<tag>.zip --repo achuchavo/beehive-wallet
  ```

## Quick check: does the LIVE site match a release?

The running build shows its commit in the footer ("Build `abcdef1`"). Then:

1. Open that release and download its `build-manifest.json`.
2. Hash a file the live site is serving, e.g.:
   ```
   curl -s https://wallet.beehive.kr/index.html | sha256sum
   curl -s https://wallet.beehive.kr/assets/<name>.js | sha256sum
   ```
3. Confirm each hash appears in `build-manifest.json`. If they all match, the live
   site is serving exactly the published, open-source build.

## Full check: reproduce the build yourself

Use Linux or macOS (or WSL on Windows) to match our CI, and the Node version pinned
in `.nvmrc`.

```
git clone https://github.com/achuchavo/beehive-wallet
cd beehive-wallet
git checkout <release-tag>              # e.g. v0.1.0
nvm install && nvm use                  # uses .nvmrc (Node pinned)
cd app
npm ci                                  # exact dependencies from the lockfile
VITE_BASE=/ VITE_SITE_URL=https://wallet.beehive.kr npm run build
node scripts/gen-build-manifest.mjs
cat dist/build-manifest.json            # compare "bundleHash" to the release's
```

A matching `bundleHash` means your build is byte-identical to what we published —
which you can then compare against what the live site serves (the quick check above).

## The honest limitation

Because this is a website, whoever operates it ultimately controls the bytes sent to
each visitor. Reproducible builds + published hashes let anyone **detect** tampering,
but a fully airtight guarantee would need a channel the operator can't silently change
(for example a signed browser extension). We'd rather state this plainly than pretend
a web app is impossible to tamper with.

> Note: `bundleHash` covers every file **except** `build-manifest.json` and
> `SHA256SUMS.txt` themselves.
