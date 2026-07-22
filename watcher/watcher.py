"""Beehive Wallet watcher.

Polls the LCD API for each watched address and inserts a wallet_alert row
whenever a new transaction matching the address's alarm_type is found.
Same loop shape as the node monitor's alarm_bot.py: poll -> compare last
seen -> record -> cleanup.

Each address chooses an alarm_type:
    sent      outgoing transactions (address signs / spends)
    received  incoming transfers from someone else
    both      sent + received
    unbond    undelegation (MsgUndelegate) started by the address

Every direction keeps its own "last seen" cursor so first contact only
baselines (no history spam) and directions don't clobber each other.

The frontend picks alerts up via alerts_list.php (in-app notifications) and
web push is delivered from here.

Usage:
    python watcher.py          # loop forever
    python watcher.py --once   # single pass, for testing
"""

import argparse
import base64
import hashlib
import json
import signal
import time
from datetime import datetime, timedelta
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
# Relative alert paths. The service worker resolves these against its own
# registration scope, so they work at both "/" (subdomain) and "/wallet/".
APP_URL = "alarms"
UPTIME_URL = "uptime"

# Per-direction LCD event filter and the watched_addresses column that tracks
# the newest tx already handled for that direction. Column names are fixed
# here (never user input), so interpolating them into SQL is safe.
DIRECTIONS = {
    "sent": {"event": "message.sender='{a}'", "col": "last_seen_tx_hash"},
    "received": {"event": "transfer.recipient='{a}'", "col": "last_seen_received_tx"},
    "unbond": {"event": "message.sender='{a}'", "col": "last_seen_unbond_tx"},
}

# alarm_type -> directions to poll.
ALARM_DIRECTIONS = {
    "sent": ["sent"],
    "received": ["received"],
    "both": ["sent", "received"],
    "unbond": ["unbond"],
}

# Per-cycle observability counters (reset at the start of each run_once).
METRICS: dict = {}


def reset_metrics() -> None:
    METRICS.clear()
    METRICS.update(
        {
            "addresses": 0,
            "chain_ok": 0,
            "chain_errors": 0,
            "alerts": 0,
            "cursor_gaps": 0,
            "push_ok": 0,
            "push_fail": 0,
        }
    )


def m(key: str, n: int = 1) -> None:
    METRICS[key] = METRICS.get(key, 0) + n


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


# Safety cap on pagination: how many pages deep we look for the cursor before
# declaring a cursor gap. PAGE_LIMIT * MAX_PAGES is the backlog we can absorb in
# one poll (>> anything a single address realistically produces between polls).
MAX_PAGES = 10


