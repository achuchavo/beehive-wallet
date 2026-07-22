// Cosmos tx-search compatibility.
//
// The LCD tx-search filter parameter changed name across Cosmos SDK versions
// and the two spellings are mutually exclusive, verified against both live
// chains on 2026-07-23:
//
//   Medibloc  (panacea-3, older SDK)  events=... -> 200   query=... -> 400
//   Chihuahua (chihuahua-1, newer)    events=... -> 500   query=... -> 200
//
// Chains are added by an admin at runtime, and whoever adds one should not have
// to know their node's SDK version, so this is detected rather than configured.
//
// Order matters. 'query' is tried first because a chain that rejects it answers
// 4xx, which lcd_proxy returns immediately; a chain that rejects 'events'
// answers 5xx, which makes the proxy fail over across EVERY configured endpoint
// first (32s measured on Chihuahua). Probing in this order costs the older
// chains one fast extra round trip and the newer ones nothing.

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

function buildUrl(chain: ChainInfo, param: TxQueryParam, filter: string, extra: string): string {
  return `${chain.lcd}/cosmos/tx/v1beta1/txs?${param}=${encodeURIComponent(filter)}${extra}`
}

/**
 * Run an LCD tx search, transparently handling the parameter-name difference.
 *
 * `filter` is the unencoded expression, e.g. `message.sender='cosmos1...'`.
 * `extra` is appended verbatim and must already be URL-safe, e.g.
 * `&order_by=2&pagination.limit=50`.
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
  extra = '',
): Promise<TxSearchResponse | null> {
  const known = learned.get(chain.key)
  const order = known ? [known, ...PARAM_ORDER.filter((p) => p !== known)] : PARAM_ORDER

  for (const param of order) {
    try {
      const res = await fetch(buildUrl(chain, param, filter, extra))
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
