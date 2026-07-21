import type { EncryptedPayload } from './crypto'

export interface StoredWallet {
  name: string
  chainKey: string
  address: string
  /** What the encrypted payload contains. Missing = mnemonic (pre-privkey wallets). */
  kind?: 'mnemonic' | 'privkey'
  encrypted: EncryptedPayload
  createdAt: string
}

const WALLETS_KEY = 'beehive_wallets_v1'
const ACTIVE_KEY = 'beehive_active_wallet_v1'

export function loadWallets(): StoredWallet[] {
  try {
    const raw = localStorage.getItem(WALLETS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveWallets(wallets: StoredWallet[]): void {
  localStorage.setItem(WALLETS_KEY, JSON.stringify(wallets))
}

export function loadActiveAddress(): string | null {
  return localStorage.getItem(ACTIVE_KEY)
}

export function saveActiveAddress(address: string | null): void {
  if (address === null) {
    localStorage.removeItem(ACTIVE_KEY)
  } else {
    localStorage.setItem(ACTIVE_KEY, address)
  }
}
