import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Gift, Landmark, ExternalLink, ShieldCheck, Plus, Import, TrendingUp, ChevronLeft, ChevronRight } from 'lucide-react'
import { DEFAULT_CHAIN, resolveChain, findChain, formatAmount, type ChainInfo } from '../chains'
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
  averageMonthly,
  type WalletEarnings,
  type ClaimRecord,
} from '../wallet/rewards'
import EmptyState from '../components/EmptyState'
import LoadingOverlay from '../components/LoadingOverlay'
import OptionPicker from '../components/OptionPicker'
import Collapsible from '../components/Collapsible'
import { useChains } from '../chainStore'
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
  const { status: chainsStatus } = useChains()
  const chainsSettled = chainsStatus !== 'loading'
  const [params, setParams] = useSearchParams()
  // Deep-linkable: "Claim" on a chain's dashboard card arrives as
  // /rewards?chain=<key>, so the page opens already scoped to the network the
  // user was looking at rather than to everything they own.
  const chainFilter = params.get('chain') ?? ''
  const setChainFilter = (key: string) => {
    const next = new URLSearchParams(params)
    if (key) next.set('chain', key)
    else next.delete('chain')
    setParams(next, { replace: true })
  }
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
    // Same registry gate as the dashboard. resolveChain() THROWS for a chain
    // that has not arrived from chains_public.php yet, and this callback is
    // memoised - so loading early left "Chain X is not configured" on screen
    // permanently, with no retry. Medibloc hid it by being the one chain in the
    // bootstrap array; Chihuahua failed every time.
    if (!chainsSettled) return
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
  }, [wallets, t, chainsSettled])

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

  // Everything below is scoped to the network filter, and totals are grouped
  // per chain.
  //
  // This previously summed every wallet's rewards into ONE figure and labelled
  // it with rows[0].chain - safe while Medibloc was the only network, and the
  // comment here said as much. Adding Chihuahua made it wrong: it added MED and
  // HUAHUA base units together and presented the result as MED. Different
  // assets with different prices are never a single number.
  const shownRows = rows
    ? rows.filter((r) => !chainFilter || r.chain.key === chainFilter)
    : null

  const groups = Array.from(new Set((shownRows ?? []).map((r) => r.chain.key))).map((key) => {
    const inChain = (shownRows ?? []).filter((r) => r.chain.key === key)
    return {
      chain: inChain[0].chain,
      rows: inChain,
      rewards: sumBase(inChain.map((r) => r.earnings.rewards)),
      commission: sumBase(inChain.map((r) => r.earnings.commission)),
      // "Claim all" is offered per network, never across them. The review
      // dialog totals a claim amount and a fee, and both are denominated - a
      // batch spanning two chains could only show those as one meaningless
      // sum. It is also scoped to what the filter is showing, so the dialog
      // can never authorise a wallet that is off screen.
      claimable: inChain.filter(
        (r) => isPositiveBase(r.earnings.rewards) || isPositiveBase(r.earnings.commission),
      ),
    }
  })

  // Only for chrome that is not a per-chain amount (batch fee lines, empty
  // states). Never used to format a total any more.
  const displayChain = groups[0]?.chain ?? rows?.[0]?.chain ?? DEFAULT_CHAIN

  const walletChains = Array.from(new Set((rows ?? []).map((r) => r.chain.key))).map(
    (k) => (rows ?? []).find((r) => r.chain.key === k)!.chain,
  )

  // Multi-wallet claim: build + simulate each wallet's claim, then review the
  // whole batch before broadcasting each as its own transaction.
  async function claimAll(password: string, forChain: Row[]) {
    setNotice('')
    setError('')
    const plans: BatchPlan[] = []
    for (const row of forChain) {
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
    // Derived from the batch itself, not from page-level state. Every plan in a
    // batch is on one chain (claimAll is invoked per group), so this formats
    // and denominates against that chain rather than whichever happened to be
    // first on the page.
    const chain = b[0]?.row.chain ?? displayChain
    const totalFee = b.reduce((s, p) => addBase(s, p.est.amount), '0')
    const totalClaim = b.reduce(
      (s, p) => addBase(s, addBase(p.row.earnings.rewards, p.row.earnings.commission)),
      '0',
    )
    return [
      { label: t('review.network'), value: chain.chainName },
      { label: t('review.wallets'), value: String(b.length) },
      {
        label: t('review.claimAmount'),
        value: `${formatAmount(totalClaim, chain)} ${chain.displayDenom}`,
      },
      { label: t('review.fee'), value: `~${formatAmount(totalFee, chain)} ${chain.displayDenom}` },
      { label: t('review.action'), value: t('review.actionClaim') },
    ]
  }

  // Average monthly income for the displayed chain. Shared with the Dashboard
  // via averageMonthly() so the two views cannot report different figures.
  const HISTORY_PER_PAGE = 10
  // findChain, not resolveChain: this runs during render for every history
  // row, and a throw there would blank the whole page rather than one line.
  // Falling back only affects how an old row is formatted, never a balance.
  const chainOf = (h: { chainKey: string }) => findChain(h.chainKey) ?? displayChain
  const historyPageCount = Math.max(1, Math.ceil(history.length / HISTORY_PER_PAGE))
  const historyRows = history.slice(
    historyPage * HISTORY_PER_PAGE,
    historyPage * HISTORY_PER_PAGE + HISTORY_PER_PAGE,
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t('rewards.title')}</h1>
        {walletChains.length > 1 && (
          <OptionPicker
            label={t('dash.chainFilter')}
            value={chainFilter}
            onChange={setChainFilter}
            options={[
              { value: '', label: t('dash.allChains') },
              ...walletChains.map((c) => ({ value: c.key, label: c.chainName })),
            ]}
          />
        )}
      </div>

      {notice && (
        <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</div>
      )}
      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {/* One pair of totals per network. Never a single combined figure: two
          chains are two assets, and a sum of their base units means nothing. */}
      {groups.map((g) => (
        <div key={g.chain.key} className="space-y-2">
          {walletChains.length > 1 && (
            <div className="text-xs font-medium text-slate-500">{g.chain.chainName}</div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <Gift className="h-3.5 w-3.5" /> {t('rewards.claimableRewards')}
              </div>
              <div className="text-2xl font-semibold">{formatAmount(g.rewards, g.chain)}</div>
              <div className="text-xs text-slate-500">
                {g.chain.displayDenom} · {t('rewards.acrossWallets', { count: g.rows.length })}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <Landmark className="h-3.5 w-3.5" /> {t('rewards.claimableCommission')}
              </div>
              <div className="text-2xl font-semibold">{formatAmount(g.commission, g.chain)}</div>
              <div className="text-xs text-slate-500">
                {g.chain.displayDenom} · {t('rewards.validatorWallets')}
              </div>
            </div>
          </div>

          {g.claimable.length > 1 && (
            <ClaimForm
              label={t('rewards.claimAllLabel', { count: g.claimable.length })}
              submitLabel={t('rewards.claimAll')}
              onSubmit={(pw) => claimAll(pw, g.claimable)}
              onError={setError}
              hint={t('rewards.claimAllHint')}
            />
          )}
        </div>
      ))}

      {/* Unlike the dashboard there is no cached snapshot here, so an in-app
          arrival has nothing to read either way - the modal is the honest state
          whenever the page is empty and fetching, cold start or not. */}
      {(loading || !chainsSettled) && !rows && (
        <LoadingOverlay title={t('rewards.loading')} subtitle={t('rewards.loadingHint')} />
      )}

      <section className="space-y-2">
        <h2 className="font-medium">{t('rewards.yourWallets')}</h2>
        <div className="space-y-2">
          {shownRows?.map((row) => (
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

      {/* One line per network on screen. This used to render a single average
          for whichever chain happened to sort first, which read as though it
          covered everything above it. */}
      {groups.map((g) => {
        const avg = averageMonthly(history, g.chain.key)
        if (!isPositiveBase(avg.amount)) return null
        return (
          <div
            key={g.chain.key}
            className="flex items-center gap-2 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600"
          >
            <TrendingUp className="h-4 w-4 shrink-0 text-green-700" />
            <span>
              {avg.months > 1
                ? t('rewards.averagingOver', {
                    amount: formatAmount(avg.amount, g.chain),
                    denom: g.chain.displayDenom,
                    months: avg.months,
                  })
                : t('rewards.averaging', {
                    amount: formatAmount(avg.amount, g.chain),
                    denom: g.chain.displayDenom,
                  })}
            </span>
          </div>
        )
      })}

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