def fetch_tx_page(chain: dict, address: str, event_tpl: str, offset: int) -> list:
    """One newest-first page of raw tx_responses for an address/event filter,
    trying each LCD endpoint in order until one answers (failover)."""
    # order_by=2 is ORDER_BY_DESC as a numeric enum - the panacea LCD rejects the
    # string form. pagination.offset walks older pages.
    params = {
        "events": event_tpl.format(a=address),
        "order_by": "2",
        "pagination.limit": str(PAGE_LIMIT),
        "pagination.offset": str(offset),
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

    return data.get("tx_responses", [])


def collect_new(pairs: list, last_seen: str):
    """Pure cursor logic. `pairs` is newest-first [(hash, resp), ...].
    Returns (new_pairs_newest_first, found) where found is True once `last_seen`
    is reached. When last_seen is the '' sentinel it is never matched, so every
    tx is 'new' - the caller handles exhaustion vs. a real gap."""
    new = []
    for h, resp in pairs:
        if h == last_seen:
            return new, True
        new.append((h, resp))
    return new, False


def fetch_new_since(chain: dict, address: str, event_tpl: str, last_seen: str):
    """Paginate newest-first until the cursor is found, history is exhausted, or
    the safety cap is hit. Returns (new_pairs_newest_first, found). found=False
    means a cursor GAP: an ESTABLISHED cursor could not be located, so we must
    not advance past a range we may never have read."""
    new_pairs = []
    offset = 0
    prev_first = None
    # '' is the first-contact sentinel: there is no established cursor yet, so
    # running out of history is the expected end of a baseline pass.
    initial = last_seen == ""
    for _ in range(MAX_PAGES):
        page = fetch_tx_page(chain, address, event_tpl, offset)
        if not page:
            # Ran out of history. With no cursor yet this is a normal baseline.
            # With an ESTABLISHED cursor it means the cursor is gone - pruned by
            # the provider or orphaned by a reorg - which is a real gap: we
            # cannot prove we saw everything between it and here.
            return new_pairs, initial
        pairs = [(r.get("txhash", ""), r) for r in page]
        # Guard against an LCD that ignores offset and returns the same page.
        if prev_first is not None and pairs and pairs[0][0] == prev_first:
            break
        prev_first = pairs[0][0] if pairs else prev_first
        chunk, found = collect_new(pairs, last_seen)
        new_pairs.extend(chunk)
        if found:
            return new_pairs, True
        offset += len(pairs)
    return new_pairs, False  # cap or stuck-pagination -> gap


def messages_of(resp: dict) -> list:
    try:
        return resp["tx"]["body"]["messages"] or []
    except (KeyError, TypeError):
        return []


def _to_int(x) -> int:
    try:
        return int(str(x))
    except (ValueError, TypeError):
        return 0


def classify_sent(resp: dict, address: str, denom: str):
    """Any tx the address signed alarms. Amount is the exact total sent in the
    chain denom across ALL MsgSend/MsgMultiSend outputs from this address - not
    just the first coin of the first message - so multi-message and multi-coin
    txs are not under-reported."""
    total = 0
    recipient = ""
    for msg in messages_of(resp):
        t = msg.get("@type", "")
        if t.endswith("MsgSend") and msg.get("from_address") == address:
            for coin in msg.get("amount", []):
                if coin.get("denom") == denom:
                    total += _to_int(coin.get("amount"))
            recipient = recipient or msg.get("to_address", "")
        elif t.endswith("MsgMultiSend"):
            for inp in msg.get("inputs", []):
                if inp.get("address") == address:
                    for coin in inp.get("coins", []):
                        if coin.get("denom") == denom:
                            total += _to_int(coin.get("amount"))
            outs = msg.get("outputs", [])
            recipient = recipient or (outs[0].get("address", "") if outs else "")
    amount = str(total) if total > 0 else ""
    return True, amount, denom if amount else "", recipient


def classify_received(resp: dict, address: str, denom: str):
    """Genuine incoming transfers only (someone else -> address). Sums every
    MsgSend/MsgMultiSend output to this address in the chain denom. Reward claims
    (no MsgSend to the address) never match, so they are not seen as income."""
    total = 0
    sender = ""
    for msg in messages_of(resp):
        t = msg.get("@type", "")
        if t.endswith("MsgSend") and msg.get("to_address") == address and msg.get("from_address") != address:
            for coin in msg.get("amount", []):
                if coin.get("denom") == denom:
                    total += _to_int(coin.get("amount"))
            sender = sender or msg.get("from_address", "")
        elif t.endswith("MsgMultiSend"):
            got = False
            for out in msg.get("outputs", []):
                if out.get("address") == address:
                    for coin in out.get("coins", []):
                        if coin.get("denom") == denom:
                            total += _to_int(coin.get("amount"))
                    got = True
            if got:
                ins = msg.get("inputs", [])
                sender = sender or (ins[0].get("address", "") if ins else "")
    if total > 0:
        return True, str(total), denom, sender
    return False, "", "", ""


def classify_unbond(resp: dict, address: str, denom: str):
    """Undelegation(s) started by the address. Amount is the summed unbonded total
    in the chain denom; counterparty is the (last) validator."""
    total = 0
    validator = ""
    matched = False
    for msg in messages_of(resp):
        if msg.get("@type", "").endswith("MsgUndelegate") and msg.get("delegator_address") == address:
            matched = True
            coin = msg.get("amount", {}) or {}
            if coin.get("denom") == denom:
                total += _to_int(coin.get("amount"))
            validator = msg.get("validator_address", validator)
    if matched:
        return True, str(total) if total > 0 else "", denom if total > 0 else "", validator
    return False, "", "", ""


CLASSIFY = {
    "sent": classify_sent,
    "received": classify_received,
    "unbond": classify_unbond,
}


def send_push(cursor, db, user_id: int, title: str, body: str, url: str = APP_URL) -> None:
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
                data=json.dumps({"title": title, "body": body, "url": url}),
                vapid_private_key=str(VAPID_PRIVATE_KEY),
                vapid_claims=dict(VAPID_CLAIMS),
                timeout=15,
            )
            m("push_ok")
            log("SUCCESS", f"Push sent to subscription id={sub['id']}")
        except WebPushException as e:
            m("push_fail")
            status = getattr(getattr(e, "response", None), "status_code", None)
            if status in (404, 410):
                cursor.execute("DELETE FROM push_subscriptions WHERE id = %s", (sub["id"],))
                db.commit()
                log("INFO", f"Removed dead push subscription id={sub['id']}")
            else:
                log("ERROR", f"Push failed for subscription id={sub['id']}: {e}")
        except Exception as e:
            m("push_fail")
            log("ERROR", f"Push error for subscription id={sub['id']}: {e}")


