# Beehive Wallet

Non-custodial web wallet for Cosmos chains run by Beehive validators, starting with
Medibloc. Successor niche to Cosmostation: add a wallet, stake (free to Beehive),
see history, send - plus outgoing-transaction alarms on any watched address.

## Security model (the one rule)

Private keys and seed phrases exist ONLY in the user's browser, encrypted with the
user's password. Transactions are signed client-side with CosmJS; only signed bytes
leave the device. The server stores public data only: emails, addresses, alarm
settings, alerts. Nothing in `api/`, `watcher/`, or the database ever handles a key.

## Layout

| Folder     | What                                            | Runs where                        |
|------------|--------------------------------------------------|-----------------------------------|
| `app/`     | React + TypeScript + CosmJS + Tailwind frontend | Built to static files, Apache     |
| `api/`     | PHP endpoints (accounts, watchlist, alerts)     | Apache + MySQL                    |
| `watcher/` | Python daemon detecting outgoing txs            | Any server with DB + LCD access   |
| `config/`  | Chain registry shared by api + watcher          | Copied on deploy                  |
| `docs/`    | `schema.sql`, notes                             | -                                 |

## Development

```
cd app
npm install
npm run dev        # http://localhost:5173, /api proxied to local Apache
```

Backend setup (once):
1. Run `docs/schema.sql` in MySQL.
2. Copy `api/db_config.php.example` to `api/db_config.php` and fill in.
3. Copy `watcher/db_config.json.example` to `watcher/db_config.json` and fill in.
4. `pip install -r watcher/requirements.txt`, then `python watcher/watcher.py --once`.

## Deploy (dev server)

Build and copy to Apache; site is served at beehive.achumuamah.com
(vhost DocumentRoot: `D:/WebServer/Apache24/beeweb/wallet`):

```
cd app && npm run build
robocopy app\dist D:\WebServer\Apache24\beeweb\wallet /MIR /XD api
robocopy api D:\WebServer\Apache24\beeweb\wallet\api /MIR /XF db_config.php.example
copy config\chains.json D:\WebServer\Apache24\beeweb\wallet\api\chains.json
```

(`db_config.php` on the server is created once by hand and never overwritten by deploy.)

## Endpoints (target: our own nodes)

`app/src/chains.ts` and `config/chains.json` currently point at public Medibloc
endpoints for development. Before launch, switch to our Vultr Seoul app node behind
`rpc-medi.achumuamah.com` / `lcd-medi.achumuamah.com`. The validator node stays
private - the app never talks to it.

## Roadmap

1. Phase 1 - read-only wallet + watcher alarms (in-app notifications)
2. Phase 2 - key create/import + send (client-side signing), web push
3. Phase 3 - staking UI, Beehive pinned free
4. Phase 4 - more chains (rizon, chihuahua, ...) as config entries
