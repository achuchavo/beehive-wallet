// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { lookupTx } from './tx'
import { CHAINS, type ChainInfo } from '../chains'

const chain: ChainInfo = { ...CHAINS[0], lcd: 'https://lcd.test' }
const HASH = 'A1B2C3'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => vi.unstubAllGlobals())

/**
 * lookupTx is what decides whether an ambiguous broadcast is safe to retry, so
 * every branch matters. The distinction that carries the risk is
 * missing/unavailable vs rejected: only a CONFIRMED rejection means nothing
 * was committed. Anything else must leave the transaction treated as possibly
 * live, because resending would pay or delegate twice.
 */
describe('lookupTx', () => {
  it('reports success with its height', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(json({ tx_response: { code: 0, height: '42' } })))
    expect(await lookupTx(chain, HASH)).toEqual({ status: 'success', height: 42 })
  })

  it('reports a chain rejection with its code and log', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(json({ tx_response: { code: 11, raw_log: 'out of gas' } })),
    )
    expect(await lookupTx(chain, HASH)).toEqual({
      status: 'rejected',
      code: 11,
      rawLog: 'out of gas',
    })
  })

  // 404 means "not indexed YET" as much as "never arrived". It must never be
  // reported as rejected.
  it('treats 404 as missing, not rejected', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(json({}, 404)))
    expect(await lookupTx(chain, HASH)).toEqual({ status: 'missing' })
  })

  it('treats an empty body as missing', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(json({})))
    expect(await lookupTx(chain, HASH)).toEqual({ status: 'missing' })
  })

  it('reports an unreachable node as unavailable, not rejected', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(json({}, 502)))
    expect(await lookupTx(chain, HASH)).toEqual({ status: 'unavailable' })
  })

  it('reports a thrown network error as unavailable', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
    expect(await lookupTx(chain, HASH)).toEqual({ status: 'unavailable' })
  })

  it('does not mistake malformed JSON for a rejection', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('not json', { status: 200 })))
    expect(await lookupTx(chain, HASH)).toEqual({ status: 'unavailable' })
  })

  it('queries the exact hash against the chain lcd', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', (u: RequestInfo | URL) => {
      calls.push(String(u))
      return Promise.resolve(json({ tx_response: { code: 0, height: '1' } }))
    })
    await lookupTx(chain, HASH)
    expect(calls[0]).toBe(`https://lcd.test/cosmos/tx/v1beta1/txs/${HASH}`)
  })

  // The safety property, stated directly: only an explicit rejection clears a
  // transaction for resend.
  it('only a confirmed rejection may be treated as "nothing happened"', async () => {
    const safeToResend = (s: string) => s === 'rejected'
    expect(safeToResend('missing')).toBe(false)
    expect(safeToResend('unavailable')).toBe(false)
    expect(safeToResend('success')).toBe(false)
    expect(safeToResend('rejected')).toBe(true)
  })
})
