import { useCallback, useEffect, useState } from 'react'
import { Gift, Landmark, ExternalLink, ShieldCheck, Plus, Import, TrendingUp, ChevronLeft, ChevronRight } from 'lucide-react'
import { DEFAULT_CHAIN, formatAmount } from '../chains'
import { useWallet } from '../wallet/WalletContext'
import { claimEarnings, restakeEarnings } from '../wallet/staking'
import {
  fetchWalletEarnings,
  fetchClaimHistory,
  type WalletEarnings,
  type ClaimRecord,
} from '../wallet/rewards'
import EmptyState from '../components/EmptyState'
import Collapsible from '../components/Collapsible'

const chain = DEFAULT_CHAIN

interface Row {
  name: string
  earnings: WalletEarnings
}

export default function Rewards() {
  const { wallets, getSigner } = useWallet()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [history, setHistory] = useState<ClaimRecord[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [historyPage, setHistoryPage] = useState(0)

  const load = useCallback(async () => {
    if (wallets.length === 0) return
    setLoading(true)
    setError('')
    try {
      const earnings = await Promise.all(
        wallets.map(async (w) => ({
          name: w.name,
          earnings: await fetchWalletEarnings(chain, w.address),
        })),
      )
      setRows(earnings)
      setHistory(await fetchClaimHistory(chain, wallets.map((w) => w.address)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load rewards')
    } finally {
      setLoading(false)
    }
  }, [wallets])

  useEffect(() => {
    load()
  }, [load])

  if (wallets.length === 0) {
    return (
      <div>
        <h1 className="text-xl font-semibold">Rewards</h1>
        <EmptyState
          icon={Gift}
          title="No wallets yet"
          description="Add a wallet to track and claim your staking rewards and commission."
          actions={[
            { label: 'Create wallet', to: '/settings?action=create', icon: Plus },
            { label: 'Import wallet', to: '/settings?action=import', icon: Import, variant: 'secondary' },
          ]}
        />
      </div>
    )
  }

  const totalRewards = rows ? rows.reduce((s, r) => s + Number(r.earnings.rewards), 0) : 0
  const totalCommission = rows ? rows.reduce((s, r) => s + Number(r.earnings.commission), 0) : 0
  const claimable = rows
    ? rows.filter(
        (r) => Number(r.earnings.rewards) > 0 || Number(r.earnings.commission) > 0,
      )
    : []

  async function claimOne(row: Row, password: string) {
    const signer = await getSigner(row.earnings.address, password)
    const hash = await claimEarnings(
      chain,
      signer,
      row.earnings.address,
      row.earnings.rewardValidators,
      row.earnings.isValidator && Number(row.earnings.commission) > 0 ? row.earnings.valoper : null,
    )
    setNotice(`Claimed for ${row.name}. ${hash.slice(0, 12)}...`)
    await load()
  }

  async function restakeOne(row: Row, password: string) {
    const signer = await getSigner(row.earnings.address, password)
    const hash = await restakeEarnings(
      chain,
      signer,
      row.earnings.address,
      row.earnings.rewardsByValidator,
    )
    setNotice(`Restaked for ${row.name}. ${hash.slice(0, 12)}...`)
    await load()
  }

  async function claimAll(password: string) {
    setNotice('')
    setError('')
    const results: string[] = []
    for (const row of claimable) {
      try {
        const signer = await getSigner(row.earnings.address, password)
        await claimEarnings(
          chain,
          signer,
          row.earnings.address,
          row.earnings.rewardValidators,
          row.earnings.isValidator && Number(row.earnings.commission) > 0
            ? row.earnings.valoper
            : null,
        )
        results.push(`${row.name}: claimed`)
      } catch (e) {
        results.push(`${row.name}: ${e instanceof Error ? e.message : 'failed'}`)
      }
    }
    setNotice(results.join(' · '))
    await load()
  }

  // Average monthly income: total claimed over the calendar span it covers.
  const HISTORY_PER_PAGE = 10
  const totalClaimed = history.reduce((s, h) => s + h.rewards + h.commission, 0)
  let monthsSpan = 0
  if (history.length > 0) {
    const [ly, lm] = history[0].time.slice(0, 7).split('-').map(Number)
    const [ey, em] = history[history.length - 1].time.slice(0, 7).split('-').map(Number)
    monthsSpan = (ly - ey) * 12 + (lm - em) + 1
  }
  const avgMonthly = monthsSpan > 0 ? totalClaimed / monthsSpan : 0
  const historyPageCount = Math.max(1, Math.ceil(history.length / HISTORY_PER_PAGE))
  const historyRows = history.slice(
    historyPage * HISTORY_PER_PAGE,
    historyPage * HISTORY_PER_PAGE + HISTORY_PER_PAGE,
  )

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Rewards</h1>

      {notice && (
        <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</div>
      )}
      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Gift className="h-3.5 w-3.5" /> Claimable rewards
          </div>
          <div className="text-2xl font-semibold">
            {rows ? formatAmount(String(totalRewards), chain) : '...'}
          </div>
          <div className="text-xs text-slate-400">
            {chain.displayDenom} · across {wallets.length} wallet{wallets.length > 1 ? 's' : ''}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Landmark className="h-3.5 w-3.5" /> Claimable commission
          </div>
          <div className="text-2xl font-semibold">
            {rows ? formatAmount(String(totalCommission), chain) : '...'}
          </div>
          <div className="text-xs text-slate-400">{chain.displayDenom} · validator wallets</div>
        </div>
      </div>

      {claimable.length > 1 && (
        <ClaimForm
          label={`Claim everything from ${claimable.length} wallets at once`}
          submitLabel="Claim all"
          onSubmit={claimAll}
          onError={setError}
          hint="Uses one password for every wallet. Wallets with a different password are reported and can be claimed individually below."
        />
      )}

      {loading && !rows && <p className="text-sm text-slate-500">Loading rewards from the chain...</p>}

      <section className="space-y-2">
        <h2 className="font-medium">Your wallets</h2>
        <div className="space-y-2">
          {rows?.map((row) => (
            <WalletCard
              key={row.earnings.address}
              row={row}
              onClaim={claimOne}
              onRestake={restakeOne}
              onError={setError}
            />
          ))}
        </div>
      </section>

      {avgMonthly > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <TrendingUp className="h-4 w-4 shrink-0 text-green-600" />
          <span>
            Averaging <span className="font-medium text-slate-800">
              {formatAmount(String(Math.round(avgMonthly)), chain)} {chain.displayDenom}
            </span>{' '}
            per month{monthsSpan > 1 ? ` over the last ${monthsSpan} months` : ''}.
          </span>
        </div>
      )}

      {history.length > 0 && (
        <Collapsible title="Claim history" subtitle={`${history.length} claim${history.length > 1 ? 's' : ''}`}>
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
            {historyRows.map((h) => (
              <li key={h.hash} className="flex items-center justify-between px-4 py-2 text-sm">
                <span>
                  {h.rewards > 0 && (
                    <span className="text-green-700">
                      +{formatAmount(String(h.rewards), chain)} rewards
                    </span>
                  )}
                  {h.commission > 0 && (
                    <span className="ml-2 text-amber-700">
                      +{formatAmount(String(h.commission), chain)} commission
                    </span>
                  )}
                </span>
                <a
                  href={`${chain.explorerTxUrl}${h.hash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-amber-700"
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
                <ChevronLeft className="h-4 w-4" /> Prev
              </button>
              <span className="text-xs text-slate-500">
                Page {historyPage + 1} of {historyPageCount}
              </span>
              <button
                onClick={() => setHistoryPage((p) => Math.min(historyPageCount - 1, p + 1))}
                disabled={historyPage >= historyPageCount - 1}
                className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 hover:border-amber-500 disabled:opacity-40"
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </Collapsible>
      )}
    </div>
  )
}

function WalletCard({
  row,
  onClaim,
  onRestake,
  onError,
}: {
  row: Row
  onClaim: (row: Row, password: string) => Promise<void>
  onRestake: (row: Row, password: string) => Promise<void>
  onError: (msg: string) => void
}) {
  const [action, setAction] = useState<'none' | 'claim' | 'restake'>('none')
  const { earnings, name } = row
  const hasRewards = Number(earnings.rewards) > 0
  const hasSomething = hasRewards || Number(earnings.commission) > 0

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
          <div className="truncate font-mono text-xs text-slate-400">{earnings.address}</div>
          <div className="mt-1 text-xs">
            <span className="text-green-700">
              {formatAmount(earnings.rewards, chain)} {chain.displayDenom} rewards
            </span>
            {earnings.isValidator && (
              <span className="ml-2 text-amber-700">
                {formatAmount(earnings.commission, chain)} {chain.displayDenom} commission
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
              Restake
            </button>
          )}
          {hasSomething && (
            <button
              onClick={() => setAction(action === 'claim' ? 'none' : 'claim')}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-600"
            >
              Claim
            </button>
          )}
        </div>
      </div>
      {action === 'claim' && (
        <div className="mt-3">
          <ClaimForm
            label={`Claim rewards${earnings.isValidator && Number(earnings.commission) > 0 ? ' and commission' : ''} for ${name}`}
            submitLabel="Sign and claim"
            onSubmit={(pw) => onClaim(row, pw).then(() => setAction('none'))}
            onError={onError}
          />
        </div>
      )}
      {action === 'restake' && (
        <div className="mt-3">
          <ClaimForm
            label={`Restake ${formatAmount(earnings.rewards, chain)} ${chain.displayDenom} rewards back into your delegations for ${name}`}
            submitLabel="Sign and restake"
            hint="Withdraws your rewards and delegates them straight back to the same validators. The network fee comes from your available balance."
            onSubmit={(pw) => onRestake(row, pw).then(() => setAction('none'))}
            onError={onError}
          />
        </div>
      )}
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
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    onError('')
    try {
      await onSubmit(password)
      setPassword('')
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Claim failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg bg-slate-50 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="flex gap-2">
        <input
          type="password"
          name="beehive-claim-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Wallet password to sign"
          required
          autoComplete="new-password"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
        />
        <button
          disabled={busy}
          className="shrink-0 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
        >
          {busy ? 'Signing...' : submitLabel}
        </button>
      </div>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </form>
  )
}
