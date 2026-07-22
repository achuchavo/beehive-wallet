// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchWalletPortfolio } from './portfolio'
import { CHAINS, type ChainInfo } from '../chains'

const chain: ChainInfo = { ...CHAINS[0], lcd: 'https://lcd.test' }
const ADDR = 'panacea1hlpw58lg9fvwvwa3ryzgjqyw39tf2nmnhhr072'
const VALOPER = 'panaceavaloper1hlpw58lg9fvwvwa3ryzgjqyw39tf2nmns4r0z5'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/**
 * Stub every LCD route. `validatorStatus` decides whether this address looks
 * like a validator; `onCommission` runs if the commission route is requested at
 * all, which is the thing under test.
 */
function stubLcd(opts: { validatorStatus: number; onCommission?: () => void }) {
  const calls: string[] = []
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    if (url.includes('/bank/v1beta1/balances/'))
      return Promise.resolve(json({ balances: [{ denom: 'umed', amount: '1500' }] }))
    if (url.includes('/staking/v1beta1/delegations/'))
      return Promise.resolve(json({ delegation_responses: [] }))
    if (url.includes('/distribution/v1beta1/delegators/'))
      return Promise.resolve(json({ total: [], rewards: [] }))
    if (url.includes('/distribution/v1beta1/validators/')) {
      opts.onCommission?.()
      return Promise.resolve(json({ commission: { commission: [{ denom: 'umed', amount: '77' }] } }))
    }
    if (url.includes('/staking/v1beta1/validators/'))
      return Promise.resolve(json({ validator: {} }, opts.validatorStatus))
    throw new Error(`unstubbed route: ${url}`)
  })
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchWalletPortfolio commission lookup', () => {
  // Regression guard. The commission request used to sit in the same
  // Promise.all as everything else, so it fired for every wallet even though
  // the result is discarded unless the address is a validator. On a chain whose
  // LCD answers 5xx for a non-existent validator, lcd_proxy fails over across
  // every endpoint first - 32s measured on Chihuahua - and the dashboard blocks
  // behind it. This must stay conditional.
  it('does not request commission for a non-validator', async () => {
    let commissionRequested = false
    const calls = stubLcd({ validatorStatus: 404, onCommission: () => (commissionRequested = true) })

    const p = await fetchWalletPortfolio(chain, ADDR, {})

    expect(commissionRequested).toBe(false)
    expect(calls.some((u) => u.includes('/distribution/v1beta1/validators/'))).toBe(false)
    expect(p.isValidator).toBe(false)
    expect(p.commission).toBe('0')
    // The rest of the portfolio still loads normally.
    expect(p.available).toBe('1500')
  })

  it('does request commission for a validator, and includes it', async () => {
    let commissionRequested = false
    const calls = stubLcd({ validatorStatus: 200, onCommission: () => (commissionRequested = true) })

    const p = await fetchWalletPortfolio(chain, ADDR, {})

    expect(commissionRequested).toBe(true)
    expect(p.isValidator).toBe(true)
    expect(p.commission).toBe('77')
    // Derived from the account address, not passed in - a wrong prefix here
    // would query some other chain's validator.
    expect(calls.some((u) => u.includes(`/distribution/v1beta1/validators/${VALOPER}/commission`))).toBe(true)
  })
})
