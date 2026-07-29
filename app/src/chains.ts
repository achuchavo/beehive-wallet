// Chain registry. Adding a chain to the app = adding an entry here.
// TODO: replace rpc/lcd with our own node endpoints once the Vultr Seoul node is up
// (e.g. https://rpc-medi.achumuamah.com / https://lcd-medi.achumuamah.com).

import { fromBech32 } from '@cosmjs/encoding'
import {
  toBaseUnits as amountToBaseUnits,
  fromBaseUnits as amountFromBaseUnits,
  formatBase,
} from './wallet/amount'

export type StakingPolicy = 'all' | 'allowlist' | 'allowlist_paid'
export const STAKING_POLICIES: StakingPolicy[] = ['all', 'allowlist', 'allowlist_paid']

export interface ChainInfo {
  key: string
  chainId: string
  chainName: string
  bech32Prefix: string
  denom: string
  displayDenom: string
  decimals: number
  coinType: number
  gasPrice: string
  rpc: string
  lcd: string
  explorerTxUrl: string
  explorerValidatorUrl: string
  beehiveValidator: string
  beehiveMoniker: string
  coingeckoId: string
  // Admin-managed validator list. What it means depends on stakingPolicy.
  freeValidators: string[]
  /**
   * What this app offers for delegation on this chain (migration 013):
   *   all             every validator, no fee
   *   allowlist       only freeValidators, at any price
   *   allowlist_paid  freeValidators free, others bundle serviceFee
   */
  stakingPolicy: StakingPolicy
  // Service fee charged when delegating to a validator NOT in freeValidators,
  // bundled as a bank send in the same signed tx. "0" = no fee.
  serviceFee: string
  feeCollector: string
}

const API_ORIGIN = `${window.location.origin}${import.meta.env.BASE_URL}api`

// Per-chain proxy URLs. Path form is /<chainKey>/cosmos/... so callers just do
// `${chain.lcd}/cosmos/...`. CosmJS needs an absolute RPC URL.
export function proxyLcd(key: string): string {
  return `${API_ORIGIN}/lcd_proxy.php/${key}`
}
export function proxyRpc(key: string): string {
  return `${API_ORIGIN}/rpc_proxy.php?chain=${key}`
}

// Bootstrap registry, replaced wholesale once the DB config loads.
//
// CHAINS and DEFAULT_CHAIN are `let` on purpose: ES module live bindings mean
// every importer observes the replacement, so nothing has to be mutated in
// place. chainStore.setChains() is the ONLY writer - it swaps in a brand new
// array of brand new objects, so a component holding an old ChainInfo keeps a
// stable, consistent snapshot rather than seeing fields change underneath it.
export let CHAINS: ChainInfo[] = [
  {
    key: 'medibloc',
    chainId: 'panacea-3',
    chainName: 'Medibloc',
    bech32Prefix: 'panacea',
    denom: 'umed',
    displayDenom: 'MED',
    decimals: 6,
    coinType: 371,
    gasPrice: '5umed',
    // All chain traffic goes through our PHP proxies, which read the chain's
    // endpoint list from the DB and fail over between them server-side. Same
    // path in dev (Vite forwards /wallet/api to Apache) and prod.
    rpc: proxyRpc('medibloc'),
    lcd: proxyLcd('medibloc'),
    explorerTxUrl: 'https://www.mintscan.io/medibloc/tx/',
    explorerValidatorUrl: 'https://www.mintscan.io/medibloc/validators/',
    beehiveValidator: 'panaceavaloper1hlpw58lg9fvwvwa3ryzgjqyw39tf2nmns4r0z5',
    beehiveMoniker: 'MatanVerse [Official]',
    coingeckoId: 'medibloc',
    freeValidators: ['panaceavaloper1hlpw58lg9fvwvwa3ryzgjqyw39tf2nmns4r0z5'],
    // Bootstrap default: unrestricted, matching the shipped behaviour before a
    // policy is loaded from the database.
    stakingPolicy: 'all',
    serviceFee: '0',
    feeCollector: '',
  },
]

// Bootstrap default. Prefer resolveChain(wallet.chainKey) for wallet-specific
// (signing) operations - see resolveChain / findChain below.
export let DEFAULT_CHAIN = CHAINS[0]

/**
 * Replace the registry. Called ONLY by chainStore once the DB config has been
 * validated. Replacing (rather than mutating) is what makes a rendered chain
 * snapshot stable, and what lets React detect the change.
 */
export function setChainRegistry(next: ChainInfo[]): void {
  CHAINS = next
  DEFAULT_CHAIN = next[0]
}

/** The chain for a wallet's chainKey, or undefined if it is not configured. */
export function findChain(chainKey: string): ChainInfo | undefined {
  return CHAINS.find((c) => c.key === chainKey)
}

/**
 * The chain for a wallet's chainKey. Throws a clear error if the chain is not
 * configured - callers must block the operation rather than fall back to another
 * chain for signing.
 */
export function resolveChain(chainKey: string): ChainInfo {
  const chain = findChain(chainKey)
  if (!chain) {
    throw new Error(`Chain "${chainKey}" is not configured. Reload the app and try again.`)
  }
  return chain
}

/**
 * Resolve a chain from an account address by its Bech32 HRP (prefix). Used by the
 * read-only History explorer, which works on arbitrary addresses with no wallet
 * context. Falls back to DEFAULT_CHAIN for unrecognized/invalid input.
 */
