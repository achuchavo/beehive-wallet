import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import {
  DirectSecp256k1HdWallet,
  DirectSecp256k1Wallet,
  type OfflineDirectSigner,
} from '@cosmjs/proto-signing'
import {
  stringToPath,
  Secp256k1,
  sha256,
  Bip39,
  EnglishMnemonic,
  Slip10,
  Slip10Curve,
} from '@cosmjs/crypto'
import { fromHex, toBase64, toUtf8 } from '@cosmjs/encoding'
import { CHAINS, type ChainInfo } from '../chains'
import { encryptText, decryptText } from './crypto'
import {
  loadWallets,
  saveWallets,
  loadActiveWalletId,
  saveActiveWalletId,
  newWalletId,
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

/**
 * ADR-036 amino sign doc for an arbitrary message. Key order is alphabetical
 * and JSON.stringify does not escape '/', which matters because the base64
 * payload can contain one - the PHP verifier rebuilds these exact bytes with
 * JSON_UNESCAPED_SLASHES, and any mismatch would fail verification.
 */
export function adr36SignDoc(message: string, signer: string): string {
  return JSON.stringify({
    account_number: '0',
    chain_id: '',
    fee: { amount: [], gas: '0' },
    memo: '',
    msgs: [{ type: 'sign/MsgSignData', value: { data: toBase64(toUtf8(message)), signer } }],
    sequence: '0',
  })
}

/** Private key for a stored wallet secret. Callers must not retain it. */
async function secretToPrivkey(
  secret: string,
  kind: WalletKind,
  chain: ChainInfo,
): Promise<Uint8Array> {
  if (kind === 'privkey') {
    return fromHex(normalizePrivkey(secret))
  }
  const seed = await Bip39.mnemonicToSeed(new EnglishMnemonic(secret.trim()))
  return Slip10.derivePath(Slip10Curve.Secp256k1, seed, hdPath(chain)).privkey
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
  setActive: (walletId: string) => void
  addWallet: (
    name: string,
    secret: string,
    password: string,
    chain: ChainInfo,
    kind?: WalletKind,
  ) => Promise<StoredWallet>
  removeWallet: (walletId: string) => void
  /** Decrypts the seed phrase or private key. Throws 'Wrong password'. Caller must not store it. */
  revealSecret: (walletId: string, password: string) => Promise<{ secret: string; kind: WalletKind }>
  /** Builds a signer for one signing operation. Throws 'Wrong password'. */
  getSigner: (walletId: string, password: string) => Promise<OfflineDirectSigner>
  /**
   * Proves control of the wallet's address by signing a server-issued challenge
   * (ADR-036). The secret never leaves the call. Throws 'Wrong password'.
   */
  signOwnership: (
    walletId: string,
    password: string,
    message: string,
  ) => Promise<{ pubkey: string; signature: string }>
}

const WalletContext = createContext<WalletContextValue | null>(null)

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallets, setWallets] = useState<StoredWallet[]>(loadWallets)
  // Identity is the wallet id, never the address: the same address can be a
  // different account on another chain. See storage.ts.
  const [activeId, setActiveId] = useState<string | null>(() => loadActiveWalletId(loadWallets()))

  const persist = useCallback((next: StoredWallet[]) => {
    setWallets(next)
    saveWallets(next)
  }, [])

  const setActive = useCallback((walletId: string) => {
    setActiveId(walletId)
    saveActiveWalletId(walletId)
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
      // A duplicate only when the SAME address is already stored for the SAME
      // chain. The same address on another network is a different account and
      // must be allowed.
      if (current.some((w) => w.address === account.address && w.chainKey === chain.key)) {
        throw new Error('This wallet is already added')
      }
      const stored: StoredWallet = {
        id: newWalletId(),
        name: name.trim() || 'My wallet',
        chainKey: chain.key,
        address: account.address,
        kind,
        encrypted: await encryptText(cleanSecret, password),
        createdAt: new Date().toISOString(),
      }
      const next = [...current, stored]
      persist(next)
      setActive(stored.id)
      return stored
    },
    [persist, setActive],
  )

  const removeWallet = useCallback(
    (walletId: string) => {
      const next = loadWallets().filter((w) => w.id !== walletId)
      persist(next)
      if (activeId === walletId) {
        const fallback = next[0]?.id ?? null
        setActiveId(fallback)
        saveActiveWalletId(fallback, next)
      }
    },
    [activeId, persist],
  )

  const revealSecret = useCallback(
    async (walletId: string, password: string) => {
      const stored = loadWallets().find((w) => w.id === walletId)
      if (!stored) throw new Error('Wallet not found')
      const secret = await decryptText(stored.encrypted, password)
      return { secret, kind: (stored.kind ?? 'mnemonic') as WalletKind }
    },
    [],
  )

  const getSigner = useCallback(
    async (walletId: string, password: string) => {
      const stored = loadWallets().find((w) => w.id === walletId)
      if (!stored) throw new Error('Wallet not found')
      const chain = CHAINS.find((c) => c.key === stored.chainKey)
      if (!chain) throw new Error('Unknown chain')
      const secret = await decryptText(stored.encrypted, password)
      return secretToSigner(secret, stored.kind ?? 'mnemonic', chain)
    },
    [],
  )

  /**
   * Sign an address-ownership challenge (ADR-036) to prove this wallet holds
   * the key for `address`. The seed/private key is derived, used, and zeroed
   * here - it is never returned to the caller and never leaves this function.
   */
  const signOwnership = useCallback(
    async (walletId: string, password: string, message: string) => {
      const stored = loadWallets().find((w) => w.id === walletId)
      if (!stored) throw new Error('Wallet not found')
      const chain = CHAINS.find((c) => c.key === stored.chainKey)
      if (!chain) throw new Error('Unknown chain')

      const secret = await decryptText(stored.encrypted, password)
      let privkey: Uint8Array | null = null
      try {
        privkey = await secretToPrivkey(secret, stored.kind ?? 'mnemonic', chain)
        const { pubkey } = await Secp256k1.makeKeypair(privkey)
        const doc = adr36SignDoc(message, stored.address)
        const sig = await Secp256k1.createSignature(sha256(toUtf8(doc)), privkey)
        return {
          // Uncompressed (65 bytes): lets the server derive the address by
          // compressing it, avoiding a modular square root in PHP.
          pubkey: toBase64(pubkey),
          signature: toBase64(new Uint8Array([...sig.r(32), ...sig.s(32)])),
        }
      } finally {
        if (privkey) privkey.fill(0)
      }
    },
    [],
  )

  const value = useMemo<WalletContextValue>(() => {
    const active = wallets.find((w) => w.id === activeId) ?? wallets[0] ?? null
    return {
      wallets,
      active,
      setActive,
      addWallet,
      removeWallet,
      revealSecret,
      getSigner,
      signOwnership,
    }
  }, [
    wallets,
    activeId,
    setActive,
    addWallet,
    removeWallet,
    revealSecret,
    getSigner,
    signOwnership,
  ])

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used inside WalletProvider')
  return ctx
}
