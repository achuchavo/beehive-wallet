import { CHAINS, proxyLcd, proxyRpc, type ChainInfo } from './chains'

// Loads chain metadata from the DB (chains_public.php) and folds it into the
// in-memory CHAINS registry. The static entry in chains.ts is the bootstrap so
// the first render works offline; this makes admin edits (fee, validator,
// endpoints) take effect on load, and surfaces any newly added chains.
//
// Every API chain is runtime-validated before it can enter the registry: a
// malformed or incomplete definition is rejected and logged, never merged, so
// it can never end up backing a signing operation. Callers that need the DB
// config before signing can await `chainsReady`.

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
  coingeckoId: string
  freeValidators: string[]
  serviceFee: string
  feeCollector: string
}

const REQUIRED_STRINGS: (keyof ApiChain)[] = [
  'key',
  'chainId',
  'chainName',
  'bech32Prefix',
  'denom',
  'displayDenom',
  'gasPrice',
]

// A chain definition is only usable if it carries everything a signing op needs.
// Returns a validated ApiChain or null (with the reason logged).
function validateApiChain(raw: unknown): ApiChain | null {
  if (typeof raw !== 'object' || raw === null) return null
  const c = raw as Record<string, unknown>

  for (const field of REQUIRED_STRINGS) {
    if (typeof c[field] !== 'string' || (c[field] as string).trim() === '') {
      console.warn(`[chains] rejected chain "${String(c.key)}": missing/empty ${String(field)}`)
      return null
    }
  }
  const decimals = Number(c.decimals)
  const coinType = Number(c.coinType)
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) {
    console.warn(`[chains] rejected chain "${String(c.key)}": bad decimals`)
    return null
  }
  if (!Number.isInteger(coinType) || coinType < 0) {
    console.warn(`[chains] rejected chain "${String(c.key)}": bad coinType`)
    return null
  }
  // gasPrice must parse to "<number><denom>" so fee math never sees NaN.
  if (!/^\d+(\.\d+)?[a-z]+$/i.test(String(c.gasPrice))) {
    console.warn(`[chains] rejected chain "${String(c.key)}": bad gasPrice "${String(c.gasPrice)}"`)
    return null
  }
  const freeValidators = Array.isArray(c.freeValidators)
    ? (c.freeValidators.filter((v) => typeof v === 'string') as string[])
    : []

  return {
    key: String(c.key),
    chainId: String(c.chainId),
    chainName: String(c.chainName),
    bech32Prefix: String(c.bech32Prefix),
    denom: String(c.denom),
    displayDenom: String(c.displayDenom),
    decimals,
    coinType,
    gasPrice: String(c.gasPrice),
    explorerTxUrl: String(c.explorerTxUrl ?? ''),
    explorerValidatorUrl: String(c.explorerValidatorUrl ?? ''),
    beehiveValidator: String(c.beehiveValidator ?? ''),
    beehiveMoniker: String(c.beehiveMoniker ?? ''),
    coingeckoId: String(c.coingeckoId ?? ''),
    freeValidators,
    serviceFee: /^\d+$/.test(String(c.serviceFee)) ? String(c.serviceFee) : '0',
    feeCollector: String(c.feeCollector ?? ''),
  }
}

function toChainInfo(c: ApiChain): ChainInfo {
  return { ...c, lcd: proxyLcd(c.key), rpc: proxyRpc(c.key) }
}

async function doLoad(): Promise<void> {
  try {
    const base = `${import.meta.env.BASE_URL}api/chains_public.php`.replace('//', '/')
    const res = await fetch(base, { credentials: 'same-origin' })
    if (!res.ok) return
    const data = await res.json()
    const rawChains: unknown[] = Array.isArray(data?.chains) ? data.chains : []

    for (const raw of rawChains) {
      const api = validateApiChain(raw)
      if (!api) continue // invalid definitions never enter the registry
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

// Resolves once the DB chain config has been merged (or failed and fallen back
// to bootstrap). Await this before financially sensitive first loads if you want
// admin-updated fee/validator/endpoint values guaranteed present.
export const chainsReady: Promise<void> = doLoad()

export async function loadChains(): Promise<void> {
  return chainsReady
}