export function chainForAddress(address: string): ChainInfo {
  try {
    const { prefix } = fromBech32(address)
    return CHAINS.find((c) => c.bech32Prefix === prefix) ?? DEFAULT_CHAIN
  } catch {
    return DEFAULT_CHAIN
  }
}

// Exact display formatting (grouped, no Number, no scientific notation).
export function formatAmount(raw: string | number | bigint, chain: ChainInfo): string {
  return formatBase(raw, chain.decimals)
}

// "1500000" umed -> "1.5" MED as a clean, input-friendly string (no commas).
export function fromBaseUnits(base: string | number | bigint, chain: ChainInfo): string {
  return amountFromBaseUnits(base, chain.decimals)
}

// "1.5" MED -> "1500000" umed without float rounding errors.
export function toBaseUnits(display: string, chain: ChainInfo): string {
  return amountToBaseUnits(display, chain.decimals)
}

// An exact decimal held as integer mantissa + power-of-ten scale, so that
// value === mantissa / 10^scale. Gas prices are decimal on almost every Cosmos
// chain ("0.025uatom"), and every one of them feeds a spendable amount, so none
// of the maths below is allowed to go through a float.
interface ScaledDecimal {
  mantissa: bigint
  scale: number
}

const ONE: ScaledDecimal = { mantissa: 1n, scale: 0 }

/** Parse a plain decimal string ("5", "0.025") exactly. Null if malformed. */
function parseDecimal(text: string): ScaledDecimal | null {
  const m = text.trim().match(/^(\d+)(?:\.(\d+))?$/)
  if (!m) return null
  const frac = m[2] ?? ''
  return { mantissa: BigInt(m[1] + frac), scale: frac.length }
}

/** Exact product: mantissas multiply, scales add. */
function multiplyScaled(a: ScaledDecimal, b: ScaledDecimal): ScaledDecimal {
  return { mantissa: a.mantissa * b.mantissa, scale: a.scale + b.scale }
}

/** Render as a compact decimal string - fromBaseUnits is already exact. */
function renderScaled({ mantissa, scale }: ScaledDecimal): string {
  return amountFromBaseUnits(mantissa.toString(), scale)
}

/**
 * Split a gas price like "5umed" or "0.025uatom" into an exact amount and denom.
 * The denom pattern matches the server-side validation in admin_chain_save.php,
 * so anything an admin can save here parses identically on both sides.
 */
export function parseGasPrice(chain: ChainInfo): { amount: ScaledDecimal; denom: string } {
  const m = chain.gasPrice.trim().match(/^(\d+(?:\.\d+)?)([a-zA-Z][a-zA-Z0-9/:._-]*)$/)
  const amount = m ? parseDecimal(m[1]) : null
  return { amount: amount ?? { mantissa: 0n, scale: 0 }, denom: m ? m[2] : chain.denom }
}

/**
 * Fee to hold back from a "Max" spend so the tx can still pay gas: the chain's
 * gas price x gas limit x 1.5, since fees are auto-estimated at broadcast and a
 * reserve that is even one base unit short fails the whole transaction.
 *
 * Exact, and rounded UP. The previous implementation read the gas price with
 * parseInt, which truncated "0.025uatom" to 0 and so reserved nothing at all on
 * any chain with a fractional minimum gas price - i.e. every Cosmos chain except
 * Medibloc, whose integer "5umed" is what kept this hidden.
 */
export function feeReserve(chain: ChainInfo, gasLimit: number): string {
  const { amount } = parseGasPrice(chain)
  if (amount.mantissa <= 0n || !Number.isFinite(gasLimit) || gasLimit <= 0) return '0'

  const gas = BigInt(Math.floor(gasLimit))
  const numerator = amount.mantissa * gas * 3n
  const denominator = 2n * 10n ** BigInt(amount.scale)
  // Ceiling division: under-reserving is a failed broadcast, over-reserving by
  // one base unit is invisible.
  return ((numerator + denominator - 1n) / denominator).toString()
}

// Scale the chain's minimum gas price by a speed multiplier, returning a
// CosmJS-parseable gas price string (e.g. 1.5 x "5umed" -> "7.5umed"). Paying a
// higher gas price is what gets a transaction picked up faster by validators.
export function scaledGasPrice(chain: ChainInfo, multiplier: number): string {
  const { amount, denom } = parseGasPrice(chain)
  return `${renderScaled(multiplyScaled(amount, scaleMultiplier(multiplier)))}${denom}`
}

// The same scaled gas price expressed in the display denom (MED), as a compact
// decimal string. Informational only - the fee shown in the review is computed
// with exact Decimal math by CosmJS.
export function gasPriceInDisplay(chain: ChainInfo, multiplier: number): string {
  const { amount } = parseGasPrice(chain)
  const scaled = multiplyScaled(amount, scaleMultiplier(multiplier))
  // Dividing by 10^decimals is just a scale shift, so this stays exact.
  return renderScaled({ mantissa: scaled.mantissa, scale: scaled.scale + chain.decimals })
}

// Speed multipliers are UI constants (1, 1.5, 2). Anything unparseable - a
// negative, NaN or Infinity - falls back to the chain minimum rather than
// silently producing a nonsense price.
function scaleMultiplier(multiplier: number): ScaledDecimal {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return ONE
  return parseDecimal(String(multiplier)) ?? ONE
}
