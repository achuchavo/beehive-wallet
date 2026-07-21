import { CHAINS, proxyLcd, proxyRpc, type ChainInfo } from './chains'

// Loads chain metadata from the DB (chains_public.php) and folds it into the
// in-memory CHAINS registry. The static entry in chains.ts is the bootstrap so
// the first render works offline; this makes admin edits (fee, validator,
// endpoints) take effect on load, and surfaces any newly added chains.

interface ApiChain {
  key: string
  chainId: string
  chainName: string
  bech32Prefix: string
  denom: string
  displayDenom: string
  decimals: number
  coinType: number
  gasPrice: string
  explorerTxUrl: string
  explorerValidatorUrl: string
  beehiveValidator: string
  beehiveMoniker: string
  serviceFee: string
  feeCollector: string
}

function toChainInfo(c: ApiChain): ChainInfo {
  return { ...c, lcd: proxyLcd(c.key), rpc: proxyRpc(c.key) }
}

export async function loadChains(): Promise<void> {
  try {
    const base = `${import.meta.env.BASE_URL}api/chains_public.php`.replace('//', '/')
    const res = await fetch(base, { credentials: 'same-origin' })
    if (!res.ok) return
    const data = await res.json()
    const apiChains: ApiChain[] = data.chains ?? []

    for (const api of apiChains) {
      const existing = CHAINS.find((c) => c.key === api.key)
      if (existing) {
        // Update metadata in place so components holding the reference see it.
        Object.assign(existing, toChainInfo(api))
      } else {
        CHAINS.push(toChainInfo(api))
      }
    }
  } catch {
    // Keep the bootstrap config if the API is unreachable.
  }
}
