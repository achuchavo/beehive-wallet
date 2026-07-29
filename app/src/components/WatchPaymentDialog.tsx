import { useState } from 'react'
import { CircleCheck, TriangleAlert, Copy, Check } from 'lucide-react'
import type { OfflineDirectSigner } from '@cosmjs/proto-signing'
import {
  api,
  ApiError,
  type WatchIntent,
  type WatchQuote,
  type AlarmType,
  type WatchCadence,
} from '../api'
import type { ChainInfo } from '../chains'
import { formatAmount } from '../chains'
import { simulateTx, broadcastTx, lookupTx, sendMsg } from '../wallet/tx'
import { useWallet } from '../wallet/WalletContext'
import { useT } from '../i18n/I18nContext'
import Modal from './Modal'
import LoadingOverlay from './LoadingOverlay'
import HelpTip from './HelpTip'
import CopyAddress from './CopyAddress'
import PasswordInput from './PasswordInput'
import OptionPicker from './OptionPicker'

const CADENCE_KEY: Record<WatchCadence, string> = {
  one_time: 'pay.cadenceOneTime',
  weekly: 'pay.cadenceWeekly',
  monthly: 'pay.cadenceMonthly',
}

/**
 * Pay for an address alert, and prove it.
 *
 * NON-CUSTODIAL, and this dialog is where a user could most easily assume
 * otherwise, so it says so: the payment is an ordinary transfer signed on this
 * device and broadcast to the network. Beehive never holds the funds. The
 * server's only role is to look the transaction up on chain and check it.
 *
 * Two ways in, because both happen:
 *   - pay from a wallet held here, in which case the memo is filled in for the
 *     user and the hash is handed straight to verification;
 *   - pay from anywhere else and paste the hash.
 *
 * The memo code matters more than it looks. Transaction hashes are public, so
 * without something binding a payment to an account, anyone could submit
 * someone else's payment and consume it.
 */
