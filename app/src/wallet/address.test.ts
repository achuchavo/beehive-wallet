import { describe, it, expect } from 'vitest'
import {
  assertAccountAddress,
  assertValidatorAddress,
  isValidAccountAddress,
  isValidValidatorAddress,
} from './address'

// Real medibloc (panacea) addresses sharing the same key bytes.
const ACCOUNT = 'panacea1hlpw58lg9fvwvwa3ryzgjqyw39tf2nmnhhr072'
const VALOPER = 'panaceavaloper1hlpw58lg9fvwvwa3ryzgjqyw39tf2nmns4r0z5'

describe('assertAccountAddress', () => {
  it('accepts a valid account address', () => {
    expect(isValidAccountAddress(ACCOUNT, 'panacea')).toBe(true)
    expect(() => assertAccountAddress(ACCOUNT, 'panacea')).not.toThrow()
  })
  it('rejects a validator address as an account address (wrong HRP)', () => {
    expect(isValidAccountAddress(VALOPER, 'panacea')).toBe(false)
    expect(() => assertAccountAddress(VALOPER, 'panacea')).toThrow(/start with/i)
  })
  it('rejects the wrong chain prefix', () => {
    expect(() => assertAccountAddress(ACCOUNT, 'cosmos')).toThrow(/start with/i)
  })
  it('rejects a bad checksum', () => {
    const broken = ACCOUNT.slice(0, -1) + (ACCOUNT.endsWith('2') ? '3' : '2')
    expect(isValidAccountAddress(broken, 'panacea')).toBe(false)
    expect(() => assertAccountAddress(broken, 'panacea')).toThrow(/checksum|format|length/i)
  })
  it('rejects surrounding whitespace', () => {
    expect(() => assertAccountAddress(` ${ACCOUNT}`, 'panacea')).toThrow(/whitespace/i)
    expect(() => assertAccountAddress(`${ACCOUNT}\n`, 'panacea')).toThrow(/whitespace/i)
  })
  it('rejects empty / garbage', () => {
    expect(() => assertAccountAddress('', 'panacea')).toThrow()
    expect(() => assertAccountAddress('not-an-address', 'panacea')).toThrow()
  })
})

describe('assertValidatorAddress', () => {
  it('accepts a valid valoper address', () => {
    expect(isValidValidatorAddress(VALOPER, 'panacea')).toBe(true)
    expect(() => assertValidatorAddress(VALOPER, 'panacea')).not.toThrow()
  })
  it('rejects an account address as a validator address', () => {
    expect(isValidValidatorAddress(ACCOUNT, 'panacea')).toBe(false)
  })
})