def format_push_body(row: dict, kind: str, amount: str, denom: str, chains: list) -> str:
    chain = get_chain(chains, row["chain_key"]) or {}
    label = row.get("label") or f"{row['address'][:14]}..."
    value = ""
    if amount:
        decimals = int(chain.get("decimals", 6))
        display = chain.get("displayDenom", denom)
        value = f"{int(amount) / (10 ** decimals):g} {display}"
    if kind == "received":
        return f"{value} received by {label}".strip() if value else f"Incoming transaction to {label}"
    if kind == "unbond":
        return f"Unbonding {value} started from {label}".strip() if value else f"Unbonding started from {label}"
    return f"{value} left {label}".strip() if value else f"Outgoing transaction from {label}"


def process_direction(cursor, db, chains: list, row: dict, kind: str) -> None:
    chain = get_chain(chains, row["chain_key"])
    if chain is None:
        log("WARN", f"watched_addresses id={row['id']} has unknown chain '{row['chain_key']}'")
        return

    cfg = DIRECTIONS[kind]
    col = cfg["col"]
    denom = chain.get("denom", "")
    last_seen = row.get(col)

    if last_seen is None:
        # First contact for this direction: baseline to the current tip so we
        # don't alert on history. Empty history keeps the '' sentinel, so the
        # first ever matching tx still alerts.
        try:
            page = fetch_tx_page(chain, row["address"], cfg["event"], 0)
        except Exception as e:
            log("ERROR", f"LCD query ({kind}) failed for {row['address']}: {e}")
            m("chain_errors")
            return
        m("chain_ok")
        baseline = page[0].get("txhash", "") if page else ""
        cursor.execute(
            f"UPDATE watched_addresses SET {col} = %s, last_checked_at = NOW() WHERE id = %s",
            (baseline, row["id"]),
        )
        db.commit()
        log("INFO", f"Baseline ({kind}) set for {row['address']} at {baseline[:12] or '<empty>'}")
        return

    # Paginate newest-first until we reach the cursor (or exhaust / hit the cap).
    try:
        new_pairs, found = fetch_new_since(chain, row["address"], cfg["event"], last_seen)
    except Exception as e:
        log("ERROR", f"LCD query ({kind}) failed for {row['address']}: {e}")
        m("chain_errors")
        return
    m("chain_ok")

    # Oldest-first so alert ids follow on-chain order.
    for h, resp in reversed(new_pairs):
        matched, amount, dnm, counterparty = CLASSIFY[kind](resp, row["address"], denom)
        if matched and int(row["alarm_enabled"]) == 1:
            cursor.execute(
                """
                INSERT IGNORE INTO wallet_alerts
                    (watched_address_id, kind, tx_hash, amount, denom, recipient, detected_at, is_read)
                VALUES (%s, %s, %s, %s, %s, %s, NOW(), 0)
                """,
                (row["id"], kind, h, amount, dnm, counterparty),
            )
            if cursor.rowcount > 0:  # a fresh alert, not a duplicate
                m("alerts")
                log("SUCCESS", f"Alert ({kind}): {row['address']} tx {h[:12]}")
                send_push(
                    cursor,
                    db,
                    int(row["user_id"]),
                    "Wallet alarm",
                    format_push_body(row, kind, amount, dnm, chains),
                )

    if found:
        # Advance to the current tip: newest of the new txs, or unchanged if none.
        newest = new_pairs[0][0] if new_pairs else last_seen
        cursor.execute(
            f"UPDATE watched_addresses SET {col} = %s, last_checked_at = NOW() WHERE id = %s",
            (newest, row["id"]),
        )
    else:
        # CURSOR GAP: last_seen was not reached within MAX_PAGES. Do NOT advance -
        # that would silently skip everything between the fetched window and the
        # cursor. Alerts we could see are already recorded (deduped by the unique
        # (watched_address_id, tx_hash) constraint). Recovery: an operator raises
        # MAX_PAGES or resets this address's cursor after investigating.
        m("cursor_gaps")
        log(
            "ERROR",
            f"CURSOR GAP ({kind}) for {row['address']}: last_seen "
            f"{str(last_seen)[:12] or '<empty>'} not found within {MAX_PAGES} pages; cursor NOT advanced",
        )
        cursor.execute(
            "UPDATE watched_addresses SET last_checked_at = NOW() WHERE id = %s",
            (row["id"],),
        )
    db.commit()