export default function WatchPaymentDialog({
  chain,
  quote,
  intent,
  pending,
  onDone,
  onCancel,
}: {
  chain: ChainInfo
  quote: WatchQuote
  intent: WatchIntent
  /** What is being bought. Absent for a renewal, which already has its watch. */
  pending?: { address: string; label: string; alarmType: AlarmType }
  onDone: () => void
  onCancel: () => void
}) {
  const { t } = useT()
  const { wallets, getSigner } = useWallet()

  const [mode, setMode] = useState<'choose' | 'inApp' | 'external'>('choose')
  const [walletId, setWalletId] = useState('')
  const [password, setPassword] = useState('')
  const [hash, setHash] = useState('')
  const [busy, setBusy] = useState<'' | 'paying' | 'verifying'>('')
  const [error, setError] = useState('')
  const [retriable, setRetriable] = useState(false)
  const [done, setDone] = useState<{ paidUntil: string | null } | null>(null)
  const [copied, setCopied] = useState(false)

  const isRenew = intent.kind === 'renew'
  // Wallets on the same network as the payment. Paying from another chain's
  // wallet is not a thing that can work, so it is not offered.
  const payable = wallets.filter((w) => w.chainKey === chain.key)

  function copyMemo() {
    navigator.clipboard?.writeText(intent.memo_code).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => {},
    )
  }

  /** Hand a hash to the server and let it decide - nothing is trusted here. */
  async function verify(txHash: string) {
    setBusy('verifying')
    setError('')
    setRetriable(false)
    try {
      const r = await api.watchPaymentSubmit({
        chain_key: chain.key,
        memo_code: intent.memo_code,
        tx_hash: txHash,
        address: pending?.address,
        label: pending?.label,
        alarm_type: pending?.alarmType,
      })
      setDone({ paidUntil: r.paid_until })
    } catch (e) {
      // A refusal that could succeed later (the network has not indexed the
      // transaction yet) must not read as "your payment failed" - the user's
      // money has moved and telling them it failed would be untrue.
      if (e instanceof ApiError) {
        setError(e.code === 'not_indexed' ? t('pay.notIndexed') : e.message)
        setRetriable(e.retriable)
      } else {
        setError(e instanceof Error ? e.message : t('pay.verify'))
      }
    } finally {
      setBusy('')
    }
  }

  /** Sign and broadcast the payment here, then verify the resulting hash. */
  async function payInApp() {
    const wallet = payable.find((w) => w.id === walletId)
    if (!wallet) return
    setBusy('paying')
    setError('')
    setRetriable(false)

    let signer: OfflineDirectSigner
    try {
      signer = await getSigner(wallet.id, password)
      // The derived key is what signs; the typed password is not needed again.
      setPassword('')
    } catch (e) {
      setPassword('')
      setBusy('')
      setError(e instanceof Error ? e.message : t('alarms.working'))
      return
    }

    try {
      const messages = [
        sendMsg(wallet.address, intent.collect_address, intent.fee_amount, intent.fee_denom),
      ]
      // The memo is the binding, so it is set from the intent and never from
      // anything the user types.
      const est = await simulateTx(chain, signer, wallet.address, messages, intent.memo_code)
      const outcome = await broadcastTx(
        chain,
        signer,
        wallet.address,
        messages,
        est.fee,
        intent.memo_code,
      )

      if (outcome.status === 'rejected') {
        setBusy('')
        setError(outcome.rawLog || t('send.errSendFailed'))
        return
      }
      if (outcome.status === 'unknown') {
        // The node may already hold it. Resolve by hash before saying anything:
        // "failed" would be a false statement about a payment that may well
        // have landed. Either way the hash is shown, so nothing is lost.
        const lookup = await lookupTx(chain, outcome.hash)
        if (lookup.status === 'rejected') {
          setBusy('')
          setError(lookup.rawLog || t('send.errSendFailed'))
          return
        }
        setHash(outcome.hash)
        setMode('external')
        await verify(outcome.hash)
        return
      }
      setHash(outcome.hash)
      await verify(outcome.hash)
    } catch (e) {
      setBusy('')
      setError(e instanceof Error ? e.message : t('send.errSendFailed'))
    }
  }

  if (busy !== '') {
    return (
      <LoadingOverlay
        title={busy === 'paying' ? t('pay.paying') : t('pay.verifying')}
        subtitle={busy === 'paying' ? t('pay.payingSub') : t('pay.verifyingSub')}
      />
    )
  }

  if (done) {
    return (
      <Modal title={t('pay.success')} onClose={onDone}>
        <div className="space-y-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-700">
            <CircleCheck className="h-6 w-6" />
          </div>
          <p className="text-sm text-slate-600">
            {done.paidUntil
              ? t('pay.successUntil', { date: done.paidUntil.slice(0, 10) })
              : t('pay.successOneTime')}
          </p>
          <button
            onClick={onDone}
            className="w-full rounded-lg bg-amber-500 py-2 text-sm font-medium text-slate-900 hover:bg-amber-600"
          >
            {t('common.close')}
          </button>
        </div>
      </Modal>
    )
  }

  const feeDisplay = formatAmount(intent.fee_amount, chain)

  return (
    <Modal title={isRenew ? t('pay.renewTitle') : t('pay.title')} onClose={onCancel}>
      <div className="space-y-4">
        {/* What it costs, and on what terms. Everything non-obvious carries its
            own '?' rather than a wall of text nobody reads. */}
        <div className="space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
          {!isRenew && quote.free_cap > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-slate-600">
              {t('pay.freeUsed', {
                used: quote.free_used,
                cap: quote.free_cap,
                chain: chain.chainName,
              })}
              <HelpTip text={t('help.freeCap')} align="start" />
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
              {t('pay.amountToSend')}
              <HelpTip text={t('help.payFee')} align="start" />
            </span>
            <span className="font-medium tabular-nums">
              {feeDisplay} {chain.displayDenom}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
              {t('admin.pricingCadence')}
              <HelpTip text={t('help.payCadence')} align="start" />
            </span>
            <span className="text-sm">{t(CADENCE_KEY[intent.cadence])}</span>
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
            {t('pay.collectAddress')}
            <HelpTip text={t('help.payCollectAddress')} align="start" />
          </div>
          <CopyAddress address={intent.collect_address} className="text-xs" />
        </div>

        <div>
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
            {t('pay.memoCode')}
            <HelpTip text={t('help.payMemo')} align="start" />
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-lg bg-slate-900 px-3 py-2 font-mono text-sm text-amber-200">
              {intent.memo_code}
            </code>
            <button
              type="button"
              onClick={copyMemo}
              aria-label={t('pay.memoCodeCopy')}
              className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:border-amber-500"
            >
              {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {t('pay.expiresAt', { time: intent.expires_at.slice(0, 16).replace('T', ' ') })}
          </p>
        </div>

        {/* Stated where the money decision is made, not buried in Docs. */}
        <p className="flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {t('help.payOverUnder')}
            <HelpTip text={t('help.payNonCustodial')} align="start" className="ml-1" />
          </span>
        </p>

        {error && (
          <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
            {retriable && hash && (
              <button
                onClick={() => verify(hash)}
                className="ml-2 font-medium underline hover:no-underline"
              >
                {t('pay.retry')}
              </button>
            )}
          </div>
        )}

        {mode === 'choose' && (
          <div className="flex flex-col gap-2">
            {payable.length > 0 && (
              <button
                onClick={() => setMode('inApp')}
                className="w-full rounded-lg bg-amber-500 py-2 text-sm font-medium text-slate-900 hover:bg-amber-600"
              >
                {t('pay.payInApp')}
              </button>
            )}
            <button
              onClick={() => setMode('external')}
              className="w-full rounded-lg border border-slate-300 py-2 text-sm hover:border-amber-500"
            >
              {t('pay.payExternal')}
            </button>
            <button
              onClick={onCancel}
              className="w-full rounded-lg py-2 text-sm text-slate-500 hover:text-slate-800"
            >
              {t('pay.cancel')}
            </button>
          </div>
        )}

        {mode === 'inApp' && (
          <div className="space-y-3">
            <label className="block text-xs font-medium text-slate-600" htmlFor="pay-wallet">
              {t('pay.chooseWallet')}
            </label>
            <OptionPicker
              id="pay-wallet"
              full
              layout="list"
              label={t('pay.chooseWallet')}
              value={walletId}
              onChange={setWalletId}
              options={[
                { value: '', label: t('alarms.pickWallet') },
                ...payable.map((w) => ({
                  value: w.id,
                  label: w.name,
                  hint: `${w.address.slice(0, 14)}...${w.address.slice(-6)}`,
                })),
              ]}
            />
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('send.signPassword')}
              aria-label={t('send.signPassword')}
              autoComplete="current-password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                onClick={payInApp}
                disabled={!walletId || !password}
                className="flex-1 rounded-lg bg-amber-500 py-2 text-sm font-medium text-slate-900 hover:bg-amber-600 disabled:opacity-50"
              >
                {t('pay.payInApp')}
              </button>
              <button
                onClick={() => setMode('choose')}
                className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

        {mode === 'external' && (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                {t('pay.txHash')}
                <HelpTip text={t('help.payTxHash')} align="start" />
              </span>
              <input
                value={hash}
                onChange={(e) => setHash(e.target.value.trim())}
                placeholder="A1B2C3..."
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs focus:border-amber-500 focus:outline-none"
              />
              <span className="mt-1 block text-xs text-slate-500">{t('pay.txHashHint')}</span>
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => verify(hash)}
                disabled={hash.length !== 64}
                className="flex-1 rounded-lg bg-amber-500 py-2 text-sm font-medium text-slate-900 hover:bg-amber-600 disabled:opacity-50"
              >
                {t('pay.verify')}
              </button>
              <button
                onClick={() => setMode('choose')}
                className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
