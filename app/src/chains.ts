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
  beehiveValidator: string
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
    // Dev: Vite proxy relays to the public endpoints (which send no CORS
    // headers). Prod: lcd_proxy.php / rpc_proxy.php relay server-side until
    // our own node (with CORS in nginx) is up.
    // CosmJS requires an absolute RPC URL (it inspects the protocol).
    rpc: import.meta.env.DEV
      ? `${window.location.origin}/rpc/medibloc`
      : `${window.location.origin}${import.meta.env.BASE_URL}api/rpc_proxy.php`,
    lcd: import.meta.env.DEV
      ? '/lcd/medibloc'
      : `${import.meta.env.BASE_URL}api/lcd_proxy.php`,
    explorerTxUrl: 'https://www.mintscan.io/medibloc/tx/',
    beehiveValidator: 'panaceavaloper1REPLACE_WITH_OUR_VALOPER',
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
