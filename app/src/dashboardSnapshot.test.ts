// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadSnapshot,
  saveSnapshotRows,
  saveSnapshotMonthly,
  clearSnapshot,
  chainDelta,
  type SnapshotRow,
} from './dashboardSnapshot'

const KEY = 'beehive_dash_snapshot_v1'

const row = (over: Partial<SnapshotRow> = {}): SnapshotRow => ({
  name: 'W',
  chainKey: 'medibloc',
  address: 'panacea1a',
  available: '100',
  staked: '200',
  rewards: '0',
  commission: '0',
  isValidator: false,
  ...over,
})

beforeEach(() => {
  clearSnapshot()
})

describe('snapshot persistence', () => {
  it('round-trips rows exactly', () => {
    saveSnapshotRows([row({ available: '9007199254740993' })])
    const back = loadSnapshot()
    expect(back?.rows).toHaveLength(1)
    // Beyond 2^53: the digit string must survive untouched.
    expect(back?.rows[0].available).toBe('9007199254740993')
  })

  it('returns null when nothing is stored', () => {
    expect(loadSnapshot()).toBeNull()
  })
})

// localStorage is user-writable and outlives app versions. A partially-valid
// record must never reach a balance display, so anything malformed discards
// the WHOLE snapshot rather than the offending row.
describe('snapshot validation', () => {
  const cases: [string, unknown][] = [
    ['not an object', 42],
    ['missing rows', { savedAt: 'x' }],
    ['rows not an array', { savedAt: 'x', rows: {} }],
    ['non-integer amount', { savedAt: 'x', rows: [{ ...row(), available: '1.5' }] }],
    ['negative amount', { savedAt: 'x', rows: [{ ...row(), staked: '-5' }] }],
    ['numeric amount, not a string', { savedAt: 'x', rows: [{ ...row(), rewards: 10 }] }],
    ['scientific notation', { savedAt: 'x', rows: [{ ...row(), available: '1e21' }] }],
    ['missing chainKey', { savedAt: 'x', rows: [{ ...row(), chainKey: undefined }] }],
    ['isValidator not boolean', { savedAt: 'x', rows: [{ ...row(), isValidator: 'yes' }] }],
  ]

  for (const [name, payload] of cases) {
    it(`rejects: ${name}`, () => {
      localStorage.setItem(KEY, JSON.stringify(payload))
      expect(loadSnapshot()).toBeNull()
    })
  }

  it('rejects unparseable JSON without throwing', () => {
    localStorage.setItem(KEY, '{not json')
    expect(loadSnapshot()).toBeNull()
  })

  it('discards every row when only one is bad', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ savedAt: 'x', rows: [row(), { ...row(), available: 'oops' }] }),
    )
    expect(loadSnapshot()).toBeNull()
  })

  const monthlyCases: [string, unknown][] = [
    ['monthly not an object', { savedAt: 'x', rows: [], monthly: 'nope' }],
    ['monthly is an array', { savedAt: 'x', rows: [], monthly: [] }],
    ['fractional amount', { savedAt: 'x', rows: [], monthly: { medibloc: { amount: '1.5', months: 3 } } }],
    ['negative months', { savedAt: 'x', rows: [], monthly: { medibloc: { amount: '1', months: -1 } } }],
    ['fractional months', { savedAt: 'x', rows: [], monthly: { medibloc: { amount: '1', months: 1.5 } } }],
    ['months missing', { savedAt: 'x', rows: [], monthly: { medibloc: { amount: '1' } } }],
  ]
  for (const [name, payload] of monthlyCases) {
    it(`rejects monthly: ${name}`, () => {
      localStorage.setItem(KEY, JSON.stringify(payload))
      expect(loadSnapshot()).toBeNull()
    })
  }

  it('accepts a snapshot written before monthly existed', () => {
    localStorage.setItem(KEY, JSON.stringify({ savedAt: 'x', rows: [row()] }))
    const back = loadSnapshot()
    expect(back?.rows).toHaveLength(1)
    expect(back?.monthly).toEqual({})
  })
})

