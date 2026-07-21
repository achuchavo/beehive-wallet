import { describe, it, expect } from 'vitest'
import { encryptText, decryptText, type EncryptedPayload } from './crypto'

const SEED =
  'legal winner thank year wave sausage worth useful legal winner thank yellow'

// Build a legacy v1 payload (300k iterations, no `iterations` field) exactly as
// the old code did, to prove decryptText still reads existing wallets.
async function makeV1(plain: string, password: string): Promise<EncryptedPayload> {
  const enc = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 300_000, hash: 'SHA-256' },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain))
  const b64 = (b: ArrayBuffer | Uint8Array) =>
    btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer)))
  return { v: 1, salt: b64(salt), iv: b64(iv), data: b64(cipher) }
}

describe('crypto', () => {
  it('round-trips a secret (v2)', async () => {
    const payload = await encryptText(SEED, 'correct horse battery staple')
    expect(payload.v).toBe(2)
    expect(payload.iterations).toBe(600_000)
    const out = await decryptText(payload, 'correct horse battery staple')
    expect(out).toBe(SEED)
  })

  it('fails with the wrong password', async () => {
    const payload = await encryptText(SEED, 'right-password-123')
    await expect(decryptText(payload, 'wrong-password-123')).rejects.toThrow(/wrong password/i)
  })

  it('still decrypts legacy v1 (300k) payloads', async () => {
    const v1 = await makeV1(SEED, 'legacy-password-123')
    expect(v1.v).toBe(1)
    expect((v1 as EncryptedPayload).iterations).toBeUndefined()
    const out = await decryptText(v1, 'legacy-password-123')
    expect(out).toBe(SEED)
  })

  it('produces a distinct salt/iv each time', async () => {
    const a = await encryptText(SEED, 'pw-abcdefghij')
    const b = await encryptText(SEED, 'pw-abcdefghij')
    expect(a.salt).not.toBe(b.salt)
    expect(a.iv).not.toBe(b.iv)
    expect(a.data).not.toBe(b.data)
  })
})
