import { describe, it, expect } from 'vitest'
import { parseDenomAmount, monthlyTotals, averageMonthly, type ClaimRecord } from './rewards'
import { fiatValue } from '../currency'

// Base-unit amounts on chain routinely exceed Number.MAX_SAFE_INTEGER
// (9,007,199,254,740,991). Every helper below must stay exact.
const HUGE = '9007199254740993' // MAX_SAFE_INTEGER + 2
const HUGER = '123456789012345678901234567890'

describe('parseDenomAmount', () => {
  it('parses a single amount', () => {
    expect(parseDenomAmount('80588760umed', 'umed')).toBe('80588760')
  })

  it('sums multiple parts of the same denom', () => {
    expect(parseDenomAmount('12umed,34umed', 'umed')).toBe('46')
  })

  it('ignores other denoms rather than mixing assets', () => {
    expect(parseDenomAmount('12umed,34stake', 'umed')).toBe('12')
    expect(parseDenomAmount('34stake', 'umed')).toBe('0')
  })

  it('is exact beyond Number.MAX_SAFE_INTEGER', () => {
    // The string is preserved digit-for-digit...
    expect(parseDenomAmount(`${HUGE}umed`, 'umed')).toBe(HUGE)
    // ...which matters because a Number round-trip silently corrupts it, which
    // is exactly what the previous implementation did.
    expect(String(Number(HUGE))).not.toBe(HUGE)
    expect(String(Number(HUGE))).toBe('9007199254740992')
  })

  it('is exact for values far beyond 2^53', () => {
    expect(parseDenomAmount(`${HUGER}umed`, 'umed')).toBe(HUGER)
  })

  it('sums two huge parts exactly', () => {
    expect(parseDenomAmount(`${HUGE}umed,${HUGE}umed`, 'umed')).toBe('18014398509481986')
  })

  it('returns 0 for empty or malformed input', () => {
    expect(parseDenomAmount('', 'umed')).toBe('0')
    expect(parseDenomAmount('abc', 'umed')).toBe('0')
    expect(parseDenomAmount('1.5umed', 'umed')).toBe('0') // not an integer base amount
  })
})

