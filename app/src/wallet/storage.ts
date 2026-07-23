import type { EncryptedPayload } from './crypto'

export interface StoredWallet {
  /**
   * Stable identity, independent of address and chain.
   *
   * Wallets used to be keyed by address alone. Two Cosmos networks can share a
   * Bech32 prefix and derivation path, so the same address string can be a
   * genuinely different account on each - and then "the wallet with this
   * address" is ambiguous for selection, removal, secret reveal and signing.
   * With the chains configured today (panacea / chihuahua) the prefixes differ,
   * so no collision exists yet; this closes it before one can.
   */
  id: string
  name: string
  chainKey: string
  address: string
  /** What the encrypted payload contains. Missing = mnemonic (pre-privkey wallets). */
  kind?: 'mnemonic' | 'privkey'
  encrypted: EncryptedPayload
  createdAt: string
}

const WALLETS_KEY = 'beehive_wallets_v1'
/** Legacy: held the ACTIVE ADDRESS. Read for migration, kept in step on write. */
const ACTIVE_ADDRESS_KEY = 'beehive_active_wallet_v1'
const ACTIVE_ID_KEY = 'beehive_active_wallet_id_v1'

export function newWalletId(): string {
  // randomUUID needs a secure context. Production is HTTPS-only, but this keeps
  // dev and file:// usable rather than throwing partway through a migration.
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const bytes = new Uint8Array(16)
  c?.getRandomValues?.(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Usable = can still identify an account AND carries its encrypted payload. */
function isUsable(w: Record<string, unknown>): boolean {
  return (
    typeof w.address === 'string' &&
    w.address !== '' &&
    typeof w.chainKey === 'string' &&
    w.chainKey !== '' &&
    typeof w.encrypted === 'object' &&
    w.encrypted !== null
  )
}

/**
 * Bring stored records up to the current shape.
 *
 * Idempotent and deliberately conservative: a record missing an id gets one,
 * anything unreadable is dropped rather than half-loaded, and the encrypted
 * payload is copied through untouched - a migration must never be able to
 * damage the only copy of a key.
 *
 * Dropping a malformed record is safe precisely because it could not have been
 * decrypted anyway: without `encrypted` there is no key material to lose.
 */
export function migrateWallets(raw: unknown): { wallets: StoredWallet[]; changed: boolean } {
  if (!Array.isArray(raw)) return { wallets: [], changed: false }
  let changed = false
  const seen = new Set<string>()
  const wallets: StoredWallet[] = []

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      changed = true
      continue
    }
    const w = entry as Record<string, unknown>
    if (!isUsable(w)) {
      changed = true
      continue
    }
    // Identity is (chainKey, address). A duplicate is only a duplicate when
    // BOTH match; the same address on another chain is a different wallet.
    const identity = `${String(w.chainKey)}:${String(w.address)}`
    if (seen.has(identity)) {
      changed = true
      continue
    }
    seen.add(identity)

    const hadId = typeof w.id === 'string' && w.id !== ''
    if (!hadId) changed = true

    wallets.push({
      id: hadId ? (w.id as string) : newWalletId(),
      name: typeof w.name === 'string' && w.name !== '' ? w.name : String(w.address).slice(0, 12),
      chainKey: String(w.chainKey),
      address: String(w.address),
      kind: w.kind === 'privkey' || w.kind === 'mnemonic' ? w.kind : undefined,
      encrypted: w.encrypted as EncryptedPayload,
      createdAt: typeof w.createdAt === 'string' ? w.createdAt : new Date().toISOString(),
    })
  }
  return { wallets, changed }
}

export function loadWallets(): StoredWallet[] {
  try {
    const raw = localStorage.getItem(WALLETS_KEY)
    const { wallets, changed } = migrateWallets(raw ? JSON.parse(raw) : [])
    // Persist the migrated shape so ids stay stable across reloads - otherwise a
    // fresh id would be minted on every read and nothing could reference one.
    if (changed && wallets.length > 0) saveWallets(wallets)
    return wallets
  } catch {
    return []
  }
}

export function saveWallets(wallets: StoredWallet[]): void {
  localStorage.setItem(WALLETS_KEY, JSON.stringify(wallets))
}

/**
 * The active wallet's id, or null.
 *
 * Falls back to the legacy address key so an existing session keeps its
 * selection through the upgrade. If that address somehow exists on two chains
 * the first wins - no worse than the address-keyed behaviour it replaces.
 */
export function loadActiveWalletId(wallets: StoredWallet[]): string | null {
  const id = localStorage.getItem(ACTIVE_ID_KEY)
  if (id && wallets.some((w) => w.id === id)) return id

  const legacyAddress = localStorage.getItem(ACTIVE_ADDRESS_KEY)
  if (legacyAddress) {
    const match = wallets.find((w) => w.address === legacyAddress)
    if (match) {
      localStorage.setItem(ACTIVE_ID_KEY, match.id)
      return match.id
    }
  }
  return null
}

export function saveActiveWalletId(id: string | null, wallets?: StoredWallet[]): void {
  if (id === null) {
    localStorage.removeItem(ACTIVE_ID_KEY)
    localStorage.removeItem(ACTIVE_ADDRESS_KEY)
    return
  }
  localStorage.setItem(ACTIVE_ID_KEY, id)
  // The legacy key is kept in step rather than deleted, so a stale cached
  // bundle served alongside the new one still resolves the same wallet.
  const w = (wallets ?? loadWallets()).find((x) => x.id === id)
  if (w) localStorage.setItem(ACTIVE_ADDRESS_KEY, w.address)
}
