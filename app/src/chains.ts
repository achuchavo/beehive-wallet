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
    rpc: 'https://rpc.gopanacea.org',
    // Dev: Vite proxy relays to the public LCD (which sends no CORS headers).
    // Prod: lcd_proxy.php relays server-side until our own node is up.
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
