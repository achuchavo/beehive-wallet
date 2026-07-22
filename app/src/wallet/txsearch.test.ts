// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchTxSearch, resetTxQueryCache } from './txsearch'
import { CHAINS, type ChainInfo } from '../chains'

const chain = (key: string): ChainInfo => ({ ...CHAINS[0], key, lcd: 'https://lcd.test' })

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/**
 * Stub an LCD that accepts exactly one spelling of the filter parameter, the
 * way the real chains behave:
 *   older SDK (Medibloc)  events -> 200, query -> 400
 *   newer SDK (Chihuahua) query  -> 200, events -> 500
 */
function stubChain(accepts: 'query' | 'events', rejectStatus: number) {
  const calls: string[] = []
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    const uses = url.includes(`?${accepts}=`) ? accepts : accepts === 'query' ? 'events' : 'query'
    return Promise.resolve(
      uses === accepts ? json({ tx_responses: [{ txhash: 'A' }] }) : json({}, rejectStatus),
    )
  })
  return calls
}

const paramOf = (url: string) => (url.includes('?query=') ? 'query' : 'events')

beforeEach(() => resetTxQueryCache())
afterEach(() => vi.unstubAllGlobals())

describe('fetchTxSearch', () => {
  it('works against a newer-SDK chain that only accepts query=', async () => {
    const calls = stubChain('query', 500)
    const data = await fetchTxSearch(chain('chihuahua'), "message.sender='x'")
    expect(data?.tx_responses).toHaveLength(1)
    // First attempt already succeeds - no wasted request.
    expect(calls).toHaveLength(1)
    expect(paramOf(calls[0])).toBe('query')
  })

  it('falls back for an older-SDK chain that only accepts events=', async () => {
    const calls = stubChain('events', 400)
    const data = await fetchTxSearch(chain('medibloc'), "message.sender='x'")
    expect(data?.tx_responses).toHaveLength(1)
    expect(calls.map(paramOf)).toEqual(['query', 'events'])
  })

  // Ordering is the load-bearing detail, not an arbitrary choice. A chain that
  // rejects 'events' answers 5xx, which makes lcd_proxy fail over across every
  // configured endpoint (32s measured on Chihuahua) before returning. A chain
  // that rejects 'query' answers 4xx, which the proxy returns immediately. So
  // 'query' must be probed first: the cheap failure, never the expensive one.
  it('always probes query= before events=', async () => {
    const calls = stubChain('events', 400)
    await fetchTxSearch(chain('medibloc'), "message.sender='x'")
    expect(paramOf(calls[0])).toBe('query')
  })

  it('remembers the working spelling, so the probe happens once per chain', async () => {
    const calls = stubChain('events', 400)
    await fetchTxSearch(chain('medibloc'), "message.sender='a'")
    expect(calls).toHaveLength(2) // probe + hit
    await fetchTxSearch(chain('medibloc'), "message.sender='b'")
    expect(calls).toHaveLength(3) // straight to the known-good spelling
    expect(paramOf(calls[2])).toBe('events')
  })

  it('caches per chain, never leaking one chain\'s answer to another', async () => {
    const calls = stubChain('events', 400)
    await fetchTxSearch(chain('medibloc'), "message.sender='a'")
    calls.length = 0
    // A different key must probe again rather than assume 'events'.
    await fetchTxSearch(chain('chihuahua'), "message.sender='a'")
    expect(paramOf(calls[0])).toBe('query')
  })

  it('returns null when every spelling fails, rather than a partial list', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(json({}, 500)))
    expect(await fetchTxSearch(chain('broken'), "message.sender='x'")).toBeNull()
  })

  it('returns null when the network throws', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
    expect(await fetchTxSearch(chain('offline'), "message.sender='x'")).toBeNull()
  })

  it('encodes the filter and appends extra params verbatim', async () => {
    const calls = stubChain('query', 500)
    await fetchTxSearch(chain('c'), "message.sender='abc'", '&order_by=2&pagination.limit=50')
    expect(calls[0]).toBe(
      "https://lcd.test/cosmos/tx/v1beta1/txs?query=message.sender%3D'abc'&order_by=2&pagination.limit=50",
    )
  })
})
