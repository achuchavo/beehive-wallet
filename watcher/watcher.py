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

BASE_DIR = Path(__file__).resolve().parent
DB_CONFIG_FILE = BASE_DIR / "db_config.json"
CHAINS_FILE = BASE_DIR.parent / "config" / "chains.json"

POLL_INTERVAL_SECONDS = 30
ALERT_KEEP_DAYS = 90
PAGE_LIMIT = 20


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


def get_chain(chains: list, key: str):
    for chain in chains:
        if chain["key"] == key:
            return chain
    return None


def fetch_outgoing_txs(chain: dict, address: str) -> list:
    """Newest-first outgoing txs for an address from the LCD tx search API."""
    url = f"{chain['lcd']}/cosmos/tx/v1beta1/txs"
    params = {
        "events": f"message.sender='{address}'",
        "order_by": "ORDER_BY_DESC",
        "pagination.limit": str(PAGE_LIMIT),
    }
    r = requests.get(url, params=params, timeout=20)
    r.raise_for_status()
    data = r.json()

    txs = []
    for resp in data.get("tx_responses", []):
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

    if not txs:
        return

    if last_seen is None:
        # First poll for this address: set the baseline, do not alert on history.
        cursor.execute(
            "UPDATE watched_addresses SET last_seen_tx_hash = %s, last_checked_at = NOW() WHERE id = %s",
            (txs[0]["hash"], row["id"]),
        )
        db.commit()
        log("INFO", f"Baseline set for {row['address']} at {txs[0]['hash'][:12]}")
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
    chains = load_json(CHAINS_FILE)
    db = get_db()
    cursor = db.cursor(dictionary=True)
    try:
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
