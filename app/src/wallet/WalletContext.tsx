import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing'
import { stringToPath } from '@cosmjs/crypto'
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

interface WalletContextValue {
  wallets: StoredWallet[]
  active: StoredWallet | null
  setActive: (address: string) => void
  addWallet: (
    name: string,
    mnemonic: string,
    password: string,
    chain: ChainInfo,
  ) => Promise<StoredWallet>
  removeWallet: (address: string) => void
  /** Decrypts the mnemonic. Throws 'Wrong password'. Caller must not store it. */
  revealMnemonic: (address: string, password: string) => Promise<string>
  /** Builds a signer for one signing operation. Throws 'Wrong password'. */
  getSigner: (address: string, password: string) => Promise<DirectSecp256k1HdWallet>
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
    async (name: string, mnemonic: string, password: string, chain: ChainInfo) => {
      const wallet = await mnemonicToWallet(mnemonic, chain)
      const [account] = await wallet.getAccounts()
      const current = loadWallets()
      if (current.some((w) => w.address === account.address)) {
        throw new Error('This wallet is already added')
      }
      const stored: StoredWallet = {
        name: name.trim() || 'My wallet',
        chainKey: chain.key,
        address: account.address,
        encrypted: await encryptText(mnemonic.trim(), password),
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

  const revealMnemonic = useCallback(
    async (address: string, password: string) => {
      const stored = loadWallets().find((w) => w.address === address)
      if (!stored) throw new Error('Wallet not found')
      return decryptText(stored.encrypted, password)
    },
    [],
  )

  const getSigner = useCallback(
    async (address: string, password: string) => {
      const stored = loadWallets().find((w) => w.address === address)
      if (!stored) throw new Error('Wallet not found')
      const chain = CHAINS.find((c) => c.key === stored.chainKey)
      if (!chain) throw new Error('Unknown chain')
      const mnemonic = await decryptText(stored.encrypted, password)
      return mnemonicToWallet(mnemonic, chain)
    },
    [],
  )

  const value = useMemo<WalletContextValue>(() => {
    const active = wallets.find((w) => w.address === activeAddress) ?? wallets[0] ?? null
    return { wallets, active, setActive, addWallet, removeWallet, revealMnemonic, getSigner }
  }, [wallets, activeAddress, setActive, addWallet, removeWallet, revealMnemonic, getSigner])

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used inside WalletProvider')
  return ctx
}