describe('monthlyTotals', () => {
  const rec = (over: Partial<ClaimRecord>): ClaimRecord => ({
    hash: 'h',
    time: '2026-07-01T00:00:00Z',
    address: 'panacea1x',
    rewards: '0',
    commission: '0',
    denom: 'umed',
    chainKey: 'medibloc',
    ...over,
  })

  it('sums rewards and commission within a month exactly', () => {
    const out = monthlyTotals([
      rec({ rewards: HUGE, commission: '1' }),
      rec({ rewards: '1', commission: '1' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].rewards).toBe('9007199254740994')
    expect(out[0].commission).toBe('2')
  })

  it('never merges different chains into one bucket', () => {
    const out = monthlyTotals([
      rec({ rewards: '100', chainKey: 'medibloc', denom: 'umed' }),
      rec({ rewards: '200', chainKey: 'cosmoshub', denom: 'uatom' }),
    ])
    expect(out).toHaveLength(2)
    const med = out.find((o) => o.chainKey === 'medibloc')!
    const atom = out.find((o) => o.chainKey === 'cosmoshub')!
    expect(med.rewards).toBe('100')
    expect(med.denom).toBe('umed')
    expect(atom.rewards).toBe('200')
    expect(atom.denom).toBe('uatom')
  })

  it('never merges different denoms on the same chain', () => {
    const out = monthlyTotals([
      rec({ rewards: '100', denom: 'umed' }),
      rec({ rewards: '200', denom: 'uother' }),
    ])
    expect(out).toHaveLength(2)
  })

  it('separates months', () => {
    const out = monthlyTotals([
      rec({ time: '2026-07-01T00:00:00Z', rewards: '5' }),
      rec({ time: '2026-06-01T00:00:00Z', rewards: '7' }),
    ])
    expect(out).toHaveLength(2)
    expect(out[0].month).toBe('2026-07') // newest first
    expect(out[1].month).toBe('2026-06')
  })

  it('handles an empty history', () => {
    expect(monthlyTotals([])).toEqual([])
  })
})

describe('averageMonthly', () => {
  // Records arrive newest-first, as fetchClaimHistory returns them.
  const rec = (time: string, rewards: string, chainKey = 'medibloc'): ClaimRecord => ({
    hash: 'h' + time,
    time,
    address: 'panacea1x',
    rewards,
    commission: '0',
    denom: chainKey === 'medibloc' ? 'umed' : 'uatom',
    chainKey,
  })

  it('divides the total by the calendar span it covers', () => {
    // Mar + Feb + Jan = 3 months, 300 total.
    const out = averageMonthly(
      [rec('2026-03-10T00:00:00Z', '100'), rec('2026-02-10T00:00:00Z', '100'), rec('2026-01-10T00:00:00Z', '100')],
      'medibloc',
    )
    expect(out).toEqual({ amount: '100', months: 3 })
  })

  it('counts a single month as one, not zero', () => {
    const out = averageMonthly([rec('2026-03-10T00:00:00Z', '250')], 'medibloc')
    expect(out).toEqual({ amount: '250', months: 1 })
  })

  it('includes commission in the average', () => {
    const r = { ...rec('2026-03-10T00:00:00Z', '100'), commission: '50' }
    expect(averageMonthly([r], 'medibloc').amount).toBe('150')
  })

  it('ignores other chains entirely - averaging across denoms is meaningless', () => {
    const out = averageMonthly(
      [rec('2026-03-10T00:00:00Z', '100'), rec('2026-03-11T00:00:00Z', '999999', 'cosmoshub')],
      'medibloc',
    )
    expect(out).toEqual({ amount: '100', months: 1 })
  })

  it('returns zero with no history, so the UI can hide it', () => {
    expect(averageMonthly([], 'medibloc')).toEqual({ amount: '0', months: 0 })
    expect(averageMonthly([rec('2026-03-10T00:00:00Z', '100', 'cosmoshub')], 'medibloc'))
      .toEqual({ amount: '0', months: 0 })
  })

  it('stays exact beyond Number.MAX_SAFE_INTEGER', () => {
    // 2 months, so the average is half the total - computed with BigInt.
    const out = averageMonthly(
      [rec('2026-03-01T00:00:00Z', HUGE), rec('2026-02-01T00:00:00Z', HUGE)],
      'medibloc',
    )
    expect(out.months).toBe(2)
    expect(out.amount).toBe(HUGE) // (HUGE + HUGE) / 2 === HUGE, exactly
  })

  it('spans a year boundary correctly', () => {
    const out = averageMonthly(
      [rec('2026-01-15T00:00:00Z', '120'), rec('2025-12-15T00:00:00Z', '120')],
      'medibloc',
    )
    expect(out.months).toBe(2)
    expect(out.amount).toBe('120')
  })
})

describe('fiatValue', () => {
  it('converts base units using the chain decimals', () => {
    expect(fiatValue('1500000', 6, 2)).toBeCloseTo(3, 10)
  })

  it('handles zero', () => {
    expect(fiatValue('0', 6, 1234)).toBe(0)
  })

  it('does not lose the integer part for balances beyond 2^53 base units', () => {
    // 9007199254740993 umed = 9007199254.740993 MED. Converting the base-unit
    // string with Number() first would corrupt it before scaling; converting
    // exactly first keeps the token amount right.
    const v = fiatValue(HUGE, 6, 1)
    expect(Math.round(v)).toBe(9007199255)
  })

  it('supports high-decimal chains', () => {
    // 18 decimals: 1e18 base units = 1 token.
    expect(fiatValue('1000000000000000000', 18, 5)).toBeCloseTo(5, 10)
  })

  it('handles very small fractional amounts', () => {
    expect(fiatValue('1', 6, 1)).toBeCloseTo(0.000001, 12)
  })
})
