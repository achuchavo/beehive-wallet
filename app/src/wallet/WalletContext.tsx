import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import {
  DirectSecp256k1HdWallet,
  DirectSecp256k1Wallet,
  type OfflineDirectSigner,
} from '@cosmjs/proto-signing'
import { stringToPath } from '@cosmjs/crypto'
import { fromHex } from '@cosmjs/encoding'
import { CHAINS, type ChainInfo } from '../chains'
import { encryptText, decryptText } from './crypto'
import {
  loadWallets,
  saveWallets,
  loadActiveAddress,
  saveActiveAddress,
  type StoredWallet,
} from './storage'

function hdPath(chain: ChainInfo) {
  return stringToPath(`m/44'/${chain.coinType}'/0'/0/0`)
}

export async function mnemonicToWallet(
  mnemonic: string,
  chain: ChainInfo,
): Promise<DirectSecp256k1HdWallet> {
  return DirectSecp256k1HdWallet.fromMnemonic(mnemonic.trim(), {
    prefix: chain.bech32Prefix,
    hdPaths: [hdPath(chain)],
  })
}

export async function generateMnemonic(chain: ChainInfo): Promise<string> {
  const wallet = await DirectSecp256k1HdWallet.generate(24, {
    prefix: chain.bech32Prefix,
    hdPaths: [hdPath(chain)],
  })
  return wallet.mnemonic
}

export type WalletKind = 'mnemonic' | 'privkey'

export function normalizePrivkey(input: string): string {
  const hex = input.trim().toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error('Private key must be 64 hex characters (32 bytes)')
  }
  return hex
}

async function secretToSigner(
  secret: string,
  kind: WalletKind,
  chain: ChainInfo,
): Promise<OfflineDirectSigner> {
  if (kind === 'privkey') {
    return DirectSecp256k1Wallet.fromKey(fromHex(normalizePrivkey(secret)), chain.bech32Prefix)
  }
  return mnemonicToWallet(secret, chain)
}

interface WalletContextValue {
  wallets: StoredWallet[]
  active: StoredWallet | null
  setActive: (address: string) => void
  addWallet: (
    name: string,
    secret: string,
    password: string,
    chain: ChainInfo,
    kind?: WalletKind,
  ) => Promise<StoredWallet>
  removeWallet: (address: string) => void
  /** Decrypts the seed phrase or private key. Throws 'Wrong password'. Caller must not store it. */
  revealSecret: (address: string, password: string) => Promise<{ secret: string; kind: WalletKind }>
  /** Builds a signer for one signing operation. Throws 'Wrong password'. */
  getSigner: (address: string, password: string) => Promise<OfflineDirectSigner>
}

const WalletContext = createContext<WalletContextValue | null>(null)

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallets, setWallets] = useState<StoredWallet[]>(loadWallets)
  const [activeAddress, setActiveAddress] = useState<string | null>(loadActiveAddress)

  const persist = useCallback((next: StoredWallet[]) => {
    setWallets(next)
    saveWallets(next)
  }, [])

  const setActive = useCallback((address: string) => {
    setActiveAddress(address)
    saveActiveAddress(address)
  }, [])

  const addWallet = useCallback(
    async (
      name: string,
      secret: string,
      password: string,
      chain: ChainInfo,
      kind: WalletKind = 'mnemonic',
    ) => {
      const cleanSecret = kind === 'privkey' ? normalizePrivkey(secret) : secret.trim()
      const signer = await secretToSigner(cleanSecret, kind, chain)
      const [account] = await signer.getAccounts()
      const current = loadWallets()
      if (current.some((w) => w.address === account.address)) {
        throw new Error('This wallet is already added')
      }
      const stored: StoredWallet = {
        name: name.trim() || 'My wallet',
        chainKey: chain.key,
        address: account.address,
        kind,
        encrypted: await encryptText(cleanSecret, password),
        createdAt: new Date().toISOString(),
      }
      const next = [...current, stored]
      persist(next)
      setActive(stored.address)
      return stored
    },
    [persist, setActive],
  )

  const removeWallet = useCallback(
    (address: string) => {
      const next = loadWallets().filter((w) => w.address !== address)
      persist(next)
      if (activeAddress === address) {
        const fallback = next[0]?.address ?? null
        setActiveAddress(fallback)
        saveActiveAddress(fallback)
      }
    },
    [activeAddress, persist],
  )

  const revealSecret = useCallback(
    async (address: string, password: string) => {
      const stored = loadWallets().find((w) => w.address === address)
      if (!stored) throw new Error('Wallet not found')
      const secret = await decryptText(stored.encrypted, password)
      return { secret, kind: (stored.kind ?? 'mnemonic') as WalletKind }
    },
    [],
  )

  const getSigner = useCallback(
    async (address: string, password: string) => {
      const stored = loadWallets().find((w) => w.address === address)
      if (!stored) throw new Error('Wallet not found')
      const chain = CHAINS.find((c) => c.key === stored.chainKey)
      if (!chain) throw new Error('Unknown chain')
      const secret = await decryptText(stored.encrypted, password)
      return secretToSigner(secret, stored.kind ?? 'mnemonic', chain)
    },
    [],
  )

  const value = useMemo<WalletContextValue>(() => {
    const active = wallets.find((w) => w.address === activeAddress) ?? wallets[0] ?? null
    return { wallets, active, setActive, addWallet, removeWallet, revealSecret, getSigner }
  }, [wallets, activeAddress, setActive, addWallet, removeWallet, revealSecret, getSigner])

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used inside WalletProvider')
  return ctx
}
