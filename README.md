<!-- Language: keep this line in sync with README.ko.md -->
**[English](README.md)** · [한국어](README.ko.md)

# 🐝 Beehive Wallet

Non-custodial wallet for the Cosmos ecosystem, starting with **Medibloc (MED)**. Add a
wallet, check balances, send and stake — and get an **alert the moment funds move** on any
address you watch.

**Live:** https://wallet.beehive.kr

## The one rule: your keys never leave your device

Your private keys and seed phrase exist **only in your browser**, encrypted with your
password. Transactions are signed on your device with CosmJS — only the *signed bytes* are
sent out. The server stores public data only (account email, addresses, alarm settings);
nothing in `api/`, `watcher/`, or the database ever sees a key.

**Even if our server were fully compromised, your funds are safe** — there is nothing there
to steal.

## Verify what you're running

Because the browser code is the only thing that could ever touch a key, we make it
checkable:

- **Reproducible builds** — anyone can rebuild a release and get byte-identical files.
- **Published hashes + build provenance** — every release ships SHA-256 hashes and a
  Sigstore attestation tying the files to this public source.
- **In-app badge** — the footer shows `Build <commit> · Verify`, linking the running site to
  its exact commit.

Full steps: **[docs/VERIFYING-THE-BUILD.md](docs/VERIFYING-THE-BUILD.md)**.

> Honest limit: it's a website, so reproducible builds + hashes let anyone *detect*
> tampering, but a web app can't be 100% tamper-proof on its own. We'd rather say so plainly.

## Features

- Non-custodial wallets (create / import), balances, send & receive
- Staking — delegate and claim rewards; **free** to the Beehive validator
- Transaction history
- **Outgoing-transaction alarms** on any watched address — the signature feature
- Chains: Medibloc, Chihuahua

## Tech

- **Frontend:** React 19 · TypeScript · Vite · CosmJS · Tailwind
- **API:** PHP · MySQL
- **Watcher:** a Python daemon that detects outgoing transactions and raises alerts

## Development

```bash
cd app
npm install
npm run dev
```

Backend setup, migrations, and deployment live in [`docs/`](docs/) — see
`deploying-production.md`, `operations.md`, and `schema.sql`.

## Reporting security issues

Please report vulnerabilities **privately** via GitHub Security Advisories rather than
opening a public issue.
