"""Beehive Wallet watcher.

Polls the LCD API for each watched address and inserts a wallet_alert row
whenever a new outgoing transaction is found. Same loop shape as the node
monitor's alarm_bot.py: poll -> compare last seen -> record -> cleanup.

The frontend picks alerts up via alerts_list.php (in-app notifications).
Web push delivery hooks in here later (phase 2).

Usage:
    python watcher.py          # loop forever
    python watcher.py --once   # single pass, for testing
"""

import argparse
import json
import time
from datetime import datetime
from pathlib import Path

import mysql.connector
import requests
from pywebpush import webpush, WebPushException

BASE_DIR = Path(__file__).resolve().parent
DB_CONFIG_FILE = BASE_DIR / "db_config.json"
VAPID_PRIVATE_KEY = BASE_DIR / "vapid_private.pem"
VAPID_CLAIMS = {"sub": "mailto:matanverse@gmail.com"}

POLL_INTERVAL_SECONDS = 30
ALERT_KEEP_DAYS = 90
PAGE_LIMIT = 20
APP_URL = "/wallet/alarms"


def log(level: str, message: str) -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now}] [{level}] {message}", flush=True)


def load_json(path: Path):
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def get_db():
    cfg = load_json(DB_CONFIG_FILE)
    return mysql.connector.connect(
        host=cfg["host"],
        port=int(cfg["port"]),
        user=cfg["user"],
        password=cfg["password"],
        database=cfg["database"],
        autocommit=False,
    )


def load_chains(cursor) -> list:
    """Chains and their active LCD endpoints, straight from the DB (shared with
    the app), so the watcher fails over between endpoints like the frontend."""
    cursor.execute("SELECT * FROM chains WHERE is_active = 1")
    chains = cursor.fetchall()
    cursor.execute(
        "SELECT chain_key, url FROM chain_endpoints "
        "WHERE kind = 'lcd' AND is_active = 1 ORDER BY priority, id"
    )
    endpoints: dict = {}
    for row in cursor.fetchall():
        endpoints.setdefault(row["chain_key"], []).append(row["url"])
    for chain in chains:
        chain["key"] = chain["chain_key"]
        chain["displayDenom"] = chain["display_denom"]
        chain["lcd_endpoints"] = endpoints.get(chain["chain_key"], [])
    return chains


def get_chain(chains: list, key: str):
    for chain in chains:
        if chain["key"] == key:
            return chain
    return None


def fetch_outgoing_txs(chain: dict, address: str) -> list:
    """Newest-first outgoing txs for an address, trying each LCD endpoint in
    order until one answers (failover)."""
    # order_by=2 is ORDER_BY_DESC as a numeric enum - the panacea LCD rejects
    # the string form. It also ignores pagination.limit, so slice client-side.
    params = {
        "events": f"message.sender='{address}'",
        "order_by": "2",
        "pagination.limit": str(PAGE_LIMIT),
    }
    endpoints = chain.get("lcd_endpoints") or []
    if not endpoints:
        raise RuntimeError(f"no LCD endpoints for chain {chain['key']}")

    data = None
    last_error = None
    for base in endpoints:
        try:
            r = requests.get(f"{base.rstrip('/')}/cosmos/tx/v1beta1/txs", params=params, timeout=60)
            r.raise_for_status()
            data = r.json()
            break
        except Exception as e:
            last_error = e
            continue
    if data is None:
        raise RuntimeError(f"all LCD endpoints failed: {last_error}")

    txs = []
    for resp in data.get("tx_responses", [])[:PAGE_LIMIT]:
        amount, denom, recipient = extract_transfer(resp)
        txs.append(
            {
                "hash": resp.get("txhash", ""),
                "height": int(resp.get("height", 0)),
                "timestamp": resp.get("timestamp", ""),
                "amount": amount,
                "denom": denom,
                "recipient": recipient,
            }
        )
    return txs


def extract_transfer(tx_response: dict):
    """Pull the first bank transfer out of a tx. Non-transfer messages
    (delegate, vote, ...) still alert, with amount left empty."""
    try:
        messages = tx_response["tx"]["body"]["messages"]
        for msg in messages:
            if msg.get("@type", "").endswith("MsgSend"):
                coins = msg.get("amount", [])
                if coins:
                    return coins[0].get("amount", ""), coins[0].get("denom", ""), msg.get("to_address", "")
    except (KeyError, TypeError):
        pass
    return "", "", ""


