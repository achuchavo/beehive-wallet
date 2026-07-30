import { useEffect, useRef, useState } from 'react'
import { SendHorizontal, Copy, Check, CircleCheck, Plus, Import } from 'lucide-react'
import type { OfflineDirectSigner, EncodeObject } from '@cosmjs/proto-signing'
import QRCode from 'qrcode'
import PasswordInput from '../components/PasswordInput'
import EmptyState from '../components/EmptyState'
import {
  findChain,
  toBaseUnits,
  formatAmount,
  feeReserve,
  scaledGasPrice,
  gasPriceInDisplay,
} from '../chains'
import { assertAccountAddress } from '../wallet/address'
import { addBase } from '../wallet/amount'
import { simulateTx, broadcastTx, lookupTx, sendMsg, type FeeEstimate } from '../wallet/tx'
import { useWallet } from '../wallet/WalletContext'
import { useT } from '../i18n/I18nContext'
import PercentButtons from '../components/PercentButtons'
import CopyAddress from '../components/CopyAddress'
import Card from '../components/Card'
import HelpTip from '../components/HelpTip'
import PageHeader from '../components/PageHeader'
import Tabs, { TabPanel } from '../components/Tabs'
import TxReview, { type ReviewRow } from '../components/TxReview'
import WalletSwitcher from '../components/WalletSwitcher'
import TxUnresolved from '../components/TxUnresolved'
import { maskAmount, usePrivacyMode } from '../privacyMode'

// Transaction speed = gas-price multiplier over the chain minimum. A higher gas
// price gets the tx included faster; "low" is the network minimum (current cost).
const SPEED_OPTIONS = [
  { key: 'low', mult: 1, label: 'send.speedLow' },
  { key: 'medium', mult: 1.5, label: 'send.speedMedium' },
  { key: 'high', mult: 2, label: 'send.speedHigh' },
] as const
type Speed = (typeof SPEED_OPTIONS)[number]['key']

// One field style for the whole form. A ring instead of a border keeps the
// inputs flush with the soft cards around them.
const FIELD_CLASS =
  'w-full rounded-xl bg-white px-3.5 py-2.5 text-sm ring-1 ring-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500'

export default function Send() {
  const { active } = useWallet()
  const { t } = useT()
  const [tab, setTab] = useState<'send' | 'receive'>('send')

  if (!active) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('send.title')} />
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
    <div className="space-y-6">
      <PageHeader title={t('send.title')} />
      {/* Real tab semantics rather than two styled buttons: this is the app's
          own Tabs component, so arrow keys, aria-selected and the panel wiring
          come with it. */}
      <Tabs
        idPrefix="send"
        label={t('send.title')}
        activeId={tab}
        onChange={(id) => setTab(id as 'send' | 'receive')}
        items={[
          { id: 'send', label: t('send.tabSend') },
          { id: 'receive', label: t('send.tabReceive') },
        ]}
      />
      <TabPanel id="send" activeId={tab} idPrefix="send">
        <SendForm />
      </TabPanel>
      <TabPanel id="receive" activeId={tab} idPrefix="send">
        <Receive />
      </TabPanel>
    </div>
  )
}

function Receive() {
  const { active } = useWallet()
  const { t } = useT()
  // The wallet's OWN chain, so the warning names the network funds must arrive on.
  const chain = active ? findChain(active.chainKey) : undefined
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
    <Card className="space-y-3">
      <div className="text-sm font-medium">{active.name}</div>
      {/* Network first and unmissable. Sending an asset on the wrong chain to a
          correct-looking address is one of the few ways to lose funds outright
          with no recovery, so the chain, its id and the asset are stated before
          the address rather than implied by it. */}
      {chain && (
        <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200/80">
          <div className="font-medium">
            {t('send.receiveNetwork', { chain: chain.chainName, denom: chain.displayDenom })}
          </div>
          <div className="font-mono text-[11px] text-amber-800">{chain.chainId}</div>
          <p className="mt-1">{t('send.receiveWarning', { chain: chain.chainName })}</p>
        </div>
      )}
      <canvas ref={canvasRef} className="rounded-xl" />
      <div className="break-all font-mono text-sm text-slate-600">{active.address}</div>
      <button
        onClick={copy}
        className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm text-slate-600 ring-1 ring-slate-200 hover:text-amber-700"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-700" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? t('send.copied') : t('send.copyAddress')}
      </button>
    </Card>
  )
}

