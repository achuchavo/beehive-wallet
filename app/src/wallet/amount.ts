// Exact base-unit <-> display conversions.
//
// Blockchain integer amounts routinely exceed Number.MAX_SAFE_INTEGER, so every
// conversion, comparison, sum and floor here is string/BigInt based. Nothing in
// this module goes through `Number`, and no value is ever rendered in scientific
// notation.

/** "1.5" (display) -> "1500000" (base units), without float rounding. */
export function toBaseUnits(display: string, decimals: number): string {
  const trimmed = display.trim()
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error('Enter a valid amount')
  }
  const [whole, frac = ''] = trimmed.split('.')
  if (frac.length > decimals) {
    throw new Error(`Maximum ${decimals} decimal places`)
  }
  const base = (whole + frac.padEnd(decimals, '0')).replace(/^0+(?=\d)/, '')
  if (/^0*$/.test(base)) {
    throw new Error('Amount must be more than zero')
  }
  return base
}

/** "1500000" (base units) -> "1.5" (display), input-friendly (no separators). */
export function fromBaseUnits(base: string | number | bigint, decimals: number): string {
  let digits = String(base).split('.')[0].replace(/[^0-9]/g, '')
  if (!digits) return '0'
  digits = digits.padStart(decimals + 1, '0')
  const whole = digits.slice(0, digits.length - decimals).replace(/^0+(?=\d)/, '')
  const frac = digits.slice(digits.length - decimals).replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole
}

/** Human display with thousands separators, exact (no Number, no rounding). */
export function formatBase(
  base: string | number | bigint,
  decimals: number,
  maxFractionDigits?: number,
): string {
  const s = fromBaseUnits(base, decimals)
  const [whole, fracFull] = s.split('.')
  // Truncate (floor) the fraction to maxFractionDigits when asked - never round
  // up, so a displayed balance is never MORE than the wallet actually holds.
  const frac =
    maxFractionDigits !== undefined && fracFull
      ? fracFull.slice(0, maxFractionDigits).replace(/0+$/, '')
      : fracFull
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return frac ? `${grouped}.${frac}` : grouped
}

/**
 * Floor a possibly-decimal base-unit value (Cosmos distribution rewards come as
 * decimal strings like "12345.6789") to an integer base-unit string. Negative or
 * unparseable values clamp to "0".
 */
export function floorBaseUnits(value: string | number | bigint): string {
  const s = String(value).trim()
  if (s.startsWith('-')) return '0'
  const intPart = s.split('.')[0].replace(/[^0-9]/g, '')
  if (!intPart) return '0'
  return intPart.replace(/^0+(?=\d)/, '')
}

function toBig(v: string | number | bigint): bigint {
  if (typeof v === 'bigint') return v
  return BigInt(floorBaseUnits(v))
}

/** Exact sum of base-unit values, returned as a base-unit string. */
export function sumBase(values: (string | number | bigint)[]): string {
  let total = 0n
  for (const v of values) total += toBig(v)
  return total.toString()
}

/** a + b for base-unit strings. */
export function addBase(a: string | number | bigint, b: string | number | bigint): string {
  return (toBig(a) + toBig(b)).toString()
}

/** a - b for base-unit strings (clamped at 0). */
export function subBase(a: string | number | bigint, b: string | number | bigint): string {
  const r = toBig(a) - toBig(b)
  return r < 0n ? '0' : r.toString()
}

/** Exact comparison: -1 | 0 | 1. Safe for sorting large base-unit strings. */
export function compareBase(a: string | number | bigint, b: string | number | bigint): number {
  const x = toBig(a)
  const y = toBig(b)
  return x < y ? -1 : x > y ? 1 : 0
}

/** True when a base-unit value is strictly greater than zero. */
export function isPositiveBase(v: string | number | bigint): boolean {
  return toBig(v) > 0n
}