def process_address(cursor, db, chains: list, row: dict) -> None:
    for kind in ALARM_DIRECTIONS.get(row.get("alarm_type") or "both", ["sent", "received"]):
        process_direction(cursor, db, chains, row, kind)


# ---------------------------------------------------------------------------
# Validator uptime monitoring (paid feature, super-admin gated).
# ---------------------------------------------------------------------------

BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"


def _bech32_polymod(values):
    generator = [0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3]
    chk = 1
    for value in values:
        top = chk >> 25
        chk = (chk & 0x1FFFFFF) << 5 ^ value
        for i in range(5):
            chk ^= generator[i] if ((top >> i) & 1) else 0
    return chk


def _bech32_hrp_expand(hrp):
    return [ord(x) >> 5 for x in hrp] + [0] + [ord(x) & 31 for x in hrp]


def _bech32_create_checksum(hrp, data):
    values = _bech32_hrp_expand(hrp) + data
    polymod = _bech32_polymod(values + [0, 0, 0, 0, 0, 0]) ^ 1
    return [(polymod >> 5 * (5 - i)) & 31 for i in range(6)]


def _bech32_encode(hrp, data):
    combined = data + _bech32_create_checksum(hrp, data)
    return hrp + "1" + "".join([BECH32_CHARSET[d] for d in combined])


def _convertbits(data, frombits, tobits, pad=True):
    acc = 0
    bits = 0
    ret = []
    maxv = (1 << tobits) - 1
    max_acc = (1 << (frombits + tobits - 1)) - 1
    for value in data:
        if value < 0 or (value >> frombits):
            return None
        acc = ((acc << frombits) | value) & max_acc
        bits += frombits
        while bits >= tobits:
            bits -= tobits
            ret.append((acc >> bits) & maxv)
    if pad and bits:
        ret.append((acc << (tobits - bits)) & maxv)
    return ret


def pubkey_to_valcons(pubkey_b64: str, hrp: str) -> str:
    """ed25519 consensus pubkey -> valcons bech32 address:
    first 20 bytes of sha256(pubkey), bech32-encoded with the valcons HRP."""
    raw = base64.b64decode(pubkey_b64)
    addr = hashlib.sha256(raw).digest()[:20]
    return _bech32_encode(hrp, _convertbits(list(addr), 8, 5))


def lcd_get(chain: dict, path: str, params: dict | None = None) -> dict:
    """GET an LCD path with endpoint failover. Raises if all endpoints fail."""
    endpoints = chain.get("lcd_endpoints") or []
    if not endpoints:
        raise RuntimeError(f"no LCD endpoints for chain {chain['key']}")
    last_error = None
    for base in endpoints:
        try:
            r = requests.get(f"{base.rstrip('/')}{path}", params=params or {}, timeout=30)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            last_error = e
            continue
    raise RuntimeError(f"all LCD endpoints failed: {last_error}")


def get_setting(cursor, key: str, default: str = "0") -> str:
    cursor.execute("SELECT setting_value FROM app_settings WHERE setting_key = %s", (key,))
    row = cursor.fetchone()
    return row["setting_value"] if row else default


