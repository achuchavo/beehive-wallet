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
function stubLcd(opts: {
  validatorStatus: number
  onCommission?: () => void
  unbonding?: unknown
}) {
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
    if (url.includes('/unbonding_delegations'))
      return Promise.resolve(json(opts.unbonding ?? { unbonding_responses: [] }))
    if (url.includes('/staking/v1beta1/validators/'))
      return Promise.resolve(json({ validator: {} }, opts.validatorStatus))
    throw new Error(`unstubbed route: ${url}`)
  })
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// Unbonding funds are no longer staked but not yet spendable. Until this was
// queried they were invisible for the entire unbonding period (21 days on both
// configured chains) - a holder mid-unbond watched part of their balance
// vanish from the dashboard with no explanation.
describe('fetchWalletPortfolio unbonding', () => {
  it('sums every entry across every unbonding delegation', async () => {
    stubLcd({
      validatorStatus: 404,
      unbonding: {
        unbonding_responses: [
          { entries: [{ balance: '100', completion_time: '2026-08-10T00:00:00Z' },
                      { balance: '250', completion_time: '2026-08-01T00:00:00Z' }] },
          { entries: [{ balance: '5', completion_time: '2026-09-01T00:00:00Z' }] },
        ],
      },
    })
    const p = await fetchWalletPortfolio(chain, ADDR, {})
    expect(p.unbonding).toBe('355')
    // The SOONEST completion, not the first encountered.
    expect(p.unbondingCompletesAt).toBe('2026-08-01T00:00:00Z')
  })

  it('is zero with no unbonding in flight', async () => {
    stubLcd({ validatorStatus: 404 })
    const p = await fetchWalletPortfolio(chain, ADDR, {})
    expect(p.unbonding).toBe('0')
    expect(p.unbondingCompletesAt).toBeNull()
  })

  it('stays exact beyond 2^53', async () => {
    stubLcd({
      validatorStatus: 404,
      unbonding: { unbonding_responses: [{ entries: [
        { balance: '9007199254740993' }, { balance: '1' },
      ] }] },
    })
    const p = await fetchWalletPortfolio(chain, ADDR, {})
    expect(p.unbonding).toBe('9007199254740994')
  })
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
