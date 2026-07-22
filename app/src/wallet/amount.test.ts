import { describe, it, expect } from 'vitest'
import {
  toBaseUnits,
  fromBaseUnits,
  formatBase,
  floorBaseUnits,
  sumBase,
  addBase,
  subBase,
  compareBase,
  isPositiveBase,
} from './amount'

describe('toBaseUnits', () => {
  it('converts whole and fractional amounts (6 decimals)', () => {
    expect(toBaseUnits('1', 6)).toBe('1000000')
    expect(toBaseUnits('1.5', 6)).toBe('1500000')
    expect(toBaseUnits('0.000001', 6)).toBe('1')
  })
  it('strips leading zeros', () => {
    expect(toBaseUnits('007', 6)).toBe('7000000')
    expect(toBaseUnits('0.5', 6)).toBe('500000')
  })
  it('rejects too many decimals', () => {
    expect(() => toBaseUnits('1.1234567', 6)).toThrow(/decimal/i)
  })
  it('rejects zero and non-numeric', () => {
    expect(() => toBaseUnits('0', 6)).toThrow(/more than zero/i)
    expect(() => toBaseUnits('0.0', 6)).toThrow(/more than zero/i)
    expect(() => toBaseUnits('abc', 6)).toThrow(/valid amount/i)
    expect(() => toBaseUnits('1,5', 6)).toThrow(/valid amount/i)
    expect(() => toBaseUnits('-1', 6)).toThrow(/valid amount/i)
  })
  it('handles amounts far beyond Number.MAX_SAFE_INTEGER exactly', () => {
    // 10 million tokens at 18 decimals = 10^25 base units
    expect(toBaseUnits('10000000', 18)).toBe('10000000000000000000000000')
  })
})

describe('fromBaseUnits', () => {
  it('round-trips', () => {
    expect(fromBaseUnits('1500000', 6)).toBe('1.5')
    expect(fromBaseUnits('1', 6)).toBe('0.000001')
    expect(fromBaseUnits('1000000', 6)).toBe('1')
    expect(fromBaseUnits('0', 6)).toBe('0')
  })
  it('is exact above MAX_SAFE_INTEGER (no scientific notation)', () => {
    const base = '123456789012345678901234' // ~1.2e23
    const out = fromBaseUnits(base, 6)
    expect(out).toBe('123456789012345678.901234')
    expect(out).not.toMatch(/e/i)
  })
})

describe('formatBase', () => {
  it('groups thousands and keeps fraction exact', () => {
    expect(formatBase('1234567890', 6)).toBe('1,234.56789')
    expect(formatBase('1000000', 6)).toBe('1')
  })
  it('groups very large integers without precision loss', () => {
    expect(formatBase('123456789012345678000000', 6)).toBe('123,456,789,012,345,678')
  })
})

describe('floorBaseUnits', () => {
  it('floors decimal reward strings', () => {
    expect(floorBaseUnits('12345.6789')).toBe('12345')
    expect(floorBaseUnits('0.999')).toBe('0')
    expect(floorBaseUnits('80588760.000000000000000000')).toBe('80588760')
  })
  it('clamps negatives and junk to zero', () => {
    expect(floorBaseUnits('-5.4')).toBe('0')
    expect(floorBaseUnits('')).toBe('0')
  })
  it('floors huge decimal strings exactly', () => {
    expect(floorBaseUnits('99999999999999999999999.5')).toBe('99999999999999999999999')
  })
})

describe('sum/compare', () => {
  it('sums large base-unit values exactly', () => {
    expect(sumBase(['9007199254740991', '9007199254740991', '2'])).toBe('18014398509481984')
  })
  it('adds and subtracts (clamped)', () => {
    expect(addBase('999', '1')).toBe('1000')
    expect(subBase('5', '9')).toBe('0')
  })
  it('compares beyond Number precision', () => {
    // These two differ only in the last digit, both > 2^53
    expect(compareBase('9007199254740993', '9007199254740992')).toBe(1)
    expect(compareBase('9007199254740992', '9007199254740993')).toBe(-1)
    expect(compareBase('100', '100')).toBe(0)
  })
  it('isPositiveBase', () => {
    expect(isPositiveBase('0')).toBe(false)
    expect(isPositiveBase('1')).toBe(true)
    expect(isPositiveBase('0.4')).toBe(false) // floors to 0
  })
})
