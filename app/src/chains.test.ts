// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  resolveChain,
  findChain,
  feeReserve,
  scaledGasPrice,
  gasPriceInDisplay,
  DEFAULT_CHAIN,
  CHAINS,
  type ChainInfo,
} from './chains'

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

// Build a chain that differs from Medibloc only in the fields under test, so a
// failure here points at the gas maths and not at registry wiring.
const chainWith = (gasPrice: string, decimals = 6, denom = 'umed'): ChainInfo => ({
  ...CHAINS[0],
  gasPrice,
  decimals,
  denom,
})

describe('feeReserve', () => {
  it('reserves gasPrice x gasLimit x 1.5 for an integer gas price', () => {
    // 5 x 120000 x 1.5 = 900000
    expect(feeReserve(chainWith('5umed'), 120000)).toBe('900000')
  })

  // The regression this whole change exists for. parseInt('0.025uatom') is 0,
  // so "Max" reserved nothing for gas and the broadcast failed for insufficient
  // fees. Medibloc's integer "5umed" is the only reason it never showed up.
  it('does NOT collapse a fractional gas price to zero', () => {
    // 0.025 x 120000 x 1.5 = 4500
    expect(feeReserve(chainWith('0.025uatom', 6, 'uatom'), 120000)).toBe('4500')
    expect(feeReserve(chainWith('0.002utia', 6, 'utia'), 120000)).toBe('360')
    expect(feeReserve(chainWith('0.0025uosmo', 6, 'uosmo'), 120000)).toBe('450')
  })

  it('rounds up, never down - a reserve one base unit short fails the tx', () => {
    // 0.025 x 1 x 1.5 = 0.0375 base units, which must reserve 1, not 0.
    expect(feeReserve(chainWith('0.025uatom', 6, 'uatom'), 1)).toBe('1')
    // 0.1 x 7 x 1.5 = 1.05 -> 2
    expect(feeReserve(chainWith('0.1uatom', 6, 'uatom'), 7)).toBe('2')
  })

  // gasLimit is a JS number (real limits are ~120k-250k), so precision beyond
  // 2^53 cannot survive the parameter itself. What must hold is that the
  // product is exact and always renders as plain digits: the return value is
  // fed straight back into BigInt/subBase, and a float would emit "1.5e+21"
  // there, which throws on parse rather than failing visibly.
  it('returns plain digits, never scientific notation, for a huge product', () => {
    const reserve = feeReserve(chainWith('1000000000000000umed'), 1000000)
    expect(reserve).toBe('1500000000000000000000')
    expect(reserve).toMatch(/^\d+$/)
    expect(() => BigInt(reserve)).not.toThrow()
    // The float route would have produced this instead.
    expect(String(1000000000000000 * 1000000 * 1.5)).toBe('1.5e+21')
  })

  it('returns 0 rather than NaN for a malformed or absent gas price', () => {
    expect(feeReserve(chainWith(''), 120000)).toBe('0')
    expect(feeReserve(chainWith('umed'), 120000)).toBe('0')
    expect(feeReserve(chainWith('0umed'), 120000)).toBe('0')
  })

  it('returns 0 for a non-positive or non-finite gas limit', () => {
    expect(feeReserve(chainWith('5umed'), 0)).toBe('0')
    expect(feeReserve(chainWith('5umed'), -1)).toBe('0')
    expect(feeReserve(chainWith('5umed'), NaN)).toBe('0')
  })
})

describe('scaledGasPrice', () => {
  it('leaves the chain minimum untouched at 1x', () => {
    expect(scaledGasPrice(chainWith('5umed'), 1)).toBe('5umed')
    expect(scaledGasPrice(chainWith('0.025uatom', 6, 'uatom'), 1)).toBe('0.025uatom')
  })

  it('scales exactly, with no float artefacts in the string CosmJS parses', () => {
    expect(scaledGasPrice(chainWith('5umed'), 1.5)).toBe('7.5umed')
    expect(scaledGasPrice(chainWith('5umed'), 2)).toBe('10umed')
    expect(scaledGasPrice(chainWith('0.025uatom', 6, 'uatom'), 1.5)).toBe('0.0375uatom')
    expect(scaledGasPrice(chainWith('0.0025uosmo', 6, 'uosmo'), 1.5)).toBe('0.00375uosmo')
  })

  it('keeps denoms with IBC-style punctuation intact', () => {
    const ibc = 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2'
    expect(scaledGasPrice(chainWith(`0.01${ibc}`, 6, ibc), 2)).toBe(`0.02${ibc}`)
  })

  it('falls back to the chain minimum for a nonsense multiplier', () => {
    expect(scaledGasPrice(chainWith('5umed'), NaN)).toBe('5umed')
    expect(scaledGasPrice(chainWith('5umed'), -2)).toBe('5umed')
  })
})

describe('gasPriceInDisplay', () => {
  it('shifts base units into the display denom exactly', () => {
    expect(gasPriceInDisplay(chainWith('5umed'), 1)).toBe('0.000005')
    expect(gasPriceInDisplay(chainWith('5umed'), 1.5)).toBe('0.0000075')
    expect(gasPriceInDisplay(chainWith('0.025uatom', 6, 'uatom'), 1)).toBe('0.000000025')
  })

  it('honours a chain with non-6 decimals', () => {
    expect(gasPriceInDisplay(chainWith('1000000000000stake', 18, 'stake'), 1)).toBe('0.000001')
  })
})
