import { useEffect, useRef, useState } from 'react'
import { SendHorizontal, QrCode, Copy, Check, CircleCheck, Plus, Import } from 'lucide-react'
import type { OfflineDirectSigner, EncodeObject } from '@cosmjs/proto-signing'
import QRCode from 'qrcode'
import PasswordInput from '../components/PasswordInput'
import EmptyState from '../components/EmptyState'
import { findChain, toBaseUnits, formatAmount, feeReserve } from '../chains'
import { assertAccountAddress } from '../wallet/address'
import { addBase } from '../wallet/amount'
import { simulateTx, broadcastTx, sendMsg, type FeeEstimate } from '../wallet/tx'
import { useWallet } from '../wallet/WalletContext'
import { useT } from '../i18n/I18nContext'
import PercentButtons from '../components/PercentButtons'
import CopyAddress from '../components/CopyAddress'
import TxReview, { type ReviewRow } from '../components/TxReview'

export default function Send() {
  const { active } = useWallet()
  const { t } = useT()
  const [tab, setTab] = useState<'send' | 'receive'>('send')

  if (!active) {
    return (
      <div>
        <h1 className="text-xl font-semibold">{t('send.title')}</h1>
        <EmptyState
          icon={SendHorizontal}
          title={t('send.noWallet')}
          description={t('send.noWalletDesc')}
          actions={[
            { label: t('dash.createWallet'), to: '/settings?action=create', icon: Plus },
            { label: t('dash.importWallet'), to: '/settings?action=import', icon: Import, variant: 'secondary' },
          ]}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('send.title')}</h1>
      <div className="flex gap-1">
        {(['send', 'receive'] as const).map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm ${
              tab === tb ? 'bg-amber-500 font-medium text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {tb === 'send' ? <SendHorizontal className="h-3.5 w-3.5" /> : <QrCode className="h-3.5 w-3.5" />}
            {tb === 'send' ? t('send.tabSend') : t('send.tabReceive')}
          </button>
        ))}
      </div>
      {tab === 'send' ? <SendForm /> : <Receive />}
    </div>
  )
}

function Receive() {
  const { active } = useWallet()
  const { t } = useT()
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
        {copied ? t('send.copied') : t('send.copyAddress')}
      </button>
    </div>
  )
}