// Balances and claim history land seconds apart, so each half is written on its
// own. Neither writer may clobber the other's data.
describe('monthly cache', () => {
  it('keeps rows when monthly is written', () => {
    saveSnapshotRows([row({ address: 'a' })])
    saveSnapshotMonthly({ medibloc: { amount: '500', months: 4 } })
    const back = loadSnapshot()
    expect(back?.rows).toHaveLength(1)
    expect(back?.monthly.medibloc).toEqual({ amount: '500', months: 4 })
  })

  it('keeps monthly when rows are rewritten by a later refresh', () => {
    saveSnapshotRows([row({ address: 'a' })])
    saveSnapshotMonthly({ medibloc: { amount: '500', months: 4 } })
    saveSnapshotRows([row({ address: 'a', available: '999' })])
    const back = loadSnapshot()
    expect(back?.rows[0].available).toBe('999')
    // Survives so the income card does not flash empty on the next return.
    expect(back?.monthly.medibloc).toEqual({ amount: '500', months: 4 })
  })

  // Regression: claim history is one tx query while balances are several
  // requests per wallet, so monthly genuinely lands first on a fast chain. An
  // earlier version bailed out here on the assumption that rows always came
  // first, which silently dropped the figure on every first run.
  it('stores monthly even when it arrives before any rows', () => {
    saveSnapshotMonthly({ medibloc: { amount: '500', months: 4 } })
    expect(loadSnapshot()?.monthly.medibloc).toEqual({ amount: '500', months: 4 })
  })

  it('carries monthly forward when rows arrive afterwards', () => {
    saveSnapshotMonthly({ medibloc: { amount: '500', months: 4 } })
    saveSnapshotRows([row({ address: 'a' })])
    const back = loadSnapshot()
    expect(back?.rows).toHaveLength(1)
    expect(back?.monthly.medibloc).toEqual({ amount: '500', months: 4 })
  })

  it('keeps monthly amounts exact beyond 2^53', () => {
    saveSnapshotRows([row()])
    saveSnapshotMonthly({ medibloc: { amount: '9007199254740993', months: 2 } })
    expect(loadSnapshot()?.monthly.medibloc.amount).toBe('9007199254740993')
  })
})

describe('chainDelta', () => {
  it('reports the exact gain when the same addresses are compared', () => {
    const prev = [row({ address: 'a', available: '100', staked: '200' })]
    const now = [{ address: 'a', available: '150', staked: '200' }]
    expect(chainDelta(prev, now)).toBe('50')
  })

  it('reports a loss as a negative amount', () => {
    const prev = [row({ address: 'a', available: '100', staked: '0' })]
    expect(chainDelta(prev, [{ address: 'a', available: '40', staked: '0' }])).toBe('-60')
  })

  it('sums across several wallets on the chain', () => {
    const prev = [
      row({ address: 'a', available: '10', staked: '0' }),
      row({ address: 'b', available: '20', staked: '0' }),
    ]
    const now = [
      { address: 'a', available: '15', staked: '0' },
      { address: 'b', available: '25', staked: '0' },
    ]
    expect(chainDelta(prev, now)).toBe('10')
  })

  // The guard that matters. Importing a wallet raises the total without
  // anything having been earned; calling that a gain would be a fabricated
  // number attached to the user's money.
  it('refuses to compare when a wallet was added', () => {
    const prev = [row({ address: 'a', available: '100', staked: '0' })]
    const now = [
      { address: 'a', available: '100', staked: '0' },
      { address: 'b', available: '999999', staked: '0' },
    ]
    expect(chainDelta(prev, now)).toBeNull()
  })

  it('refuses to compare when a wallet was removed', () => {
    const prev = [
      row({ address: 'a', available: '100', staked: '0' }),
      row({ address: 'b', available: '100', staked: '0' }),
    ]
    expect(chainDelta(prev, [{ address: 'a', available: '100', staked: '0' }])).toBeNull()
  })

  it('refuses to compare when the address set differs but the count matches', () => {
    const prev = [row({ address: 'a', available: '100', staked: '0' })]
    expect(chainDelta(prev, [{ address: 'zz', available: '100', staked: '0' }])).toBeNull()
  })

  it('is order-independent for the same set', () => {
    const prev = [
      row({ address: 'b', available: '1', staked: '0' }),
      row({ address: 'a', available: '1', staked: '0' }),
    ]
    const now = [
      { address: 'a', available: '2', staked: '0' },
      { address: 'b', available: '2', staked: '0' },
    ]
    expect(chainDelta(prev, now)).toBe('2')
  })

  it('returns null with no baseline or no current rows', () => {
    expect(chainDelta([], [{ address: 'a', available: '1', staked: '0' }])).toBeNull()
    expect(chainDelta([row()], [])).toBeNull()
  })

  it('stays exact past 2^53, where a float would round the gain away', () => {
    const prev = [row({ address: 'a', available: '9007199254740992', staked: '0' })]
    const now = [{ address: 'a', available: '9007199254740993', staked: '0' }]
    expect(chainDelta(prev, now)).toBe('1')
    // A one-base-unit gain at this magnitude vanishes entirely in a double.
    // The lint warning below is the assertion's whole point: this literal is
    // NOT representable, which is exactly why chainDelta uses BigInt.
    // oxlint-disable-next-line no-loss-of-precision
    expect(9007199254740993 - 9007199254740992).toBe(0)
  })
})
