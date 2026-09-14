// Cosmos tx-search compatibility.
//
// The LCD tx-search filter parameter changed name across Cosmos SDK versions
// and the two spellings are mutually exclusive - and each spelling pages
// differently (re-verified against the live chains on 2026-09-14, after
// Medibloc upgraded to v0.50 and joined Chihuahua on the new spelling):
//
//   SDK <= 0.4x   events=...   pagination.limit        (query=... -> 400)
//   SDK >= 0.50   query=...    limit                   (events=... -> 500)
//
// On v0.50 the legacy pagination.* params are silently IGNORED - a request
// carrying only pagination.limit comes back with the node's default page
// size, or in some configurations the entire matching history. So the limit
// must be spelled to match the filter param, which is why callers pass a
// structured limit instead of a verbatim query-string tail.
//
// Chains are added by an admin at runtime, and whoever adds one should not
// have to know their node's SDK version, so this is detected rather than
// configured.
//
// Order matters. 'query' is tried first because a chain that rejects it
// answers 4xx, which lcd_proxy returns immediately; a chain that rejects
// 'events' answers 5xx, which makes the proxy fail over across EVERY
// configured endpoint first (32s measured on Chihuahua). Probing in this
// order costs the older chains one fast extra round trip and the newer ones
// nothing.

import type { ChainInfo } from '../chains'

export type TxQueryParam = 'query' | 'events'

const PARAM_ORDER: TxQueryParam[] = ['query', 'events']

// Which spelling worked, per chain key. Populated on first success and reused
// for the rest of the session, so the probe happens at most once per chain.
const learned = new Map<string, TxQueryParam>()

/** Exposed for tests; also lets a chain-registry reload start clean. */
export function resetTxQueryCache(): void {
  learned.clear()
}

function buildUrl(chain: ChainInfo, param: TxQueryParam, filter: string, limit: number): string {
  const paging = param === 'query' ? `&limit=${limit}` : `&pagination.limit=${limit}`
  // order_by=2 is ORDER_BY_DESC as a numeric enum - accepted by both SDKs,
  // where string forms are not.
  return `${chain.lcd}/cosmos/tx/v1beta1/txs?${param}=${encodeURIComponent(filter)}&order_by=2${paging}`
}

/**
 * Run a newest-first LCD tx search, transparently handling the parameter-name
 * and paging differences between SDK versions.
 *
 * `filter` is the unencoded expression, e.g. `message.sender='cosmos1...'`.
 * `limit` caps the page in the spelling the node actually honours.
 *
 * Returns the parsed JSON body, or null if every attempt failed - callers treat
 * that as "no history available" rather than surfacing a partial list, since a
 * short history reads as fact.
 */
export interface TxSearchResponse {
  tx_responses?: unknown[]
}

export async function fetchTxSearch(
  chain: ChainInfo,
  filter: string,
  limit = 100,
): Promise<TxSearchResponse | null> {
  const known = learned.get(chain.key)
  const order = known ? [known, ...PARAM_ORDER.filter((p) => p !== known)] : PARAM_ORDER

  for (const param of order) {
    try {
      const res = await fetch(buildUrl(chain, param, filter, limit))
      if (!res.ok) continue
      const data = (await res.json()) as TxSearchResponse
      learned.set(chain.key, param)
      return data
    } catch {
      // Network error - try the other spelling before giving up.
    }
  }
  return null
}