function SendForm() {
  const { active, getSigner } = useWallet()
  const { t } = useT()
  // The chain comes from the active wallet's own chainKey - never a global
  // default - so denom, gas and RPC always match the wallet being signed with.
  const chain = active ? findChain(active.chainKey) : undefined
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [txHash, setTxHash] = useState('')
  const [balance, setBalance] = useState<string | null>(null)
  // Pending review: the simulated plan awaiting the user's explicit confirmation.
  const [review, setReview] = useState<{
    signer: OfflineDirectSigner
    messages: EncodeObject[]
    est: FeeEstimate
    to: string
    baseAmount: string
    memo: string
  } | null>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!active || !chain) return
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
    if (!active || !chain) return
    setError('')
    setTxHash('')

    // Real Bech32 (HRP + checksum) validation, not a prefix/length guess.
    try {
      assertAccountAddress(to, chain.bech32Prefix)
    } catch {
      setError(t('send.errRecipient', { chain: chain.chainName, prefix: chain.bech32Prefix }))
      return
    }
    if (to === active.address) {
      setError(t('send.errSameAddr'))
      return
    }

    let baseAmount: string
    try {
      baseAmount = toBaseUnits(amount, chain)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('send.errInvalidAmount'))
      return
    }

    // Step 1: build the wallet's signer, simulate to get a real fee, and open
    // the review. Nothing is broadcast here.
    setBusy(true)
    try {
      const signer = await getSigner(active.address, password)
      const messages = [sendMsg(active.address, to, baseAmount, chain.denom)]
      const est = await simulateTx(chain, signer, active.address, messages, memo)
      setReview({ signer, messages, est, to, baseAmount, memo })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('send.errSendFailed'))
    } finally {
      setBusy(false)
    }
  }

  // Step 2: the user has reviewed and confirmed - sign and broadcast with the
  // exact fee that was shown.
  async function confirmSend() {
    if (!active || !chain || !review) return
    setConfirming(true)
    setError('')
    try {
      const hash = await broadcastTx(
        chain,
        review.signer,
        active.address,
        review.messages,
        review.est.fee,
        review.memo,
      )
      setTxHash(hash)
      setReview(null)
      setTo('')
      setAmount('')
      setMemo('')
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('send.errSendFailed'))
      setReview(null)
    } finally {
      setConfirming(false)
    }
  }

  if (!active) return null
  if (!chain) {
    return (
      <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
        {t('send.errUnknownChain', { chain: active.chainKey })}
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="max-w-lg space-y-3">
      <div className="rounded-lg bg-slate-50 px-4 py-2 text-sm text-slate-600">
        {t('send.from')} <span className="font-medium">{active.name}</span>
        <CopyAddress
          address={active.address}
          display={`${active.address.slice(0, 14)}...${active.address.slice(-6)}`}
          className="ml-2 align-middle text-xs text-slate-400"
        />
        {balance !== null && (
          <span className="ml-2 text-xs">
            {t('send.balance')}: {formatAmount(balance, chain)} {chain.displayDenom}
          </span>
        )}
      </div>
      <input
        name="beehive-recipient"
        value={to}
        onChange={(e) => setTo(e.target.value.trim())}
        placeholder={t('send.recipient', { prefix: chain.bech32Prefix })}
        required
        autoComplete="off"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-amber-500 focus:outline-none"
      />
      <div className="flex items-center gap-2">
        <input
          name="beehive-amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value.trim())}
          placeholder={t('send.amount')}
          required
          inputMode="decimal"
          autoComplete="off"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
        />
        <span className="text-sm text-slate-500">{chain.displayDenom}</span>
      </div>
      {balance !== null && (
        <PercentButtons
          maxBase={balance}
          reserveBase={feeReserve(chain, 120000)}
          chain={chain}
          onPick={setAmount}
        />
      )}
      <input
        name="beehive-memo"
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        placeholder={t('send.memoOptional')}
        maxLength={256}
        autoComplete="off"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
      />
      <PasswordInput
        name="beehive-sign-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={t('send.signPassword')}
        required
        autoComplete="new-password"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
      />
      <p className="text-xs text-slate-400">
        {t('send.feeNote', { denom: chain.displayDenom, gas: chain.gasPrice })}
      </p>
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {txHash && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800"
        >
          <CircleCheck className="h-4 w-4 shrink-0" />
          {t('send.sent')}{' '}
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
        <SendHorizontal className="h-4 w-4" />
        {busy ? t('send.simulating') : t('send.review')}
      </button>

      {review && (
        <TxReview
          rows={reviewRows(review)}
          warning={t('review.warnIrreversible')}
          confirmLabel={t('review.confirmSend')}
          busy={confirming}
          onConfirm={confirmSend}
          onClose={() => setReview(null)}
        />
      )}
    </form>
  )

  function reviewRows(r: NonNullable<typeof review>): ReviewRow[] {
    const c = chain!
    const total = addBase(r.baseAmount, r.est.amount)
    return [
      { label: t('review.network'), value: `${c.chainName} (${c.chainId})` },
      { label: t('review.from'), value: `${active!.name} · ${active!.address}`, mono: true },
      { label: t('review.to'), value: r.to, mono: true },
      {
        label: t('review.amount'),
        value: `${formatAmount(r.baseAmount, c)} ${c.displayDenom} (${r.baseAmount} ${c.denom})`,
      },
      { label: t('review.fee'), value: `${formatAmount(r.est.amount, c)} ${c.displayDenom}` },
      { label: t('review.total'), value: `${formatAmount(total, c)} ${c.displayDenom}`, strong: true },
      { label: t('review.memo'), value: r.memo || '—' },
      { label: t('review.action'), value: t('review.actionSend') },
    ]
  }
}
