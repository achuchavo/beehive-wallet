"""Read-only preflight for the cursor-gap change (audit #15).

Runs the CURRENT fetch_new_since() against the LIVE LCD using the REAL cursors
stored in the database, and reports whether each direction resolves normally or
would now be reported as a CURSOR GAP. Writes nothing: no UPDATEs, no alerts,
no push. Safe to run while the service is running.

    watcher\\venv\\Scripts\\python.exe dryrun_cursors.py
"""

import watcher


def short(v):
    if v is None:
        return "NULL(baseline pending)"
    if v == "":
        return "''(sentinel)"
    return v[:10] + "..."


def main() -> None:
    db = watcher.get_db()
    cursor = db.cursor(dictionary=True)
    try:
        chains = watcher.load_chains(cursor)
        cursor.execute("SELECT * FROM watched_addresses ORDER BY id")
        rows = cursor.fetchall()
        print(f"Checking {len(rows)} watched address(es) - READ ONLY\n")

        gaps = 0
        for row in rows:
            chain = watcher.get_chain(chains, row["chain_key"])
            if chain is None:
                print(f"id={row['id']}: chain {row['chain_key']} not configured, skipping")
                continue

            directions = watcher.ALARM_DIRECTIONS.get(row.get("alarm_type") or "both",
                                                      ["sent", "received"])
            print(f"id={row['id']} {row['address'][:16]}... type={row.get('alarm_type')}")
            for kind in directions:
                cfg = watcher.DIRECTIONS[kind]
                last_seen = row.get(cfg["col"])
                if last_seen is None:
                    print(f"    {kind:9s} cursor={short(last_seen)} -> would baseline (no fetch)")
                    continue
                try:
                    new_pairs, found = watcher.fetch_new_since(
                        chain, row["address"], cfg["event"], last_seen
                    )
                except Exception as e:
                    print(f"    {kind:9s} cursor={short(last_seen)} -> LCD ERROR: {e}")
                    continue

                if found:
                    verdict = f"OK, cursor located, {len(new_pairs)} new tx pending"
                else:
                    verdict = f"*** CURSOR GAP *** ({len(new_pairs)} fetched, cursor NOT found)"
                    gaps += 1
                print(f"    {kind:9s} cursor={short(last_seen)} -> {verdict}")
            print()

        print(f"RESULT: {gaps} cursor gap(s) detected.")
        if gaps == 0:
            print("Restarting the service will not trigger any new gap handling.")
        else:
            print("Investigate before restarting: those cursors would stop advancing.")
    finally:
        cursor.close()
        db.close()


if __name__ == "__main__":
    main()