def fetch_validator_map(chain: dict) -> dict:
    """operator_address -> {pubkey, moniker, jailed} for every validator."""
    data = lcd_get(chain, "/cosmos/staking/v1beta1/validators", {"pagination.limit": "500"})
    out = {}
    for v in data.get("validators", []):
        pk = (v.get("consensus_pubkey") or {}).get("key", "")
        out[v.get("operator_address", "")] = {
            "pubkey": pk,
            "moniker": (v.get("description") or {}).get("moniker", ""),
            "jailed": bool(v.get("jailed")),
        }
    return out


def fetch_signing_info(chain: dict, valcons: str):
    try:
        data = lcd_get(chain, f"/cosmos/slashing/v1beta1/signing_infos/{valcons}")
    except Exception as e:
        log("ERROR", f"signing_info failed for {valcons}: {e}")
        return None
    info = data.get("val_signing_info") or {}
    if not info:
        return None
    return {
        "missed": int(info.get("missed_blocks_counter", 0) or 0),
        "tombstoned": bool(info.get("tombstoned")),
    }


def uptime_push_body(sub: dict, kind: str, missed: int) -> str:
    name = sub.get("moniker") or sub["validator_address"][:16] + "..."
    if kind == "recovered":
        return f"{name} is signing blocks again."
    return f"{name} is missing blocks ({missed})."


def evaluate_uptime(cursor, db, sub: dict, down: bool, missed: int) -> None:
    now = datetime.now()
    was_down = int(sub["last_down_state"]) == 1
    snoozed = sub["snooze_until"] is not None and sub["snooze_until"] > now

    if down:
        due = sub["last_alert_at"] is None or (
            now - sub["last_alert_at"]
        ) >= timedelta(minutes=int(sub["frequency_minutes"]))
        if not snoozed and due:
            cursor.execute(
                "INSERT INTO uptime_alerts (subscription_id, kind, missed_blocks, detected_at, is_read) "
                "VALUES (%s, 'down', %s, NOW(), 0)",
                (sub["id"], missed),
            )
            cursor.execute(
                "UPDATE uptime_subscriptions SET last_alert_at = NOW(), last_down_state = 1, "
                "last_missed = %s WHERE id = %s",
                (missed, sub["id"]),
            )
            log("SUCCESS", f"Uptime alert (down): sub={sub['id']} {sub['validator_address']} missed={missed}")
            send_push(cursor, db, int(sub["user_id"]), "Validator uptime",
                      uptime_push_body(sub, "down", missed), UPTIME_URL)
        else:
            cursor.execute(
                "UPDATE uptime_subscriptions SET last_down_state = 1, last_missed = %s WHERE id = %s",
                (missed, sub["id"]),
            )
    else:
        if was_down:
            cursor.execute(
                "INSERT INTO uptime_alerts (subscription_id, kind, missed_blocks, detected_at, is_read) "
                "VALUES (%s, 'recovered', %s, NOW(), 0)",
                (sub["id"], missed),
            )
            log("SUCCESS", f"Uptime alert (recovered): sub={sub['id']} {sub['validator_address']}")
            send_push(cursor, db, int(sub["user_id"]), "Validator uptime",
                      uptime_push_body(sub, "recovered", missed), UPTIME_URL)
        cursor.execute(
            "UPDATE uptime_subscriptions SET last_down_state = 0, last_alert_at = NULL, "
            "last_missed = %s WHERE id = %s",
            (missed, sub["id"]),
        )
    db.commit()


def process_uptime(cursor, db, chains: list) -> None:
    """Poll approved+active uptime subscriptions and raise down/recovered alerts."""
    if get_setting(cursor, "uptime_alerts_enabled", "0") != "1":
        return

    cursor.execute(
        "SELECT * FROM uptime_subscriptions WHERE status = 'approved' "
        "AND (authorized_until IS NULL OR authorized_until > NOW())"
    )
    subs = cursor.fetchall()
    if not subs:
        return

    log("INFO", f"Uptime: checking {len(subs)} subscription(s).")
    valmaps: dict = {}
    for sub in subs:
        chain = get_chain(chains, sub["chain_key"])
        if chain is None:
            continue
        if sub["chain_key"] not in valmaps:
            try:
                valmaps[sub["chain_key"]] = fetch_validator_map(chain)
            except Exception as e:
                log("ERROR", f"Uptime: validator list failed for {sub['chain_key']}: {e}")
                valmaps[sub["chain_key"]] = {}
        vinfo = valmaps[sub["chain_key"]].get(sub["validator_address"])
        if not vinfo or not vinfo["pubkey"]:
            continue
        try:
            valcons = pubkey_to_valcons(vinfo["pubkey"], chain["bech32_prefix"] + "valcons")
        except Exception as e:
            log("ERROR", f"Uptime: valcons derivation failed for {sub['validator_address']}: {e}")
            continue
        info = fetch_signing_info(chain, valcons)
        if info is None:
            continue
        missed = info["missed"]
        down = missed >= int(sub["miss_threshold"]) or vinfo["jailed"] or info["tombstoned"]
        evaluate_uptime(cursor, db, sub, down, missed)


