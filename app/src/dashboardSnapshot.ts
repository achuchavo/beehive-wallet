// Last-known dashboard figures, so returning to the app shows the numbers you
// left rather than an empty screen while every chain is queried again.
//
// This is a CACHE, never a source of truth. Two rules stop it becoming a wrong
// number presented as fact:
//   - the UI labels it as a snapshot until live data replaces it;
//   - a chain is only ever written when EVERY wallet on it loaded cleanly, so a
//     partial total can never become the baseline a later delta is measured
//     against (that would invent a gain out of a failed request).
//
// Per-wallet rows are stored rather than per-chain totals, so the dashboard's
// existing grouping and BigInt summing run over them unchanged.
//
// No key material is involved: these are public balances for addresses already
// stored in this browser. It is still financial data at rest, so the payload is
// versioned by its storage key and discarded wholesale if it fails validation.

const KEY = 'beehive_dash_snapshot_v1'

export interface SnapshotRow {
  name: string
  chainKey: string
  address: string
  /** Base-unit integer strings. */
  available: string
  staked: string
  rewards: string
  commission: string
  isValidator: boolean
}

export interface DashboardSnapshot {
  savedAt: string
  rows: SnapshotRow[]
}

const isBase = (v: unknown): v is string => typeof v === 'string' && /^\d+$/.test(v)

/**
 * Read and fully validate. localStorage is user-writable and outlives app
 * versions, so anything unexpected discards the whole snapshot rather than
 * letting a half-trusted record through into a balance display.
 */
export function loadSnapshot(): DashboardSnapshot | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const o = parsed as Record<string, unknown>
    if (typeof o.savedAt !== 'string' || !Array.isArray(o.rows)) return null

    const rows: SnapshotRow[] = []
    for (const r of o.rows) {
      if (!r || typeof r !== 'object') return null
      const s = r as Record<string, unknown>
      if (
        typeof s.name !== 'string' ||
        typeof s.chainKey !== 'string' ||
        typeof s.address !== 'string' ||
        typeof s.isValidator !== 'boolean' ||
        !isBase(s.available) ||
        !isBase(s.staked) ||
        !isBase(s.rewards) ||
        !isBase(s.commission)
      ) {
        return null
      }
      rows.push({
        name: s.name,
        chainKey: s.chainKey,
        address: s.address,
        available: s.available,
        staked: s.staked,
        rewards: s.rewards,
        commission: s.commission,
        isValidator: s.isValidator,
      })
    }
    return { savedAt: o.savedAt, rows }
  } catch {
    return null
  }
}

export function saveSnapshot(rows: SnapshotRow[]): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ savedAt: new Date().toISOString(), rows } satisfies DashboardSnapshot),
    )
  } catch {
    // Quota or private-mode failures are not worth surfacing - the dashboard
    // works perfectly well with no cache at all.
  }
}

export function clearSnapshot(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

const addressSet = (rows: { address: string }[]): string =>
  rows
    .map((r) => r.address)
    .sort()
    .join(',')

/**
 * Change in a chain's total since the snapshot, as an exact base-unit string
 * that may be negative - or null when no honest comparison exists.
 *
 * Null unless the snapshot covered exactly the SAME addresses on that chain.
 * Importing or removing a wallet changes the total without anything having been
 * gained, and reporting that as "+38,000 MED" would be a fabricated figure
 * attached to the user's money.
 */
export function chainDelta(
  previousRows: SnapshotRow[],
  currentRows: { address: string; available: string; staked: string }[],
): string | null {
  if (previousRows.length === 0 || currentRows.length === 0) return null
  if (addressSet(previousRows) !== addressSet(currentRows)) return null

  const totalOf = (rows: { available: string; staked: string }[]) =>
    rows.reduce((sum, r) => sum + BigInt(r.available) + BigInt(r.staked), 0n)

  return (totalOf(currentRows) - totalOf(previousRows)).toString()
}
