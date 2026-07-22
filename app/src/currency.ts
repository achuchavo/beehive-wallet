// Fiat currency preference and price conversion.

import { fromBaseUnits } from './wallet/amount'

export interface Currency {
  code: string
  symbol: string
  label: string
  decimals: number
}

export const CURRENCIES: Currency[] = [
  { code: 'krw', symbol: '₩', label: 'KRW', decimals: 0 },
  { code: 'usd', symbol: '$', label: 'USD', decimals: 2 },
  { code: 'eur', symbol: '€', label: 'EUR', decimals: 2 },
  { code: 'jpy', symbol: '¥', label: 'JPY', decimals: 0 },
  { code: 'gbp', symbol: '£', label: 'GBP', decimals: 2 },
]

const KEY = 'beehive_currency_v1'

export function getCurrency(): string {
  return localStorage.getItem(KEY) || 'krw'
}

export function setCurrency(code: string): void {
  localStorage.setItem(KEY, code)
}

// Price of one display token in the given currency (via cached server proxy).
export async function fetchPrice(coingeckoId: string, currency: string): Promise<number | null> {
  if (!coingeckoId) return null
  const base = `${import.meta.env.BASE_URL}api/price.php`.replace('//', '/')
  try {
    const res = await fetch(`${base}?id=${coingeckoId}&currency=${currency}`)
    if (!res.ok) return null
    const data = await res.json()
    return typeof data.price === 'number' ? data.price : null
  } catch {
    return null
  }
}

/**
 * Fiat value of a base-unit token amount.
 *
 * The base-unit -> token conversion is done exactly on the digit string first
 * (fromBaseUnits), so a balance beyond Number.MAX_SAFE_INTEGER is not rounded
 * before it is scaled. Only the final token*price product becomes a JS number,
 * which is a bounded display value and never feeds a transaction.
 */
export function fiatValue(amountBase: string | number, decimals: number, price: number): number {
  const tokens = Number(fromBaseUnits(amountBase, decimals))
  if (!Number.isFinite(tokens)) return 0
  return tokens * price
}

export function formatFiat(value: number, currency: string): string {
  const c = CURRENCIES.find((x) => x.code === currency)
  const symbol = c?.symbol ?? ''
  const d = c?.decimals ?? 2
  return (
    symbol +
    value.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d })
  )
}
