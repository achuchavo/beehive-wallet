// Mnemonic encryption. The seed phrase is encrypted with AES-256-GCM using a
// key derived from the user's password via PBKDF2 (300k iterations, SHA-256).
// Everything happens in the browser with the Web Crypto API - the plaintext
// mnemonic and the password never leave this device.

export interface EncryptedPayload {
  v: 1 | 2
  salt: string
  iv: string
  data: string
  // v2 records its KDF cost so it can be raised over time without breaking old
  // wallets. v1 payloads have no field and always mean 300k iterations.
  iterations?: number
}

// v1 wallets were encrypted at 300k. New wallets use a stronger cost (OWASP 2023
// guidance for PBKDF2-HMAC-SHA256). Old payloads still decrypt at their own cost;
// this is a transparent, backward-compatible upgrade for newly created wallets.
const PBKDF2_ITERATIONS_V1 = 300_000
const PBKDF2_ITERATIONS = 600_000

const enc = new TextEncoder()
const dec = new TextDecoder()

function iterationsOf(payload: EncryptedPayload): number {
  return payload.v >= 2 && payload.iterations ? payload.iterations : PBKDF2_ITERATIONS_V1
}

function toB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password) as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptText(plain: string, password: string): Promise<EncryptedPayload> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS)
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    enc.encode(plain) as BufferSource,
  )
  return {
    v: 2,
    iterations: PBKDF2_ITERATIONS,
    salt: toB64(salt),
    iv: toB64(iv),
    data: toB64(new Uint8Array(cipher)),
  }
}

export async function decryptText(payload: EncryptedPayload, password: string): Promise<string> {
  const key = await deriveKey(password, fromB64(payload.salt), iterationsOf(payload))
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(payload.iv) as BufferSource },
      key,
      fromB64(payload.data) as BufferSource,
    )
    return dec.decode(plain)
  } catch {
    throw new Error('Wrong password')
  }
}