def cleanup(cursor, db) -> None:
    cursor.execute(
        "DELETE FROM wallet_alerts WHERE is_read = 1 AND detected_at < NOW() - INTERVAL %s DAY",
        (ALERT_KEEP_DAYS,),
    )
    db.commit()
    try:
        cursor.execute(
            "DELETE FROM uptime_alerts WHERE is_read = 1 AND detected_at < NOW() - INTERVAL %s DAY",
            (ALERT_KEEP_DAYS,),
        )
        db.commit()
    except Exception:
        db.rollback()  # uptime tables may not exist yet (migration 003)


def run_once() -> None:
    reset_metrics()
    started = time.monotonic()
    db = get_db()
    cursor = db.cursor(dictionary=True)
    try:
        chains = load_chains(cursor)
        cleanup(cursor, db)
        cursor.execute("SELECT * FROM watched_addresses ORDER BY id")
        rows = cursor.fetchall()
        METRICS["addresses"] = len(rows)
        log("INFO", f"Checking {len(rows)} watched address(es).")
        for row in rows:
            process_address(cursor, db, chains, row)
        try:
            process_uptime(cursor, db, chains)
        except Exception as e:
            db.rollback()
            log("ERROR", f"Uptime pass error: {e}")

        # Backlog = watched addresses not checked in the last 2 polls (stale).
        try:
            cursor.execute(
                "SELECT COUNT(*) AS n FROM watched_addresses "
                "WHERE last_checked_at IS NULL OR last_checked_at < NOW() - INTERVAL %s SECOND",
                (POLL_INTERVAL_SECONDS * 2,),
            )
            METRICS["backlog"] = int(cursor.fetchone()["n"])
        except Exception:
            METRICS["backlog"] = -1
    finally:
        cursor.close()
        db.close()

    METRICS["duration_ms"] = int((time.monotonic() - started) * 1000)
    level = "ERROR" if (METRICS.get("cursor_gaps") or METRICS.get("chain_errors")) else "INFO"
    log(
        level,
        "cycle metrics: "
        + " ".join(f"{k}={METRICS[k]}" for k in sorted(METRICS)),
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="Run once and exit.")
    args = parser.parse_args()

    if args.once:
        run_once()
        return

    # Graceful shutdown. NSSM stops the service by sending Ctrl+C, which lands
    # as a KeyboardInterrupt - almost always inside the sleep below - and used
    # to dump a traceback to watcher_stderr.log on every single restart. That
    # noise is worse than untidy: it camouflages real faults, since a genuine
    # crash looks much the same at a glance. Note KeyboardInterrupt is a
    # BaseException, so the `except Exception` inside the loop never caught it.
    stopping = False

    def _request_stop(_signum, _frame):
        nonlocal stopping
        stopping = True

    # SIGTERM is handled too, in case the service is reconfigured to use it.
    # Not available in every context, so failure to register is non-fatal.
    try:
        signal.signal(signal.SIGTERM, _request_stop)
    except (ValueError, AttributeError, OSError):
        pass

    log("INFO", f"Wallet watcher started. Interval={POLL_INTERVAL_SECONDS}s")
    try:
        while not stopping:
            try:
                run_once()
            except Exception as e:
                log("ERROR", f"Watcher loop error: {e}")
            # Sleep in one-second slices so a stop is noticed promptly instead
            # of after a full poll interval - otherwise NSSM waits out its
            # timeout and hard-kills the process mid-cycle.
            for _ in range(POLL_INTERVAL_SECONDS):
                if stopping:
                    break
                time.sleep(1)
    except KeyboardInterrupt:
        stopping = True

    log("INFO", "Wallet watcher stopped cleanly.")


if __name__ == "__main__":
    main()
