import { useSyncExternalStore } from 'react'
import {
  CHAINS,
  setChainRegistry,
  proxyLcd,
  proxyRpc,
  STAKING_POLICIES,
  type ChainInfo,
  type StakingPolicy,
} from './chains'

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
  // Already narrowed by the sanitiser below - anything unrecognised became
  // 'all' there, so nothing downstream has to re-check it.
  stakingPolicy: StakingPolicy
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
    // Fails towards 'all' - the permissive option - for anything unrecognised.
    // A policy the client cannot read must not silently stop users delegating
    // to validators they could reach a moment ago.
    stakingPolicy: STAKING_POLICIES.includes(c.stakingPolicy as StakingPolicy)
      ? (c.stakingPolicy as StakingPolicy)
      : 'all',
    serviceFee: /^\d+$/.test(String(c.serviceFee)) ? String(c.serviceFee) : '0',
    feeCollector: String(c.feeCollector ?? ''),
  }
}

function toChainInfo(c: ApiChain): ChainInfo {
  return { ...c, lcd: proxyLcd(c.key), rpc: proxyRpc(c.key) }
}

// --- Reactive store ---------------------------------------------------------
// The registry used to be mutated in place (Object.assign / push), so React was
// never told anything changed and a component could observe a chain's fields
// shifting mid-render. Now every load REPLACES the registry and notifies
// subscribers, and components read it through useChains().

export type ChainStatus = 'loading' | 'ready' | 'error'

let status: ChainStatus = 'loading'
let error = ''
// Bumped on every replacement; used as the useSyncExternalStore snapshot so the
// comparison is a cheap scalar rather than an array identity check.
let version = 0
const listeners = new Set<() => void>()

function emit(): void {
  version++
  for (const l of listeners) l()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

const getVersion = () => version

/** Current registry snapshot plus load status. Re-renders on any change. */
export function useChains(): {
  chains: ChainInfo[]
  status: ChainStatus
  error: string
  ready: boolean
} {
  useSyncExternalStore(subscribe, getVersion, getVersion)
  return { chains: CHAINS, status, error, ready: status === 'ready' }
}

/** Non-React read of the current status (for guards outside components). */
export function chainStatus(): ChainStatus {
  return status
}

/**
 * True when it is safe to start a financially sensitive operation. While the
 * config is still loading - or failed to load - we must not sign against a
 * possibly stale bootstrap definition (wrong fee collector, gas price, or RPC).
 */
export function chainsUsable(): boolean {
  return status === 'ready'
}

async function doLoad(): Promise<void> {
  status = 'loading'
  error = ''
  emit()
  try {
    const base = `${import.meta.env.BASE_URL}api/chains_public.php`.replace('//', '/')
    const res = await fetch(base, { credentials: 'same-origin' })
    if (!res.ok) throw new Error(`chains_public returned ${res.status}`)
    const data = await res.json()
    const rawChains: unknown[] = Array.isArray(data?.chains) ? data.chains : []

    // Build a brand new registry rather than mutating the live one.
    const next: ChainInfo[] = CHAINS.map((c) => ({ ...c }))
    for (const raw of rawChains) {
      const api = validateApiChain(raw)
      if (!api) continue // invalid definitions never enter the registry
      const merged = toChainInfo(api)
      const i = next.findIndex((c) => c.key === api.key)
      if (i >= 0) {
        next[i] = merged
      } else {
        next.push(merged)
      }
    }
    setChainRegistry(next)
    status = 'ready'
  } catch (e) {
    // Keep the bootstrap config, but say so: callers must be able to tell a
    // confirmed config from an unverified fallback.
    error = e instanceof Error ? e.message : 'Could not load chain configuration'
    status = 'error'
    console.warn('[chains] load failed, using bootstrap config:', error)
  } finally {
    emit()
  }
}

// Resolves once the DB chain config has been merged (or failed and fallen back
// to bootstrap). Await this before financially sensitive first loads if you want
// admin-updated fee/validator/endpoint values guaranteed present.
export const chainsReady: Promise<void> = doLoad()

export async function loadChains(): Promise<void> {
  return chainsReady
}

/** Re-fetch the registry (e.g. after an admin edits chains). */
export async function refreshChains(): Promise<void> {
  await doLoad()
}
