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

/**
 * @param quiet Do not flip status to 'loading'.
 *
 * A refresh must be invisible. chainsUsable() gates every signing operation on
 * status === 'ready', so announcing 'loading' on a background refresh would
 * briefly disable Send and Stake - and if the refresh failed, it would downgrade
 * a working, already-validated registry to 'error' over a transient network
 * blip. A refresh either replaces the registry or changes nothing.
 */
async function doLoad(quiet = false): Promise<void> {
  if (!quiet) {
    status = 'loading'
    error = ''
    emit()
  }
  try {
    const base = `${import.meta.env.BASE_URL}api/chains_public.php`.replace('//', '/')
    const res = await fetch(base, { credentials: 'same-origin' })
    if (!res.ok) throw new Error(`chains_public returned ${res.status}`)
    const data = await res.json()
    const rawChains: unknown[] = Array.isArray(data?.chains) ? data.chains : []

    // Built from the API response ALONE, not merged over whatever is currently
    // in the registry. chains_public.php returns every field a ChainInfo needs,
    // so a validated entry is self-sufficient - and merging meant a chain the
    // admin had just DEACTIVATED stayed in the registry for the life of the tab,
    // still offered for sending and staking. The database is the authority when
    // it answers; the bootstrap entry is only a cold-start fallback.
    const next: ChainInfo[] = []
    for (const raw of rawChains) {
      const api = validateApiChain(raw)
      if (!api) continue // invalid definitions never enter the registry
      next.push(toChainInfo(api))
    }

    // Refuse to install an empty registry. Every chain being rejected (or the
    // endpoint returning none) would leave the app with nothing to sign
    // against, which is worse than keeping the previous known-good set.
    if (next.length === 0) {
      throw new Error('chains_public returned no usable chain')
    }

    setChainRegistry(next)
    status = 'ready'
    error = ''
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not load chain configuration'
    if (quiet) {
      // A background refresh that fails changes nothing: the registry already
      // in place was validated when it loaded, and downgrading it to 'error'
      // over a transient blip would disable signing for no reason.
      console.warn('[chains] refresh failed, keeping the current config:', message)
      return
    }
    // First load: keep the bootstrap config, but SAY so - callers must be able
    // to tell a confirmed config from an unverified fallback.
    error = message
    status = 'error'
    console.warn('[chains] load failed, using bootstrap config:', error)
  } finally {
    if (!quiet || status === 'ready') emit()
  }
}

// Resolves once the DB chain config has been merged (or failed and fallen back
// to bootstrap). Await this before financially sensitive first loads if you want
// admin-updated fee/validator/endpoint values guaranteed present.
export const chainsReady: Promise<void> = doLoad()

export async function loadChains(): Promise<void> {
  return chainsReady
}

/**
 * Re-fetch the registry, quietly.
 *
 * The registry used to load exactly once, at module evaluation, so every
 * chain-derived setting - staking policy, the allowed-validator list, the
 * service fee and its collector, endpoints, explorer URLs - was frozen for the
 * life of the tab. An admin could save a change, walk to the staking page in the
 * same tab, and see the old behaviour with nothing to suggest why. Signing out
 * did not help either: the registry is a module singleton and logout only clears
 * auth state.
 *
 * Called after any admin save that alters chain configuration, and whenever the
 * tab regains focus - which also covers a change made by a different admin, or
 * in another tab.
 */
export async function refreshChains(): Promise<void> {
  await doLoad(true)
}

/**
 * Keep the registry fresh for the lifetime of the tab.
 *
 * Focus and visibility rather than a timer: the interesting moment is the user
 * coming back to the app, and polling a config that changes a few times a year
 * would be traffic spent on nothing. Installed once from main.tsx.
 */
export function watchChainConfig(): void {
  let last = 0
  const maybeRefresh = () => {
    if (document.visibilityState !== 'visible') return
    // Coalesce: focus and visibilitychange both fire on a tab switch, and
    // refetching twice for one return is pointless.
    const now = Date.now()
    if (now - last < 5_000) return
    last = now
    void refreshChains()
  }
  window.addEventListener('focus', maybeRefresh)
  document.addEventListener('visibilitychange', maybeRefresh)
}
