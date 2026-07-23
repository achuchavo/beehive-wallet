// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  migrateWallets,
  loadWallets,
  saveWallets,
  loadActiveWalletId,
  saveActiveWalletId,
  type StoredWallet,
} from './storage'
import type { EncryptedPayload } from './crypto'

const WALLETS_KEY = 'beehive_wallets_v1'
const ACTIVE_ADDRESS_KEY = 'beehive_active_wallet_v1'
const ACTIVE_ID_KEY = 'beehive_active_wallet_id_v1'

const enc = { v: 1, salt: 's', iv: 'i', data: 'd' } as EncryptedPayload

/** A record in the OLD shape: no id. */
const legacy = (over: Record<string, unknown> = {}) => ({
  name: 'W',
  chainKey: 'medibloc',
  address: 'panacea1aaa',
  kind: 'mnemonic',
  encrypted: enc,
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
})

beforeEach(() => localStorage.clear())

describe('wallet migration', () => {
  it('assigns an id to a legacy record without touching the key material', () => {
    const { wallets, changed } = migrateWallets([legacy()])
    expect(changed).toBe(true)
    expect(wallets).toHaveLength(1)
    expect(wallets[0].id).toBeTruthy()
    // The encrypted payload is the only copy of the key. It must survive byte
    // for byte - a migration that mangles it destroys the wallet.
    expect(wallets[0].encrypted).toEqual(enc)
    expect(wallets[0].name).toBe('W')
    expect(wallets[0].chainKey).toBe('medibloc')
    expect(wallets[0].address).toBe('panacea1aaa')
    expect(wallets[0].kind).toBe('mnemonic')
    expect(wallets[0].createdAt).toBe('2026-01-01T00:00:00Z')
  })

  it('is idempotent: a second pass changes nothing', () => {
    const first = migrateWallets([legacy()])
    const second = migrateWallets(first.wallets)
    expect(second.changed).toBe(false)
    expect(second.wallets[0].id).toBe(first.wallets[0].id)
  })

  it('gives distinct ids to distinct wallets', () => {
    const { wallets } = migrateWallets([
      legacy({ address: 'panacea1aaa' }),
      legacy({ address: 'panacea1bbb' }),
    ])
    expect(new Set(wallets.map((w) => w.id)).size).toBe(2)
  })

  // The point of the change: identity is (chain, address), not address alone.
  it('keeps the same address on two different chains as two wallets', () => {
    const { wallets } = migrateWallets([
      legacy({ chainKey: 'medibloc', address: 'cosmos1same' }),
      legacy({ chainKey: 'chihuahua', address: 'cosmos1same' }),
    ])
    expect(wallets).toHaveLength(2)
    expect(wallets[0].id).not.toBe(wallets[1].id)
  })

  it('collapses a true duplicate (same chain AND address)', () => {
    const { wallets, changed } = migrateWallets([
      legacy({ chainKey: 'medibloc', address: 'panacea1aaa' }),
      legacy({ chainKey: 'medibloc', address: 'panacea1aaa' }),
    ])
    expect(wallets).toHaveLength(1)
    expect(changed).toBe(true)
  })

  it('drops malformed records rather than half-loading them', () => {
    const { wallets } = migrateWallets([
      legacy(),
      null,
      'nonsense',
      { name: 'no address', chainKey: 'medibloc', encrypted: enc },
      { name: 'no encrypted', chainKey: 'medibloc', address: 'panacea1ccc' },
      { name: 'no chain', address: 'panacea1ddd', encrypted: enc },
    ])
    // Only the good one survives; a record without `encrypted` had no key to
    // lose, and one without chainKey/address could not be resolved anyway.
    expect(wallets).toHaveLength(1)
    expect(wallets[0].address).toBe('panacea1aaa')
  })

  it('survives a non-array payload without throwing', () => {
    expect(migrateWallets(null).wallets).toEqual([])
    expect(migrateWallets({ nope: true }).wallets).toEqual([])
  })

  it('persists ids on first load so they stay stable across reloads', () => {
    localStorage.setItem(WALLETS_KEY, JSON.stringify([legacy()]))
    const first = loadWallets()
    const second = loadWallets()
    expect(first[0].id).toBe(second[0].id)
    // And the migrated shape was written back.
    expect(JSON.parse(localStorage.getItem(WALLETS_KEY)!)[0].id).toBe(first[0].id)
  })

  it('does not lose wallets when storage holds the legacy shape', () => {
    localStorage.setItem(
      WALLETS_KEY,
      JSON.stringify([legacy({ address: 'panacea1aaa' }), legacy({ address: 'panacea1bbb' })]),
    )
    expect(loadWallets()).toHaveLength(2)
  })
})

describe('active wallet selection', () => {
  const mk = (id: string, address: string, chainKey = 'medibloc'): StoredWallet => ({
    id,
    name: id,
    chainKey,
    address,
    encrypted: enc,
    createdAt: 'x',
  })

  it('upgrades a legacy active ADDRESS to the matching wallet id', () => {
    const wallets = [mk('id-a', 'panacea1aaa'), mk('id-b', 'panacea1bbb')]
    saveWallets(wallets)
    localStorage.setItem(ACTIVE_ADDRESS_KEY, 'panacea1bbb')
    expect(loadActiveWalletId(wallets)).toBe('id-b')
    // And it is remembered as an id from then on.
    expect(localStorage.getItem(ACTIVE_ID_KEY)).toBe('id-b')
  })

  it('returns null when the stored id no longer exists', () => {
    const wallets = [mk('id-a', 'panacea1aaa')]
    saveWallets(wallets)
    localStorage.setItem(ACTIVE_ID_KEY, 'id-gone')
    expect(loadActiveWalletId(wallets)).toBeNull()
  })

  it('keeps the legacy address key in step for stale cached bundles', () => {
    const wallets = [mk('id-a', 'panacea1aaa')]
    saveWallets(wallets)
    saveActiveWalletId('id-a', wallets)
    expect(localStorage.getItem(ACTIVE_ADDRESS_KEY)).toBe('panacea1aaa')
  })

  it('clears both keys when the selection is cleared', () => {
    saveActiveWalletId(null)
    expect(localStorage.getItem(ACTIVE_ID_KEY)).toBeNull()
    expect(localStorage.getItem(ACTIVE_ADDRESS_KEY)).toBeNull()
  })

  // Two wallets sharing an address: selecting one must not select the other.
  it('distinguishes same-address wallets on different chains', () => {
    const wallets = [mk('id-med', 'cosmos1same', 'medibloc'), mk('id-hua', 'cosmos1same', 'chihuahua')]
    saveWallets(wallets)
    saveActiveWalletId('id-hua', wallets)
    expect(loadActiveWalletId(wallets)).toBe('id-hua')
  })
})
