import { useEffect, useRef, useState } from 'react'
import { SendHorizontal, QrCode, Copy, Check, CircleCheck, LockKeyhole, Plus, Import } from 'lucide-react'
import { SigningStargateClient, GasPrice } from '@cosmjs/stargate'
import QRCode from 'qrcode'
import PasswordInput from '../components/PasswordInput'
import EmptyState from '../components/EmptyState'
import { DEFAULT_CHAIN, toBaseUnits, formatAmount } from '../chains'
import { useWallet } from '../wallet/WalletContext'

export default function Send() {
  const { active } = useWallet()
  const [tab, setTab] = useState<'send' | 'receive'>('send')

  if (!active) {
    return (
      <div>
        <h1 className="text-xl font-semibold">Send / receive</h1>
        <EmptyState
          icon={SendHorizontal}
          title="No wallet yet"
          description="Add a wallet to send and receive tokens. Your keys stay encrypted in this browser."
          actions={[
            { label: 'Create wallet', to: '/settings?action=create', icon: Plus },
            { label: 'Import wallet', to: '/settings?action=import', icon: Import, variant: 'secondary' },
          ]}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Send / receive</h1>
      <div className="flex gap-1">
        {(['send', 'receive'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm capitalize ${
              tab === t ? 'bg-amber-500 font-medium text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {t === 'send' ? <SendHorizontal className="h-3.5 w-3.5" /> : <QrCode className="h-3.5 w-3.5" />}
            {t}
          </button>
        ))}
      </div>
      {tab === 'send' ? <SendForm /> : <Receive />}
    </div>
  )
}

function Receive() {
  const { active } = useWallet()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (active && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, active.address, { width: 220, margin: 2 })
    }
  }, [active])

  if (!active) return null

  async function copy() {
    await navigator.clipboard.writeText(active!.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-sm font-medium">{active.name}</div>
      <canvas ref={canvasRef} className="rounded-lg border border-slate-100" />
      <div className="break-all font-mono text-sm text-slate-600">{active.address}</div>
      <button
        onClick={copy}
        className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:border-amber-500"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? 'Copied' : 'Copy address'}
      </button>
    </div>
  )
}

function SendForm() {
  const chain = DEFAULT_CHAIN
  const { active, getSigner } = useWallet()
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [txHash, setTxHash] = useState('')
  const [balance, setBalance] = useState<string | null>(null)

  useEffect(() => {
    if (!active) return
    fetch(`${chain.lcd}/cosmos/bank/v1beta1/balances/${active.address}`)
      .then((r) => r.json())
      .then((d) => {
        const coin = (d.balances ?? []).find((b: { denom: string }) => b.denom === chain.denom)
        setBalance(coin?.amount ?? '0')
      })
      .catch(() => setBalance(null))
  }, [active, chain])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!active) return
    setError('')
    setTxHash('')

    if (!to.startsWith(chain.bech32Prefix + '1') || to.length < 39) {
      setError(`Recipient must be a ${chain.chainName} address (${chain.bech32Prefix}1...)`)
      return
    }
    if (to === active.address) {
      setError('Recipient is the same as the sender')
      return
    }

    let baseAmount: string
    try {
      baseAmount = toBaseUnits(amount, chain)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid amount')
      return
    }

    setBusy(true)
    try {
      const signer = await getSigner(active.address, password)
      const client = await SigningStargateClient.connectWithSigner(chain.rpc, signer, {
        gasPrice: GasPrice.fromString(chain.gasPrice),
      })
      const result = await client.sendTokens(
        active.address,
        to,
        [{ denom: chain.denom, amount: baseAmount }],
        1.4,
        memo,
      )
      client.disconnect()
      if (result.code !== 0) {
        throw new Error(`Transaction failed on chain: ${result.rawLog ?? result.code}`)
      }
      setTxHash(result.transactionHash)
      setTo('')
      setAmount('')
      setMemo('')
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setBusy(false)
    }
  }

  if (!active) return null

  return (
    <form onSubmit={submit} className="max-w-lg space-y-3">
      <div className="rounded-lg bg-slate-50 px-4 py-2 text-sm text-slate-600">
        From <span className="font-medium">{active.name}</span>
        <span className="ml-2 font-mono text-xs text-slate-400">
          {active.address.slice(0, 14)}...{active.address.slice(-6)}
        </span>
        {balance !== null && (
          <span className="ml-2 text-xs">
            Balance: {formatAmount(balance, chain)} {chain.displayDenom}
          </span>
        )}
      </div>
      <input
        name="beehive-recipient"
        value={to}
        onChange={(e) => setTo(e.target.value.trim())}
        placeholder={`Recipient (${chain.bech32Prefix}1...)`}
        required
        autoComplete="off"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-amber-500 focus:outline-none"
      />
      <div className="flex items-center gap-2">
        <input
          name="beehive-amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value.trim())}
          placeholder="Amount"
          required
          inputMode="decimal"
          autoComplete="off"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
        />
        <span className="text-sm text-slate-500">{chain.displayDenom}</span>
      </div>
      <input
        name="beehive-memo"
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        placeholder="Memo (optional)"
        maxLength={256}
        autoComplete="off"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
      />
      <PasswordInput
        name="beehive-sign-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Wallet password to sign"
        required
        autoComplete="new-password"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
      />
      <p className="text-xs text-slate-400">
        The transaction is signed in your browser. Network fee is paid in {chain.displayDenom}{' '}
        (gas price {chain.gasPrice}).
      </p>
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {txHash && (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
          <CircleCheck className="h-4 w-4 shrink-0" />
          Sent.{' '}
          <a
            href={`${chain.explorerTxUrl}${txHash}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono underline"
          >
            {txHash.slice(0, 16)}...
          </a>
        </div>
      )}
      <button
        disabled={busy}
        className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
      >
        <LockKeyhole className="h-4 w-4" />
        {busy ? 'Signing and broadcasting...' : 'Sign and send'}
      </button>
    </form>
  )
}