function SendForm() {
  const { active, wallets, getSigner } = useWallet()
  const { t } = useT()
  const hidden = usePrivacyMode()
  // The chain comes from the active wallet's own chainKey - never a global
  // default - so denom, gas and RPC always match the wallet being signed with.
  const chain = active ? findChain(active.chainKey) : undefined
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [password, setPassword] = useState('')
  const [speed, setSpeed] = useState<Speed>('low')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [txHash, setTxHash] = useState('')
  // Hash of a transaction whose fate is unknown - see TxUnresolved.
  const [unresolved, setUnresolved] = useState('')
  const [balance, setBalance] = useState<string | null>(null)
  // Pending review: the simulated plan awaiting the user's explicit confirmation.
  const [review, setReview] = useState<{
    signer: OfflineDirectSigner
    messages: EncodeObject[]
    est: FeeEstimate
    to: string
    baseAmount: string
    memo: string
    speed: Speed
  } | null>(null)
  const [confirming, setConfirming] = useState(false)

  const speedMult = SPEED_OPTIONS.find((s) => s.key === speed)!.mult

  // Never let a typed password outlive the form: clear it when the wallet
  // changes, when the page is backgrounded, and on unmount.
  useEffect(() => {
    setPassword('')
    const onHide = () => {
      if (document.visibilityState === 'hidden') setPassword('')
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      setPassword('')
    }
  }, [active?.address])

  // A different sender means a different balance, denom and fee context, so
  // anything computed for the previous wallet is stale: the typed amount, any
  // pending review (its signer belongs to the old wallet), and old outcomes.
  // Recipient and memo survive - switching sender to reach the same recipient
  // is the common case, and address validation catches a chain mismatch.
  useEffect(() => {
    setAmount('')
    setError('')
    setTxHash('')
    setReview(null)
  }, [active?.id])

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
      const signer = await getSigner(active.id, password)
      // The key material is derived - the plaintext password is not needed for
      // any later step, so drop it now rather than holding it through review
      // and broadcast. A retry after this point requires re-entering it.
      setPassword('')
      const messages = [sendMsg(active.address, to, baseAmount, chain.denom)]
      const est = await simulateTx(
        chain,
        signer,
        active.address,
        messages,
        memo,
        scaledGasPrice(chain, speedMult),
      )
      setReview({ signer, messages, est, to, baseAmount, memo, speed })
    } catch (err) {
      setPassword('') // also clear on a failed unlock/simulate
      setError(err instanceof Error ? err.message : t('send.errSendFailed'))
    } finally {
      setBusy(false)
    }
  }

  function clearAfterSend(hash: string) {
    setTxHash(hash)
    setReview(null)
    setTo('')
    setAmount('')
    setMemo('')
    setPassword('')
  }

  // Step 2: the user has reviewed and confirmed - sign and broadcast with the
  // exact fee that was shown.
  async function confirmSend() {
    if (!active || !chain || !review) return
    setConfirming(true)
    setError('')
    try {
      const outcome = await broadcastTx(
        chain,
        review.signer,
        active.address,
        review.messages,
        review.est.fee,
        review.memo,
      )

      if (outcome.status === 'unknown') {
        // The node may already hold this transaction. Resolve it by hash before
        // offering anything that looks like a retry - the form is deliberately
        // NOT cleared, but no error is shown either, because "failed" would be
        // a false statement.
        const lookup = await lookupTx(chain, outcome.hash)
        if (lookup.status === 'success') {
          clearAfterSend(outcome.hash)
        } else if (lookup.status === 'rejected') {
          setError(lookup.rawLog || t('send.errSendFailed'))
          setReview(null)
        } else {
          setUnresolved(outcome.hash)
          setReview(null)
        }
        return
      }

      if (outcome.status === 'rejected') {
        setError(outcome.rawLog || t('send.errSendFailed'))
        setReview(null)
        return
      }

      clearAfterSend(outcome.hash)
    } catch (err) {
      // Pre-submission failure: nothing was sent, so this is a true error.
      setError(err instanceof Error ? err.message : t('send.errSendFailed'))
      setReview(null)
    } finally {
      setConfirming(false)
    }
  }

  const unresolvedModal = unresolved && chain ? (
    <TxUnresolved
      chain={chain}
      hash={unresolved}
      busy={confirming}
      onRecheck={async () => {
        setConfirming(true)
        try {
          const l = await lookupTx(chain, unresolved)
          if (l.status === 'success') {
            setUnresolved('')
            clearAfterSend(unresolved)
          } else if (l.status === 'rejected') {
            setUnresolved('')
            setError(l.rawLog || t('send.errSendFailed'))
          }
        } finally {
          setConfirming(false)
        }
      }}
      onDismiss={() => setUnresolved('')}
    />
  ) : null

  if (!active) return null
  if (!chain) {
    return (
      <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
        {t('send.errUnknownChain', { chain: active.chainKey })}
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="max-w-lg space-y-4">
      {/* Who is paying, and what they have. The balance is the one figure on
          this screen the user reads before deciding an amount, so it is set
          large and quiet rather than tucked into a sentence. */}
      <Card className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-xs text-slate-500">{t('send.from')}</span>
          {/* With one wallet the name is a fact; with several it is a choice,
              so it becomes the switcher right where the user reads "From". */}
          {wallets.length > 1 ? (
            <WalletSwitcher label={t('send.fromWallet')} className="mt-0.5 max-w-full" />
          ) : (
            <span className="block truncate text-sm font-medium">{active.name}</span>
          )}
          <CopyAddress
            address={active.address}
            display={`${active.address.slice(0, 14)}...${active.address.slice(-6)}`}
            className="mt-0.5 max-w-full text-xs text-slate-500"
          />
        </span>
        {balance !== null && (
          <span className="shrink-0 text-right">
            <span className="block text-xs text-slate-500">{t('send.balance')}</span>
            <span className="block text-lg font-semibold tabular-nums">
              {maskAmount(formatAmount(balance, chain), hidden)}{' '}
              <span className="text-xs font-medium text-slate-500">{chain.displayDenom}</span>
            </span>
          </span>
        )}
      </Card>

      {/* Persistent labels, not placeholders: a placeholder vanishes the moment
          you type, so the field loses its name exactly while it holds a value
          you are meant to check. On money fields that matters more than usual. */}
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">
          {t('send.recipientLabel')}
        </span>
        <input
          name="beehive-recipient"
          value={to}
          onChange={(e) => setTo(e.target.value.trim())}
          placeholder={t('send.recipient', { prefix: chain.bech32Prefix })}
          required
          autoComplete="off"
          className={`font-mono ${FIELD_CLASS}`}
        />
      </label>

      <div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            {t('send.amountLabel', { denom: chain.displayDenom })}
          </span>
          <span className="flex items-center gap-2">
            <input
              name="beehive-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value.trim())}
              placeholder={t('send.amount')}
              required
              inputMode="decimal"
              autoComplete="off"
              className={`flex-1 text-lg tabular-nums ${FIELD_CLASS}`}
            />
            <span className="text-sm text-slate-500">{chain.displayDenom}</span>
          </span>
        </label>
        {balance !== null && (
          <div className="mt-2">
            <PercentButtons
              maxBase={balance}
              reserveBase={feeReserve(chain, Math.ceil(120000 * speedMult))}
              chain={chain}
              onPick={setAmount}
            />
          </div>
        )}
      </div>

      <label className="block">
        <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
          {t('send.memoOptional')}
          <HelpTip text={t('help.memo')} align="start" />
        </span>
        <input
          name="beehive-memo"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          maxLength={256}
          autoComplete="off"
          className={FIELD_CLASS}
        />
      </label>

      {/* Transaction speed: a gas-price multiplier. Higher = faster inclusion.
          The prose hint that used to sit under this is now the "?" - it says
          the same thing, on demand, without a paragraph on every visit. */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="flex items-center gap-1 text-xs font-medium text-slate-600">
            {t('send.speed')}
            <HelpTip text={t('help.speed')} align="start" />
          </span>
          <span className="text-xs text-slate-500">
            {scaledGasPrice(chain, speedMult)} · {gasPriceInDisplay(chain, speedMult)} {chain.displayDenom}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSpeed(s.key)}
              aria-pressed={speed === s.key}
              className={`rounded-lg py-1.5 text-xs font-medium transition-colors ${
                speed === s.key
                  ? 'bg-white text-amber-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t(s.label)}
            </button>
          ))}
        </div>
      </div>

      {/* htmlFor rather than a wrapping <label>: PasswordInput contains its own
          show/hide button, and a label containing a button forwards clicks in
          ways that have already bitten this codebase once (see Modal). */}
      <div>
        <label
          htmlFor="beehive-sign-password"
          className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600"
        >
          {t('send.signPassword')}
          <HelpTip text={t('help.walletPassword')} align="start" />
        </label>
        <PasswordInput
          id="beehive-sign-password"
          name="beehive-sign-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="new-password"
          className={FIELD_CLASS}
        />
      </div>
      {error && (
        <div role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {/* Non-visual users get told what stage the transaction is at, not just
          that a button became disabled. */}
      <span className="sr-only" role="status" aria-live="polite">
        {busy ? t('send.simulating') : confirming ? t('review.broadcasting') : ''}
      </span>
      {txHash && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-xl bg-green-50 px-3 py-2 text-sm text-green-800"
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
      {/* The one primary action on this screen. */}
      <button
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-sm font-medium text-slate-900 hover:bg-amber-600 disabled:opacity-50"
      >
        <SendHorizontal className="h-4 w-4" strokeWidth={1.8} />
        {busy ? t('send.simulating') : t('send.review')}
      </button>

      {unresolvedModal}
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
      {
        label: t('review.speed'),
        value: `${t(SPEED_OPTIONS.find((s) => s.key === r.speed)!.label)} · ${scaledGasPrice(c, SPEED_OPTIONS.find((s) => s.key === r.speed)!.mult)}`,
      },
      { label: t('review.fee'), value: `${formatAmount(r.est.amount, c)} ${c.displayDenom}` },
      { label: t('review.total'), value: `${formatAmount(total, c)} ${c.displayDenom}`, strong: true },
      { label: t('review.memo'), value: r.memo || '—' },
      { label: t('review.action'), value: t('review.actionSend') },
    ]
  }
}
