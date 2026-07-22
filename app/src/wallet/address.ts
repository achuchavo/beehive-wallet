import { fromBech32 } from '@cosmjs/encoding'

// Real Bech32 validation (HRP + checksum + data length), not a prefix/regex
// guess. Used wherever a user-supplied address enters a signing or watch flow.
// `fromBech32` throws on a bad checksum or malformed data, which is the whole
// point: a mistyped address fails here instead of on-chain.

const ACCOUNT_DATA_LEN = 20 // secp256k1 account/valoper address bytes

/** Throws a human-readable reason if `address` is not a valid account address for `prefix`. */
export function assertAccountAddress(address: string, prefix: string): void {
  assertBech32(address, prefix, 'address')
}

/** Throws if `address` is not a valid validator (valoper) address for `prefix`. */
export function assertValidatorAddress(address: string, prefix: string): void {
  assertBech32(address, `${prefix}valoper`, 'validator address')
}

function assertBech32(address: string, expectedPrefix: string, label: string): void {
  if (address !== address.trim()) {
    throw new Error(`${cap(label)} has leading or trailing whitespace`)
  }
  if (address === '') {
    throw new Error(`Enter a ${label}`)
  }
  let decoded: { prefix: string; data: Uint8Array }
  try {
    decoded = fromBech32(address)
  } catch {
    throw new Error(`Invalid ${label} (bad checksum or format)`)
  }
  if (decoded.prefix !== expectedPrefix) {
    throw new Error(`${cap(label)} must start with "${expectedPrefix}"`)
  }
  if (decoded.data.length !== ACCOUNT_DATA_LEN) {
    throw new Error(`Invalid ${label} length`)
  }
}

/** Boolean form of {@link assertAccountAddress}. */
export function isValidAccountAddress(address: string, prefix: string): boolean {
  try {
    assertAccountAddress(address, prefix)
    return true
  } catch {
    return false
  }
}

/** Boolean form of {@link assertValidatorAddress}. */
export function isValidValidatorAddress(address: string, prefix: string): boolean {
  try {
    assertValidatorAddress(address, prefix)
    return true
  } catch {
    return false
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
