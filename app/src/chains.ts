// Chain registry. Adding a chain to the app = adding an entry here.
// TODO: replace rpc/lcd with our own node endpoints once the Vultr Seoul node is up
// (e.g. https://rpc-medi.achumuamah.com / https://lcd-medi.achumuamah.com).

import { fromBech32 } from '@cosmjs/encoding'
import {
  toBaseUnits as amountToBaseUnits,
  fromBaseUnits as amountFromBaseUnits,
  formatBase,
} from './wallet/amount'

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
  // Validators offered for free staking (no service fee), admin-managed.
  freeValidators: string[]
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

export const CHAINS: ChainInfo[] = [
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
    serviceFee: '0',
    feeCollector: '',
  },
]

// Bootstrap default. Prefer resolveChain(wallet.chainKey) for wallet-specific
// (signing) operations - see resolveChain / findChain below.
export const DEFAULT_CHAIN = CHAINS[0]

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

// Rough fee to hold back from a "Max" spend so the tx can still pay gas.
// Fees are auto-estimated at broadcast; this is a safe over-estimate (~1.5x),
// computed with integer math so no float creeps into a spend total.
export function feeReserve(chain: ChainInfo, gasLimit: number): string {
  const gasNum = BigInt(parseInt(chain.gasPrice, 10) || 0)
  return ((gasNum * BigInt(Math.floor(gasLimit)) * 3n) / 2n).toString()
}
