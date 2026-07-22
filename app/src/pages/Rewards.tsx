import { useCallback, useEffect, useState } from 'react'
import { Gift, Landmark, ExternalLink, ShieldCheck, Plus, Import, TrendingUp, ChevronLeft, ChevronRight } from 'lucide-react'
import { DEFAULT_CHAIN, resolveChain, formatAmount, type ChainInfo } from '../chains'
import { sumBase, addBase, isPositiveBase } from '../wallet/amount'
import { useWallet } from '../wallet/WalletContext'
import type { OfflineDirectSigner, EncodeObject } from '@cosmjs/proto-signing'
import { buildClaim, buildRestake } from '../wallet/staking'
import { simulateTx, broadcastTx, type FeeEstimate } from '../wallet/tx'
import { useTxReview } from '../wallet/useTxReview'
import TxReview, { type ReviewRow } from '../components/TxReview'
import {
  fetchWalletEarnings,
  fetchClaimHistory,
  type WalletEarnings,
  type ClaimRecord,
} from '../wallet/rewards'
import EmptyState from '../components/EmptyState'
import Collapsible from '../components/Collapsible'
import { useT } from '../i18n/I18nContext'

interface Row {
  name: string
  chain: ChainInfo // resolved from the wallet's chainKey
  earnings: WalletEarnings
}

interface BatchPlan {
  row: Row
  signer: OfflineDirectSigner
  messages: EncodeObject[]
  memo: string
  est: FeeEstimate
}

