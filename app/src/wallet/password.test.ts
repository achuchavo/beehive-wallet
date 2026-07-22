import { describe, it, expect } from 'vitest'
import { walletPasswordError, walletPasswordWeak } from './password'

describe('walletPasswordError', () => {
  it('rejects short passwords', () => {
    expect(walletPasswordError('short')).toBe('pw.tooShort')
    expect(walletPasswordError('123456789')).toBe('pw.tooShort') // 9 chars
  })
  it('rejects common passwords (case-insensitive)', () => {
    expect(walletPasswordError('Password123')).toBe('pw.common')
    expect(walletPasswordError('qwertyuiop')).toBe('pw.common')
  })
  it('rejects over-long input', () => {
    expect(walletPasswordError('a'.repeat(201))).toBe('pw.tooLong')
  })
  it('allows a reasonable password', () => {
    expect(walletPasswordError('correct horse battery staple')).toBeNull()
    expect(walletPasswordError('Tr0ub4dour&3xtra')).toBeNull()
  })
})

describe('walletPasswordWeak', () => {
  it('flags short low-variety passwords', () => {
    expect(walletPasswordWeak('aaaaaaaaaa')).toBe(true) // 10 chars, 1 class
  })
  it('does not flag long passphrases', () => {
    expect(walletPasswordWeak('correct horse battery staple')).toBe(false)
  })
  it('does not flag short-but-varied', () => {
    expect(walletPasswordWeak('Ab3$Ab3$Ab3$')).toBe(false) // 12 chars, 4 classes
  })
  it('is false for already-blocked passwords', () => {
    expect(walletPasswordWeak('short')).toBe(false)
  })
})
