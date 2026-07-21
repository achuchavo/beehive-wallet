// Chain registry. Adding a chain to the app = adding an entry here.
// TODO: replace rpc/lcd with our own node endpoints once the Vultr Seoul node is up
// (e.g. https://rpc-medi.achumuamah.com / https://lcd-medi.achumuamah.com).

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
  // Service fee charged when delegating to a NON-Beehive validator, bundled as
  // a bank send in the same signed tx. "0" = no fee (staking anywhere is free).
  // Set feeCollector to a Beehive account address to start charging.
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
    serviceFee: '0',
    feeCollector: '',
  },
]

export const DEFAULT_CHAIN = CHAINS[0]

export function formatAmount(raw: string | number, chain: ChainInfo): string {
  const value = Number(raw) / 10 ** chain.decimals
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 })
}

// "1.5" MED -> "1500000" umed without float rounding errors.
export function toBaseUnits(display: string, chain: ChainInfo): string {
  const trimmed = display.trim()
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error('Enter a valid amount')
  }
  const [whole, frac = ''] = trimmed.split('.')
  if (frac.length > chain.decimals) {
    throw new Error(`Maximum ${chain.decimals} decimal places`)
  }
  const base = whole + frac.padEnd(chain.decimals, '0')
  const clean = base.replace(/^0+(?=\d)/, '')
  if (clean === '0'.repeat(clean.length)) {
    throw new Error('Amount must be more than zero')
  }
  return clean
}
