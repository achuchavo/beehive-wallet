// Policy for the LOCAL wallet-encryption password. This is NOT the alarm-account
// password: this one derives the AES key that encrypts the seed/private key in
// this browser and is never sent anywhere. It is never logged or persisted.

const MIN_LENGTH = 10
const MAX_BYTES = 200 // keep PBKDF2 input bounded; well above any real passphrase

// A small set of obviously-weak passwords to reject outright. Not exhaustive -
// the strength hint below nudges toward better ones.
const COMMON = new Set([
  'password',
  'password1',
  'password123',
  '1234567890',
  '12345678',
  'qwertyuiop',
  'qwerty123',
  'iloveyou',
  '11111111',
  '00000000',
  'letmein',
  'admin123',
  'welcome1',
  'abc12345',
  'passw0rd',
  'trustno1',
  'walletpassword',
  'beehive123',
])

/** A blocking error key for an unacceptable wallet password, or null if allowed. */
export function walletPasswordError(pw: string): string | null {
  const bytes = new TextEncoder().encode(pw).length
  if (pw.length < MIN_LENGTH) return 'pw.tooShort'
  if (bytes > MAX_BYTES) return 'pw.tooLong'
  if (COMMON.has(pw.toLowerCase())) return 'pw.common'
  return null
}

/** True for an allowed-but-weak password (advisory hint, does not block). */
export function walletPasswordWeak(pw: string): boolean {
  if (walletPasswordError(pw)) return false // it's blocked, not merely weak
  const variety = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length
  // Short + low character variety => weak. A long passphrase is fine on length.
  return pw.length < 14 && variety < 3
}