export default function Rewards() {
  const { wallets, getSigner } = useWallet()
  const { t } = useT()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [history, setHistory] = useState<ClaimRecord[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [historyPage, setHistoryPage] = useState(0)
  const [batch, setBatch] = useState<BatchPlan[] | null>(null)
  const [batchBusy, setBatchBusy] = useState(false)

  const load = useCallback(async () => {
    if (wallets.length === 0) return
    setLoading(true)
    setError('')
    try {
      // Each wallet uses its own chain (from chainKey), never a global default.
      const earnings = await Promise.all(
        wallets.map(async (w) => {
          const wc = resolveChain(w.chainKey)
          return { name: w.name, chain: wc, earnings: await fetchWalletEarnings(wc, w.address) }
        }),
      )
      setRows(earnings)
      const perWallet = await Promise.all(
        wallets.map((w) => fetchClaimHistory(resolveChain(w.chainKey), [w.address])),
      )
      setHistory(perWallet.flat().sort((a, b) => (a.time < b.time ? 1 : -1)))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('rewards.errLoad'))
    } finally {
      setLoading(false)
    }
  }, [wallets, t])

  useEffect(() => {
    load()
  }, [load])

  if (wallets.length === 0) {
    return (
      <div>
        <h1 className="text-xl font-semibold">{t('rewards.title')}</h1>
        <EmptyState
          icon={Gift}
          title={t('rewards.noWallets')}
          description={t('rewards.noWalletsDesc')}
          actions={[
            { label: t('dash.createWallet'), to: '/settings?action=create', icon: Plus },
            { label: t('dash.importWallet'), to: '/settings?action=import', icon: Import, variant: 'secondary' },
          ]}
        />
      </div>
    )
  }

  // Exact sums. NOTE: these totals assume a single denomination across wallets,
  // which holds for the current single-chain product. A future multi-chain build
  // must group these by denom rather than summing base units directly.
  const totalRewards = rows ? sumBase(rows.map((r) => r.earnings.rewards)) : '0'
  const totalCommission = rows ? sumBase(rows.map((r) => r.earnings.commission)) : '0'
  const claimable = rows
    ? rows.filter((r) => isPositiveBase(r.earnings.rewards) || isPositiveBase(r.earnings.commission))
    : []
  const displayChain = rows?.[0]?.chain ?? DEFAULT_CHAIN

  // Multi-wallet claim: build + simulate each wallet's claim, then review the
  // whole batch before broadcasting each as its own transaction.
  async function claimAll(password: string) {
    setNotice('')
    setError('')
    const plans: BatchPlan[] = []
    for (const row of claimable) {
      const signer = await getSigner(row.earnings.address, password)
      const commissionValoper =
        row.earnings.isValidator && isPositiveBase(row.earnings.commission)
          ? row.earnings.valoper
          : null
      const { messages, memo } = buildClaim(
        row.earnings.address,
        row.earnings.rewardValidators,
        commissionValoper,
      )
      const est = await simulateTx(row.chain, signer, row.earnings.address, messages, memo)
      plans.push({ row, signer, messages, memo, est })
    }
    setBatch(plans)
  }

  async function confirmBatch() {
    if (!batch) return
    setBatchBusy(true)
    const results: string[] = []
    for (const p of batch) {
      try {
        await broadcastTx(p.row.chain, p.signer, p.row.earnings.address, p.messages, p.est.fee, p.memo)
        results.push(t('rewards.claimedShort', { name: p.row.name }))
      } catch (e) {
        results.push(`${p.row.name}: ${e instanceof Error ? e.message : t('rewards.errClaim')}`)
      }
    }
    setNotice(results.join(' · '))
    setBatch(null)
    setBatchBusy(false)
    await load()
  }

  function batchRows(): ReviewRow[] {
    const b = batch ?? []
    const totalFee = b.reduce((s, p) => addBase(s, p.est.amount), '0')
    return [
      { label: t('review.wallets'), value: String(b.length) },
      {
        label: t('review.claimAmount'),
        value: `${formatAmount(totalRewards, displayChain)} ${displayChain.displayDenom}`,
      },
      { label: t('review.fee'), value: `~${formatAmount(totalFee, displayChain)} ${displayChain.displayDenom}` },
      { label: t('review.action'), value: t('review.actionClaim') },
    ]
  }

  // Average monthly income: total claimed over the calendar span it covers.
  // Scoped to the displayed chain's own records so two assets are never summed.
  const HISTORY_PER_PAGE = 10
  const chainOf = (h: { chainKey: string }) => resolveChain(h.chainKey)
  const displayHistory = history.filter((h) => h.chainKey === displayChain.key)
  // Exact: base units can exceed Number.MAX_SAFE_INTEGER.
  const totalClaimed = sumBase(displayHistory.flatMap((h) => [h.rewards, h.commission]))
  let monthsSpan = 0
  if (displayHistory.length > 0) {
    const [ly, lm] = displayHistory[0].time.slice(0, 7).split('-').map(Number)
    const [ey, em] = displayHistory[displayHistory.length - 1].time.slice(0, 7).split('-').map(Number)
    monthsSpan = (ly - ey) * 12 + (lm - em) + 1
  }
  // Integer base-unit division; the quotient is still a base-unit string.
  const avgMonthly =
    monthsSpan > 0 ? (BigInt(totalClaimed) / BigInt(monthsSpan)).toString() : '0'
  const historyPageCount = Math.max(1, Math.ceil(history.length / HISTORY_PER_PAGE))
  const historyRows = history.slice(
    historyPage * HISTORY_PER_PAGE,
    historyPage * HISTORY_PER_PAGE + HISTORY_PER_PAGE,
  )

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{t('rewards.title')}</h1>

      {notice && (
        <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</div>
      )}
      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Gift className="h-3.5 w-3.5" /> {t('rewards.claimableRewards')}
          </div>
          <div className="text-2xl font-semibold">
            {rows ? formatAmount(totalRewards, displayChain) : '...'}
          </div>
          <div className="text-xs text-slate-500">
            {displayChain.displayDenom} · {t('rewards.acrossWallets', { count: wallets.length })}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Landmark className="h-3.5 w-3.5" /> {t('rewards.claimableCommission')}
          </div>
          <div className="text-2xl font-semibold">
            {rows ? formatAmount(totalCommission, displayChain) : '...'}
          </div>
          <div className="text-xs text-slate-500">{displayChain.displayDenom} · {t('rewards.validatorWallets')}</div>
        </div>
      </div>

      {claimable.length > 1 && (
        <ClaimForm
          label={t('rewards.claimAllLabel', { count: claimable.length })}
          submitLabel={t('rewards.claimAll')}
          onSubmit={claimAll}
          onError={setError}
          hint={t('rewards.claimAllHint')}
        />
      )}

      {loading && !rows && <p className="text-sm text-slate-500">{t('rewards.loading')}</p>}

      <section className="space-y-2">
        <h2 className="font-medium">{t('rewards.yourWallets')}</h2>
        <div className="space-y-2">
          {rows?.map((row) => (
            <WalletCard
              key={row.earnings.address}
              row={row}
              onReload={load}
              onNotice={setNotice}
              onError={setError}
            />
          ))}
        </div>
      </section>

      {isPositiveBase(avgMonthly) && (
        <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <TrendingUp className="h-4 w-4 shrink-0 text-green-700" />
          <span>
            {monthsSpan > 1
              ? t('rewards.averagingOver', {
                  amount: formatAmount(avgMonthly, displayChain),
                  denom: displayChain.displayDenom,
                  months: monthsSpan,
                })
              : t('rewards.averaging', {
                  amount: formatAmount(avgMonthly, displayChain),
                  denom: displayChain.displayDenom,
                })}
          </span>
        </div>
      )}

      {history.length > 0 && (
        <Collapsible title={t('rewards.claimHistory')} subtitle={t('rewards.claimsCount', { count: history.length })}>
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
            {historyRows.map((h) => (
              <li key={h.hash} className="flex items-center justify-between px-4 py-2 text-sm">
                <span>
                  {/* Format with the chain the record actually came from, never
                      another chain's decimals/ticker. */}
                  {isPositiveBase(h.rewards) && (
                    <span className="text-green-700">
                      +{formatAmount(h.rewards, chainOf(h))} {t('rewards.rewardsWord')}
                    </span>
                  )}
                  {isPositiveBase(h.commission) && (
                    <span className="ml-2 text-amber-700">
                      +{formatAmount(h.commission, chainOf(h))} {t('rewards.commissionWord')}
                    </span>
                  )}
                </span>
                <a
                  href={`${displayChain.explorerTxUrl}${h.hash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-amber-700"
                >
                  {h.time.slice(0, 10)} <ExternalLink className="h-3 w-3" />
                </a>
              </li>
            ))}
          </ul>
          {historyPageCount > 1 && (
            <div className="mt-2 flex items-center justify-between text-sm">
              <button
                onClick={() => setHistoryPage((p) => Math.max(0, p - 1))}
                disabled={historyPage === 0}
                className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 hover:border-amber-500 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" /> {t('common.prev')}
              </button>
              <span className="text-xs text-slate-500">
                {t('rewards.page', { page: historyPage + 1, total: historyPageCount })}
              </span>
              <button
                onClick={() => setHistoryPage((p) => Math.min(historyPageCount - 1, p + 1))}
                disabled={historyPage >= historyPageCount - 1}
                className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 hover:border-amber-500 disabled:opacity-40"
              >
                {t('common.next')} <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </Collapsible>
      )}

      {batch && (
        <TxReview
          rows={batchRows()}
          warning={t('review.warnBatch')}
          confirmLabel={t('rewards.claimAll')}
          busy={batchBusy}
          onConfirm={confirmBatch}
          onClose={() => (batchBusy ? undefined : setBatch(null))}
        />
      )}
    </div>
  )
}

function WalletCard({
  row,
  onReload,
  onNotice,
  onError,
}: {
  row: Row
  onReload: () => void
  onNotice: (msg: string) => void
  onError: (msg: string) => void
}) {
  const { t } = useT()
  const { getSigner } = useWallet()
  const { prepare, modal } = useTxReview()
  const [action, setAction] = useState<'none' | 'claim' | 'restake'>('none')
  const { earnings, name, chain } = row
  const hasCommission = earnings.isValidator && isPositiveBase(earnings.commission)
  const hasRewards = isPositiveBase(earnings.rewards)
  const hasSomething = hasRewards || hasCommission

  const netFromRow = (est: FeeEstimate): ReviewRow[] => [
    { label: t('review.network'), value: `${chain.chainName} (${chain.chainId})` },
    { label: t('review.from'), value: `${name} · ${earnings.address}`, mono: true },
    { label: t('review.fee'), value: `${formatAmount(est.amount, chain)} ${chain.displayDenom}` },
    { label: t('review.action'), value: t('review.actionClaim') },
  ]

  async function submitClaim(password: string) {
    const signer = await getSigner(earnings.address, password)
    const { messages, memo } = buildClaim(
      earnings.address,
      earnings.rewardValidators,
      hasCommission ? earnings.valoper : null,
    )
    await prepare({
      chain,
      signer,
      sender: earnings.address,
      messages,
      memo,
      confirmLabel: t('review.confirmClaim'),
      onDone: (hash) => {
        setAction('none')
        onNotice(t('rewards.claimedFor', { name, hash: hash.slice(0, 12) }))
        onReload()
      },
      onError,
      buildRows: (est) => {
        const rows = netFromRow(est)
        rows.splice(2, 0, {
          label: t('review.claimAmount'),
          value: hasCommission
            ? `${formatAmount(earnings.rewards, chain)} + ${formatAmount(earnings.commission, chain)} ${chain.displayDenom}`
            : `${formatAmount(earnings.rewards, chain)} ${chain.displayDenom}`,
        })
        return rows
      },
    })
  }

  async function submitRestake(password: string) {
    const signer = await getSigner(earnings.address, password)
    const { messages, memo } = buildRestake(chain, earnings.address, earnings.rewardsByValidator)
    await prepare({
      chain,
      signer,
      sender: earnings.address,
      messages,
      memo,
      confirmLabel: t('review.confirmRestake'),
      onDone: (hash) => {
        setAction('none')
        onNotice(t('rewards.restakedFor', { name, hash: hash.slice(0, 12) }))
        onReload()
      },
      onError,
      buildRows: (est) => {
        const rows = netFromRow(est)
        rows.splice(2, 0, {
          label: t('review.amount'),
          value: `${formatAmount(earnings.rewards, chain)} ${chain.displayDenom}`,
        })
        rows[rows.length - 1] = { label: t('review.action'), value: t('review.actionRestake') }
        return rows
      },
    })
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            {name}
            {earnings.isValidator && (
              <span className="flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                <ShieldCheck className="h-3 w-3" /> validator
              </span>
            )}
          </div>
          <div className="truncate font-mono text-xs text-slate-500">{earnings.address}</div>
          <div className="mt-1 text-xs">
            <span className="text-green-700">
              {formatAmount(earnings.rewards, chain)} {chain.displayDenom} {t('rewards.rewardsWord')}
            </span>
            {earnings.isValidator && (
              <span className="ml-2 text-amber-700">
                {formatAmount(earnings.commission, chain)} {chain.displayDenom} {t('rewards.commissionWord')}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {hasRewards && (
            <button
              onClick={() => setAction(action === 'restake' ? 'none' : 'restake')}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:border-amber-500"
            >
              {t('rewards.restake')}
            </button>
          )}
          {hasSomething && (
            <button
              onClick={() => setAction(action === 'claim' ? 'none' : 'claim')}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-amber-600"
            >
              {t('rewards.claim')}
            </button>
          )}
        </div>
      </div>
      {action === 'claim' && (
        <div className="mt-3">
          <ClaimForm
            label={
              earnings.isValidator && isPositiveBase(earnings.commission)
                ? t('rewards.claimForWithCommission', { name })
                : t('rewards.claimFor', { name })
            }
            submitLabel={t('rewards.signAndClaim')}
            onSubmit={submitClaim}
            onError={onError}
          />
        </div>
      )}
      {action === 'restake' && (
        <div className="mt-3">
          <ClaimForm
            label={t('rewards.restakeLabel', { amount: formatAmount(earnings.rewards, chain), denom: chain.displayDenom, name })}
            submitLabel={t('rewards.signAndRestake')}
            hint={t('rewards.restakeHint')}
            onSubmit={submitRestake}
            onError={onError}
          />
        </div>
      )}
      {modal}
    </div>
  )
}

function ClaimForm({
  label,
  submitLabel,
  hint,
  onSubmit,
  onError,
}: {
  label: string
  submitLabel: string
  hint?: string
  onSubmit: (password: string) => Promise<void>
  onError: (msg: string) => void
}) {
  const { t } = useT()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    onError('')
    try {
      // onSubmit derives the signer and opens the review; the plaintext
      // password is not needed afterwards, so it is cleared below. Cancelling
      // the review therefore requires deliberately re-entering it.
      await onSubmit(password)
    } catch (err) {
      onError(err instanceof Error ? err.message : t('rewards.errClaim'))
    } finally {
      setPassword('')
      setBusy(false)
    }
  }

  // Don't let a typed password survive backgrounding or unmount.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') setPassword('')
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      setPassword('')
    }
  }, [])

  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg bg-slate-50 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="flex gap-2">
        <input
          type="password"
          name="beehive-claim-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('send.signPassword')}
          aria-label={t('send.signPassword')}
          required
          autoComplete="new-password"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
        />
        <button
          disabled={busy}
          className="shrink-0 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-amber-600 disabled:opacity-50"
        >
          {busy ? t('rewards.signing') : submitLabel}
        </button>
      </div>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </form>
  )
}