def send_push(cursor, db, user_id: int, title: str, body: str) -> None:
    """Web-push a new alert to every device the user subscribed. Dead
    subscriptions (endpoint gone: 404/410) are cleaned up."""
    if not VAPID_PRIVATE_KEY.exists():
        return

    cursor.execute(
        "SELECT id, endpoint, p256dh, auth_key FROM push_subscriptions WHERE user_id = %s",
        (user_id,),
    )
    subs = cursor.fetchall()

    for sub in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub["endpoint"],
                    "keys": {"p256dh": sub["p256dh"], "auth": sub["auth_key"]},
                },
                data=json.dumps({"title": title, "body": body, "url": APP_URL}),
                vapid_private_key=str(VAPID_PRIVATE_KEY),
                vapid_claims=dict(VAPID_CLAIMS),
                timeout=15,
            )
            log("SUCCESS", f"Push sent to subscription id={sub['id']}")
        except WebPushException as e:
            status = getattr(getattr(e, "response", None), "status_code", None)
            if status in (404, 410):
                cursor.execute("DELETE FROM push_subscriptions WHERE id = %s", (sub["id"],))
                db.commit()
                log("INFO", f"Removed dead push subscription id={sub['id']}")
            else:
                log("ERROR", f"Push failed for subscription id={sub['id']}: {e}")
        except Exception as e:
            log("ERROR", f"Push error for subscription id={sub['id']}: {e}")


def format_push_body(row: dict, tx: dict, chains: list) -> str:
    chain = get_chain(chains, row["chain_key"]) or {}
    label = row.get("label") or f"{row['address'][:14]}..."
    if tx["amount"]:
        decimals = int(chain.get("decimals", 6))
        display = chain.get("displayDenom", tx["denom"])
        value = int(tx["amount"]) / (10 ** decimals)
        return f"{value:g} {display} left {label}"
    return f"Outgoing transaction from {label}"


def process_address(cursor, db, chains: list, row: dict) -> None:
    chain = get_chain(chains, row["chain_key"])
    if chain is None:
        log("WARN", f"watched_addresses id={row['id']} has unknown chain '{row['chain_key']}'")
        return

    try:
        txs = fetch_outgoing_txs(chain, row["address"])
    except Exception as e:
        log("ERROR", f"LCD query failed for {row['address']}: {e}")
        return

    last_seen = row["last_seen_tx_hash"]
    new_txs = []
    for tx in txs:
        if tx["hash"] == last_seen:
            break
        new_txs.append(tx)

    if last_seen is None:
        # First poll: baseline to the newest historic tx so we don't alert on
        # history. An address with NO outgoing history gets the '' sentinel -
        # its first ever outgoing tx (e.g. theft from a cold wallet) DOES alert.
        baseline = txs[0]["hash"] if txs else ""
        cursor.execute(
            "UPDATE watched_addresses SET last_seen_tx_hash = %s, last_checked_at = NOW() WHERE id = %s",
            (baseline, row["id"]),
        )
        db.commit()
        log("INFO", f"Baseline set for {row['address']} at {baseline[:12] or '<empty>'}")
        return

    if not txs:
        cursor.execute(
            "UPDATE watched_addresses SET last_checked_at = NOW() WHERE id = %s",
            (row["id"],),
        )
        db.commit()
        return

    for tx in reversed(new_txs):
        if int(row["alarm_enabled"]) == 1:
            cursor.execute(
                """
                INSERT INTO wallet_alerts
                    (watched_address_id, tx_hash, amount, denom, recipient, detected_at, is_read)
                VALUES (%s, %s, %s, %s, %s, NOW(), 0)
                """,
                (row["id"], tx["hash"], tx["amount"], tx["denom"], tx["recipient"]),
            )
            log("SUCCESS", f"Alert: {row['address']} sent tx {tx['hash'][:12]}")
            send_push(
                cursor,
                db,
                int(row["user_id"]),
                "Wallet alarm",
                format_push_body(row, tx, chains),
            )

    cursor.execute(
        "UPDATE watched_addresses SET last_seen_tx_hash = %s, last_checked_at = NOW() WHERE id = %s",
        (txs[0]["hash"], row["id"]),
    )
    db.commit()


def cleanup(cursor, db) -> None:
    cursor.execute(
        "DELETE FROM wallet_alerts WHERE is_read = 1 AND detected_at < NOW() - INTERVAL %s DAY",
        (ALERT_KEEP_DAYS,),
    )
    db.commit()


def run_once() -> None:
    db = get_db()
    cursor = db.cursor(dictionary=True)
    try:
        chains = load_chains(cursor)
        cleanup(cursor, db)
        cursor.execute("SELECT * FROM watched_addresses ORDER BY id")
        rows = cursor.fetchall()
        log("INFO", f"Checking {len(rows)} watched address(es).")
        for row in rows:
            process_address(cursor, db, chains, row)
    finally:
        cursor.close()
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="Run once and exit.")
    args = parser.parse_args()

    if args.once:
        run_once()
        return

    log("INFO", f"Wallet watcher started. Interval={POLL_INTERVAL_SECONDS}s")
    while True:
        try:
            run_once()
        except Exception as e:
            log("ERROR", f"Watcher loop error: {e}")
        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
