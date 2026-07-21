// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { resolveChain, findChain, DEFAULT_CHAIN, CHAINS } from './chains'

describe('chain resolution from wallet chainKey', () => {
  it('resolves a configured chain by key', () => {
    const c = resolveChain('medibloc')
    expect(c.key).toBe('medibloc')
    expect(c.chainId).toBe('panacea-3')
    expect(c.bech32Prefix).toBe('panacea')
    expect(c.denom).toBe('umed')
  })

  it('findChain returns undefined for an unknown key (no throw)', () => {
    expect(findChain('does-not-exist')).toBeUndefined()
  })

  it('resolveChain throws for an unknown key (blocks the operation)', () => {
    expect(() => resolveChain('does-not-exist')).toThrow(/not configured/i)
  })

  it('every configured chain carries the fields a signing op needs', () => {
    for (const c of CHAINS) {
      for (const field of [
        'chainId',
        'bech32Prefix',
        'denom',
        'gasPrice',
        'rpc',
        'lcd',
      ] as const) {
        expect(c[field], `${c.key}.${field}`).toBeTruthy()
      }
      expect(typeof c.decimals).toBe('number')
    }
  })

  it('DEFAULT_CHAIN is the first configured chain', () => {
    expect(DEFAULT_CHAIN).toBe(CHAINS[0])
  })
})
