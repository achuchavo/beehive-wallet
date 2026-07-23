import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Wallet,
  Coins,
  SendHorizontal,
  History as HistoryIcon,
  Plus,
  Import,
  Bell,
  Gift,
  Landmark,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react'
import { DEFAULT_CHAIN, findChain, formatAmount, type ChainInfo } from '../chains'
import { useChains } from '../chainStore'
import { useColdStart } from '../coldStart'
import { addBase, sumBase, isPositiveBase } from '../wallet/amount'
import { useWallet } from '../wallet/WalletContext'
import EmptyState from '../components/EmptyState'
import CopyAddress from '../components/CopyAddress'
import LoadingOverlay from '../components/LoadingOverlay'
import OptionPicker from '../components/OptionPicker'
import CountUp from '../components/CountUp'
import DeltaFloat from '../components/DeltaFloat'
import {
  loadSnapshot,
  saveSnapshotRows,
  saveSnapshotMonthly,
  chainDelta,
  type SnapshotRow,
} from '../dashboardSnapshot'
import { CURRENCIES, getCurrency, setCurrency, fetchPrice, fiatValue, formatFiat } from '../currency'
import { useT } from '../i18n/I18nContext'
import {
  fetchValidatorMonikers,
  fetchWalletPortfolio,
  type WalletPortfolio,
} from '../wallet/portfolio'
import { fetchClaimHistory, averageMonthly } from '../wallet/rewards'

interface Row {
  name: string
  // Each row carries the chain it was actually queried against, so no total or
  // format ever mixes denoms/decimals from different networks.
  chain: ChainInfo
  portfolio: WalletPortfolio
  /** Set when this wallet's balances could not be loaded. */
  failed?: string
  /**
   * Set when the wallet's chainKey is not in the registry. `chain` then holds a
   * placeholder purely so the row can render - it is NOT the wallet's network,
   * and nothing may present it as such.
   */
  unknownChainKey?: string
}

export default function Dashboard() {
  const { t } = useT()
  const { wallets } = useWallet()
  // Subscribing keeps this component re-rendering as the registry resolves.
  // 'error' counts as settled: we then fall back to the bootstrap chain rather
  // than spinning forever, and App already shows the load-failure banner.
  const { status: chainsStatus } = useChains()
  const chainsSettled = chainsStatus !== 'loading'
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const isColdStart = useColdStart()
  // Read once, at mount: the figures the user saw when they last left. Held in
  // a ref as well so a re-render never re-reads a snapshot we have since
  // overwritten with this session's own numbers.
  const [snapshot] = useState(() => loadSnapshot())
  // Per chain, the total to count up FROM, and the change to float. Populated
  // when live data replaces the snapshot, then cleared once shown.
  const [countFrom, setCountFrom] = useState<Record<string, string>>({})
  // Per-stat baselines, keyed by stat then chain. Rewards and commission are
  // the figures that genuinely move between visits, so animating only the hero
  // total left the reveal looking dead.
  const [countFromStat, setCountFromStat] = useState<Record<string, Record<string, string>>>({})
  const [deltas, setDeltas] = useState<Record<string, string>>({})
  const [currency, setCurrencyState] = useState(getCurrency())
  // Price per chain key - different chains have different coingecko ids.
  const [prices, setPrices] = useState<Record<string, number | null>>({})
  // '' = show every chain.
  const [chainFilter, setChainFilter] = useState('')
  // Per-chain override of the default expand state. Absent = use the default,
  // which is "first chain open, the rest folded" - with several networks the
  // page was otherwise a very long scroll before the second total came into
  // view. Filtering to one chain always shows it in full.
  const [openChains, setOpenChains] = useState<Record<string, boolean>>({})
  // Average claimed per month, per chain. Derived from claim history, which is
  // a separate (and slower) set of tx queries - kept out of the balance load so
  // it can never delay the numbers people actually come here for.
  //
  // Seeded from the snapshot: those queries are slower than the balance ones,
  // so without a cached value the income card sits on its empty state ("shows
  // once you claim rewards") for seconds after the totals above it have filled
  // in - which reads as "you have earned nothing" rather than "still loading".
  const [monthly, setMonthly] = useState<Record<string, { amount: string; months: number }>>(
    () => loadSnapshot()?.monthly ?? {},
  )

  // The distinct chains actually represented by the user's wallets.
  const walletChains = Array.from(new Set(wallets.map((w) => w.chainKey)))
    .map((k) => findChain(k))
    .filter((c): c is ChainInfo => c !== undefined)

  const chainsKey = walletChains.map((c) => c.key).join(',')
  useEffect(() => {
    let cancelled = false
    Promise.all(
      walletChains.map(async (c) => [c.key, await fetchPrice(c.coingeckoId, currency)] as const),
    ).then((entries) => {
      if (!cancelled) setPrices(Object.fromEntries(entries))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainsKey, currency])

  function changeCurrency(code: string) {
    setCurrency(code)
    setCurrencyState(code)
  }

  // Fiat for a base amount, priced with that chain's own price and decimals.
  const fiatFor = (c: ChainInfo, base: string | number) => {
    const p = prices[c.key]
    return p !== null && p !== undefined
      ? formatFiat(fiatValue(base, c.decimals, p), currency)
      : null
  }

  /**
   * Live data has landed: work out what to animate from, what changed since
   * last time, and what is safe to persist as the next baseline.
   */
  function settleAgainstSnapshot(fresh: Row[]) {
    const from: Record<string, string> = {}
    const fromAvailable: Record<string, string> = {}
    const fromStaked: Record<string, string> = {}
    const fromRewards: Record<string, string> = {}
    const fromCommission: Record<string, string> = {}
    const changed: Record<string, string> = {}
    const keys = Array.from(new Set(fresh.map((r) => r.chain.key)))

    for (const key of keys) {
      const prevRows = (snapshot?.rows ?? []).filter((r) => r.chainKey === key)
      const nowRows = fresh.filter((r) => r.chain.key === key && !r.failed)
      if (prevRows.length === 0) continue

      // Count up from the previous figures regardless of the address-set check:
      // animating between two values is cosmetic and cannot misreport anything.
      // Rewards and commission are animated too - they accrue every block, so
      // they are what visibly moves on a normal return.
      from[key] = sumBase(prevRows.map((r) => addBase(r.available, r.staked)))
      fromRewards[key] = sumBase(prevRows.map((r) => r.rewards))
      fromCommission[key] = sumBase(prevRows.map((r) => r.commission))
      fromAvailable[key] = sumBase(prevRows.map((r) => r.available))
      fromStaked[key] = sumBase(prevRows.map((r) => r.staked))

      // The delta is a claim about the user's money, so it only appears when
      // the comparison is genuinely like-for-like.
      const d = chainDelta(
        prevRows,
        nowRows.map((r) => ({
          address: r.portfolio.address,
          available: r.portfolio.available,
          staked: r.portfolio.staked,
          rewards: r.portfolio.rewards,
          commission: r.portfolio.commission,
        })),
      )
      if (d && d !== '0') changed[key] = d
    }

    setCountFrom(from)
    setCountFromStat({
      available: fromAvailable,
      staked: fromStaked,
      rewards: fromRewards,
      commission: fromCommission,
    })
    setDeltas(changed)

    // Persist only chains where EVERY wallet loaded cleanly. A chain with a
    // failed row has an understated total; storing it would manufacture a fake
    // gain the next time the dashboard opens.
    const healthyKeys = keys.filter((k) => !fresh.some((r) => r.chain.key === k && r.failed))
    const toStore: SnapshotRow[] = fresh
      .filter((r) => healthyKeys.includes(r.chain.key) && !r.failed)
      .map((r) => ({
        name: r.name,
        chainKey: r.chain.key,
        address: r.portfolio.address,
        available: r.portfolio.available,
        staked: r.portfolio.staked,
        rewards: r.portfolio.rewards,
        commission: r.portfolio.commission,
        isValidator: r.portfolio.isValidator,
      }))
    if (toStore.length > 0) saveSnapshotRows(toStore)
  }

  const load = useCallback(async () => {
    if (wallets.length === 0) return
    // Wait for the real registry before resolving any wallet's chain.
    //
    // chains.ts ships a bootstrap array containing only Medibloc; every other
    // chain arrives from chains_public.php. Loading against the bootstrap would
    // resolve those wallets to "network not configured" - and because this
    // callback is memoised, it would never retry once the registry landed, so
    // the row stayed permanently wrong. Medibloc masked this by being the one
    // hardcoded chain. chainsSettled is in the dependency list, so the load
    // re-runs exactly once the registry resolves.
    if (!chainsSettled) return
    setLoading(true)
    setError('')
    // Per-wallet: resolve that wallet's own chain and query its endpoints. One
    // chain being down must not blank out wallets on a healthy chain, so each
    // wallet settles independently and failures are reported per row.
    const monikerCache = new Map<string, Promise<Record<string, string>>>()
    try {
      const data = await Promise.all(
        wallets.map(async (w): Promise<Row | null> => {
          const c = findChain(w.chainKey)
          if (!c) {
            // Unknown chain key. The row still needs A chain object to render,
            // but it must not be presented AS that network: unknownChain marks
            // it so the card shows a dedicated unsupported state instead of a
            // Medibloc badge over someone else's balance.
            return {
              name: w.name,
              chain: DEFAULT_CHAIN,
              unknownChainKey: w.chainKey,
              portfolio: emptyPortfolio(w.address),
              failed: t('dash.unknownChain', { chain: w.chainKey }),
            }
          }
          if (!monikerCache.has(c.key)) {
            monikerCache.set(c.key, fetchValidatorMonikers(c).catch(() => ({})))
          }
          try {
            const monikers = await monikerCache.get(c.key)!
            return { name: w.name, chain: c, portfolio: await fetchWalletPortfolio(c, w.address, monikers) }
          } catch (e) {
            return {
              name: w.name,
              chain: c,
              portfolio: emptyPortfolio(w.address),
              failed: e instanceof Error ? e.message : 'unavailable',
            }
          }
        }),
      )
      const fresh = data.filter((r): r is Row => r !== null)
      setRows(fresh)
      settleAgainstSnapshot(fresh)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load balances')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets, t, chainsSettled])

  useEffect(() => {
    setRows(null)
    load()
  }, [load])

  // Claim history -> average monthly income, per chain. Deliberately a separate
  // effect: it is extra tx queries and must not hold up the balance render.
  // Grouped per chain because averaging across chains would mix denoms.
  useEffect(() => {
    let cancelled = false
    if (wallets.length === 0) return
    // Same registry gate as the balance load: the `continue` below would skip
    // every chain that has not arrived yet, and this effect would not re-run.
    if (!chainsSettled) return
    const byChain = new Map<string, string[]>()
    for (const w of wallets) {
      if (!findChain(w.chainKey)) continue
      byChain.set(w.chainKey, [...(byChain.get(w.chainKey) ?? []), w.address])
    }
    Promise.all(
      [...byChain.entries()].map(async ([key, addrs]) => {
        const chain = findChain(key)!
        try {
          const history = await fetchClaimHistory(chain, addrs)
          return { key, value: averageMonthly(history, key), ok: true }
        } catch {
          return { key, value: { amount: '0', months: 0 }, ok: false }
        }
      }),
    ).then((results) => {
      if (cancelled) return
      setMonthly(Object.fromEntries(results.map((r) => [r.key, r.value])))
      // Only cache chains whose history actually loaded. A failed fetch yields
      // zero, and persisting that would cache "you have earned nothing" and
      // show it confidently on the next visit.
      const good = results.filter((r) => r.ok)
      if (good.length > 0) {
        saveSnapshotMonthly(Object.fromEntries(good.map((r) => [r.key, r.value])))
      }
    })
    return () => {
      cancelled = true
    }
  }, [wallets, chainsSettled])

  if (wallets.length === 0) {
    return (
      <div>
        <h1 className="text-xl font-semibold">{t('dash.title')}</h1>
        <EmptyState
          icon={Wallet}
          title={t('dash.welcome')}
          description={t('dash.welcomeDesc')}
          actions={[
            { label: t('dash.createWallet'), to: '/settings?action=create', icon: Plus },
            { label: t('dash.importWallet'), to: '/settings?action=import', icon: Import, variant: 'secondary' },
            { label: t('dash.watchAddress'), to: '/alarms', icon: Bell, variant: 'secondary' },
          ]}
        />
      </div>
    )
  }

  // Rehydrate the last-seen figures so returning to the dashboard shows the
  // numbers you left instead of an empty screen. Needs the chain registry, so
  // it waits on the same gate the live load does - that is one fast local API
  // call, against many slow chain queries.
  const snapshotRows: Row[] | null =
    !chainsSettled || !snapshot
      ? null
      : snapshot.rows
          .map((s): Row | null => {
            const c = findChain(s.chainKey)
            if (!c) return null // chain since removed - do not guess a network
            return {
              name: s.name,
              chain: c,
              portfolio: {
                address: s.address,
                available: s.available,
                staked: s.staked,
                rewards: s.rewards,
                commission: s.commission,
                isValidator: s.isValidator,
                delegations: [], // not cached; the live load fills these in
              },
            }
          })
          .filter((r): r is Row => r !== null)

  // Live data wins the moment it exists; until then the snapshot stands in, and
  // `showingSnapshot` drives the badge that says so.
  const displayRows = rows ?? snapshotRows
  const showingSnapshot = rows === null && (snapshotRows?.length ?? 0) > 0

  // The blocking modal is reserved for a cold start - arriving at the app. On
  // an in-app return the figures are already on screen and covering them to
  // re-fetch is just friction; the refreshing badge carries that instead. The
  // snapshot renders behind the modal either way, so the count-up still starts
  // from the numbers the user last saw.
  const modalUp = isColdStart && !rows && (loading || !chainsSettled)

  const visibleRows = (displayRows ?? []).filter((r) => !chainFilter || r.chain.key === chainFilter)

  // Totals are computed per chain and summed with exact BigInt arithmetic.
  // Base-unit balances routinely exceed Number.MAX_SAFE_INTEGER, and two chains
  // are different assets - neither may be added together as plain numbers.
  const groups = walletChains
    .filter((c) => !chainFilter || c.key === chainFilter)
    .map((c) => {
      const inChain = visibleRows.filter((r) => r.chain.key === c.key)
      const of = (fn: (p: WalletPortfolio) => string) => sumBase(inChain.map((r) => fn(r.portfolio)))
      const available = of((p) => p.available)
      const staked = of((p) => p.staked)
      const rewards = of((p) => p.rewards)
      const commission = of((p) => p.commission)
      return {
        chain: c,
        rows: inChain,
        available,
        staked,
        rewards,
        commission,
        // Named exactly what it is. This was labelled "Total value" while
        // omitting unbonding balances and unclaimed rewards, so it understated
        // holdings and did so silently. Unbonding is not queried yet (see the
        // audit report); until it is, the label must not promise a total.
        total: addBase(available, staked),
        claimable: addBase(rewards, commission),
        anyValidator: inChain.some((r) => r.portfolio.isValidator),
        failures: inChain.filter((r) => r.failed),
      }
    })
    .filter((g) => g.rows.length > 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{t('dash.title')}</h1>
          {/* Never let cached figures pass as live. This says, in words, that
              what is on screen is the last known state and is being refreshed. */}
          {/* Only when cached figures are actually exposed - i.e. the modal has
              gone but live data never arrived (a failed or errored load).
              While the modal is up nothing stale is readable, so the badge
              would just be noise. */}
          {showingSnapshot && !modalUp && (
            <p
              role="status"
              aria-live="polite"
              className="flex items-center gap-1.5 text-xs text-slate-500"
            >
              <span
                data-spinner
                className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-amber-200 border-t-amber-600"
              />
              {t('dash.snapshotRefreshing', { when: relativeTime(snapshot!.savedAt, t) })}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <OptionPicker
            label={t('dash.currency')}
            value={currency}
            onChange={changeCurrency}
            options={CURRENCIES.map((c) => ({
              value: c.code,
              label: c.label,
              hint: c.symbol,
            }))}
          />
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
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          <button onClick={load} className="underline">
            {t('common.retry')}
          </button>
        </div>
      )}

      {/* One totals card per chain. Amounts from different networks are never
          added together - they are different assets with different decimals. */}
      {/* Only on the FIRST load, when there is nothing on screen yet. A
          background refresh must not throw an overlay over figures the user is
          already reading. */}
      {/* The blocking overlay is only for a genuinely empty screen. With a
          snapshot on display there is something to read, so refreshing is
          demoted to the quiet badge below rather than covering the figures. */}
      {modalUp && (
        <LoadingOverlay title={t('dash.loadingWallets')} subtitle={t('dash.loadingWalletsHint')} />
      )}

      {groups.map((g, gi) => {
        // Collapsing only earns its keep when several chains are stacked. With
        // one group there is nothing to scroll past, so the control would be
        // pure friction.
        const collapsible = groups.length > 1
        const open = !collapsible || (openChains[g.chain.key] ?? gi === 0)
        const panelId = `chain-panel-${g.chain.key}`
        return (
        <div key={g.chain.key} className="space-y-4">
          {/* Hero card. Tinted with the brand amber so the headline figure
              reads as the primary surface rather than one more white card;
              the income card below uses green, so the two are distinguishable
              at a glance without relying on position alone. */}
          <div className="relative rounded-xl border-2 border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center justify-between text-xs text-amber-800">
              <span className="font-medium">
                {t('dash.totalValue')} ·{' '}
                {t(g.rows.length > 1 ? 'dash.wallets' : 'dash.wallet', { count: g.rows.length })}
              </span>
              <span className="rounded bg-white/70 px-1.5 py-0.5 font-medium text-amber-900">
                {g.chain.chainName}
              </span>
            </div>

            {/* Change since the last visit, drifting up out of the card's
                top-right. Anchored to the card, so it never overlaps the
                figure it refers to. */}
            {deltas[g.chain.key] && (
              <span className="absolute right-4 top-9 block h-5 w-0">
                <DeltaFloat
                  positive={!deltas[g.chain.key].startsWith('-')}
                  text={`${deltas[g.chain.key].startsWith('-') ? '−' : '+'}${formatAmount(
                    deltas[g.chain.key].replace('-', ''),
                    g.chain,
                  )} ${g.chain.displayDenom}`}
                  onDone={() =>
                    setDeltas((d) => {
                      const next = { ...d }
                      delete next[g.chain.key]
                      return next
                    })
                  }
                />
              </span>
            )}

            <div className="text-3xl font-bold text-amber-950">
              <CountUp value={g.total} from={countFrom[g.chain.key]} format={(b) => formatAmount(b, g.chain)} />{' '}
              <span className="text-base font-semibold text-amber-800">{g.chain.displayDenom}</span>
            </div>
            {fiatFor(g.chain, g.total) && (
              <div className="text-sm font-medium text-amber-800">≈ {fiatFor(g.chain, g.total)}</div>
            )}

            {/* Partial failure: say so rather than presenting a short total as current. */}
            {g.failures.length > 0 && (
              <div role="status" className="mt-2 rounded-lg bg-white/80 px-3 py-2 text-xs text-amber-900">
                {t('dash.partialFailure', { count: g.failures.length })}
              </div>
            )}

            {open && (
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                <Stat icon={Wallet} label={t('dash.available')} base={g.available} from={countFromStat.available?.[g.chain.key]} chain={g.chain} />
                <Stat icon={Coins} label={t('dash.staked')} base={g.staked} from={countFromStat.staked?.[g.chain.key]} chain={g.chain} />
                <Stat icon={Gift} label={t('dash.rewards')} base={g.rewards} from={countFromStat.rewards?.[g.chain.key]} chain={g.chain} />
                {g.anyValidator && (
                  <Stat icon={Landmark} label={t('dash.commission')} base={g.commission} from={countFromStat.commission?.[g.chain.key]} chain={g.chain} />
                )}
              </div>
            )}

            {/* The headline total stays visible either way - folding hides the
                breakdown, never the figure the card exists to show. */}
            {collapsible && (
              <button
                type="button"
                onClick={() => setOpenChains((s) => ({ ...s, [g.chain.key]: !open }))}
                aria-expanded={open}
                aria-controls={panelId}
                className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg border border-amber-200 bg-white/60 py-1.5 text-xs font-medium text-amber-900 hover:bg-white"
              >
                {t(open ? 'dash.foldChain' : 'dash.unfoldChain', { chain: g.chain.chainName })}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>
            )}
          </div>

          <div id={panelId} hidden={!open} className="space-y-4">
          {/* Average monthly income - a headline metric, deliberately loud.
              Shown whenever this chain is actually earning (staked or accrued
              rewards), so someone who has staked but never claimed sees WHY it
              is empty rather than wondering where the figure went. */}
          {(isPositiveBase(monthly[g.chain.key]?.amount ?? '0') ||
            isPositiveBase(g.staked) ||
            isPositiveBase(g.rewards)) && (
            <Link
              to={`/rewards?chain=${g.chain.key}`}
              className="group block rounded-xl border-2 border-green-200 bg-green-50 p-4 transition-colors hover:border-green-300 hover:bg-green-100"
            >
              {/* Sized to fit 375px without wrapping. "per month" is NOT
                  repeated on the amount line - the label above already says
                  monthly income, and dropping it is what buys the room. */}
              <div className="flex items-center gap-2.5 sm:gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-700 text-white sm:h-11 sm:w-11">
                  <TrendingUp className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={2.2} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-green-800 sm:text-xs">
                    {t('dash.monthlyIncome')}
                  </div>

                  {isPositiveBase(monthly[g.chain.key]?.amount ?? '0') ? (
                    <>
                      <div className="truncate text-2xl font-bold leading-tight text-green-900 sm:text-3xl">
                        {formatAmount(monthly[g.chain.key]!.amount, g.chain)}{' '}
                        <span className="text-base font-semibold sm:text-lg">
                          {g.chain.displayDenom}
                        </span>
                      </div>
                      <div className="truncate text-xs text-green-800 sm:text-sm">
                        {fiatFor(g.chain, monthly[g.chain.key]!.amount) && (
                          <span className="font-medium">
                            ≈ {fiatFor(g.chain, monthly[g.chain.key]!.amount)}
                            {' · '}
                          </span>
                        )}
                        {monthly[g.chain.key]!.months > 1
                          ? t('dash.overMonths', { months: monthly[g.chain.key]!.months })
                          : t('dash.oneMonth')}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-2xl font-bold leading-tight text-green-900 sm:text-3xl">
                        —
                      </div>
                      <div className="text-xs text-green-800 sm:text-sm">{t('dash.noClaimsYet')}</div>
                    </>
                  )}
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-green-700 transition-transform group-hover:translate-x-0.5" />
              </div>
            </Link>
          )}

          {isPositiveBase(g.claimable) && (
            <Link
              to={`/rewards?chain=${g.chain.key}`}
              className="flex items-center justify-between rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800 hover:bg-green-100"
            >
              <span className="flex items-center gap-2">
                <Gift className="h-4 w-4" />{' '}
                {t('dash.claimable', {
                  amount: formatAmount(g.claimable, g.chain),
                  denom: g.chain.displayDenom,
                })}
              </span>
              <span className="font-medium">{t('dash.claim')}</span>
            </Link>
          )}

          <section className="space-y-2">
            <h2 className="font-medium">
              {t('dash.yourWallets')}
              {groups.length > 1 && (
                <span className="ml-2 text-sm font-normal text-slate-500">{g.chain.chainName}</span>
              )}
            </h2>
            <div className="space-y-2">
              {g.rows.map((r) => (
                <WalletRow
                  key={`${r.chain.key}:${r.portfolio.address}`}
                  name={r.name}
                  chain={r.chain}
                  p={r.portfolio}
                  price={prices[r.chain.key] ?? null}
                  currency={currency}
                  failed={r.failed}
                  unknownChainKey={r.unknownChainKey}
                />
              ))}
            </div>
          </section>
          </div>
        </div>
        )
      })}

      {/* wrap + nowrap: labels like "Send / receive" must not break mid-phrase.
          The row reflows to a second line instead. */}
      <div className="flex flex-wrap gap-2">
        <Link
          to="/send"
          className="flex items-center gap-2 whitespace-nowrap rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-amber-600"
        >
          <SendHorizontal className="h-4 w-4 shrink-0" /> {t('dash.send')}
        </Link>
        <Link
          to="/staking"
          className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:border-amber-500"
        >
          <Coins className="h-4 w-4 shrink-0" /> {t('dash.stake')}
        </Link>
        <Link
          to="/history"
          className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:border-amber-500"
        >
          <HistoryIcon className="h-4 w-4 shrink-0" /> {t('dash.history')}
        </Link>
      </div>

      {/* Wallet management shortcuts. Previously these only existed in the
          empty state, so once you had one wallet the only route to adding
          another was Settings. Kept in a separate row from the transactional
          actions above so the two are not confused. */}
      <div className="border-t border-slate-200 pt-3">
        <h2 className="mb-2 text-xs font-medium text-slate-500">{t('dash.manage')}</h2>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/settings?action=create"
            className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:border-amber-500"
          >
            <Plus className="h-4 w-4" /> {t('dash.createWallet')}
          </Link>
          <Link
            to="/settings?action=import"
            className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:border-amber-500"
          >
            <Import className="h-4 w-4" /> {t('dash.importWallet')}
          </Link>
          <Link
            to="/alarms"
            className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:border-amber-500"
          >
            <Bell className="h-4 w-4" /> {t('dash.watchAddress')}
          </Link>
        </div>
      </div>
    </div>
  )
}

// Used only inside the amber hero card, so it is coloured for that surface -
// the previous slate tones do not hold contrast on a tinted background.
function Stat({
  icon: Icon,
  label,
  base,
  from,
  chain,
}: {
  icon: typeof Wallet
  label: string
  /** Base-unit amount. */
  base: string
  /** Base-unit amount to count up from, when a snapshot supplied one. */
  from?: string
  chain: ChainInfo
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-amber-800">
        <Icon className="h-3.5 w-3.5 shrink-0" /> {label}
      </div>
      <div className="truncate font-semibold text-amber-950">
        <CountUp value={base} from={from} format={(b) => formatAmount(b, chain)} />
      </div>
    </div>
  )
}

/** Placeholder used when a wallet's balances could not be fetched. */
/**
 * Coarse "how long ago" for the snapshot badge. Deliberately vague: the point
 * is to signal that the figures are not live, not to imply the cache is precise.
 */
function relativeTime(iso: string, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return t('dash.snapshotAgeUnknown')
  const mins = Math.floor((Date.now() - then) / 60000)
  if (mins < 1) return t('dash.snapshotJustNow')
  if (mins < 60) return t('dash.snapshotMinutes', { count: mins })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t('dash.snapshotHours', { count: hours })
  return t('dash.snapshotDays', { count: Math.floor(hours / 24) })
}

function emptyPortfolio(address: string): WalletPortfolio {
  return {
    address,
    available: '0',
    delegations: [],
    staked: '0',
    rewards: '0',
    commission: '0',
    isValidator: false,
  }
}

function WalletRow({
  name,
  chain,
  p,
  price,
  currency,
  failed,
  unknownChainKey,
}: {
  name: string
  chain: ChainInfo
  p: WalletPortfolio
  price: number | null
  currency: string
  failed?: string
  /** Wallet is on a chain this build does not know - see Row.unknownChainKey. */
  unknownChainKey?: string
}) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const total = addBase(p.available, p.staked)

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={name}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700"
        >
          <Wallet className="h-4.5 w-4.5" strokeWidth={1.8} />
        </button>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-1.5 text-left text-sm font-medium"
          >
            {name}
            {p.isValidator && (
              <span className="flex items-center gap-0.5 rounded bg-amber-100 px-1 text-[11px] text-amber-700">
                <ShieldCheck className="h-2.5 w-2.5" /> {t('dash.validator')}
              </span>
            )}
          </button>
          <CopyAddress
            address={p.address}
            display={`${p.address.slice(0, 16)}...${p.address.slice(-6)}`}
            className="max-w-full text-xs text-slate-500"
          />
          {/* Never present a failed fetch as a real zero balance. */}
          {/* An unsupported network is a different situation from a failed
              fetch: nothing is wrong with the connection, the wallet simply
              belongs to a chain this build does not know. Saying "balance
              unavailable" would suggest retrying would help. */}
          {unknownChainKey ? (
            <div role="status" className="mt-0.5 text-xs text-amber-800">
              {t('dash.unsupportedNetwork', { chain: unknownChainKey })}
            </div>
          ) : (
            failed && (
              <div role="status" className="mt-0.5 text-xs text-amber-700">
                {t('dash.balanceUnavailable')}
              </div>
            )
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex shrink-0 items-center gap-2"
        >
          <span className="text-right">
            <span className="block text-sm font-semibold">{formatAmount(total, chain)}</span>
            <span className="block text-xs text-slate-500">
              {price !== null
                ? formatFiat(fiatValue(total, chain.decimals, price), currency)
                : chain.displayDenom}
            </span>
          </span>
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
          )}
        </button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-slate-100 px-4 py-3 text-sm">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span className="text-slate-500">
              {t('dash.available')} <span className="font-medium text-slate-800">{formatAmount(p.available, chain)}</span>
            </span>
            <span className="text-slate-500">
              {t('dash.staked')} <span className="font-medium text-slate-800">{formatAmount(p.staked, chain)}</span>
            </span>
            <span className="text-slate-500">
              {t('dash.rewards')} <span className="font-medium text-green-700">{formatAmount(p.rewards, chain)}</span>
            </span>
            {p.isValidator && (
              <span className="text-slate-500">
                {t('dash.commission')} <span className="font-medium text-amber-700">{formatAmount(p.commission, chain)}</span>
              </span>
            )}
          </div>

          {p.delegations.length > 0 ? (
            <div>
              <div className="mb-1 text-xs font-medium text-slate-500">{t('dash.stakedWith')}</div>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                {p.delegations.map((d) => (
                  <li key={d.validator} className="flex items-center justify-between px-3 py-1.5 text-xs">
                    <span className="truncate">{d.moniker}</span>
                    <span className="shrink-0 text-slate-600">
                      {formatAmount(d.amount, chain)} {chain.displayDenom}
                      {isPositiveBase(d.reward) && (
                        <span className="ml-1 text-green-700">+{formatAmount(d.reward, chain)}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              {t('dash.notStaked')}{' '}
              {/* Only offer "stake to Beehive" where a Beehive validator
                  actually exists. On a chain we do not validate on, the CTA is
                  neutral rather than advertising a validator the user cannot
                  find in the list. */}
              <Link to="/staking" className="text-amber-700 hover:underline">
                {t(chain.beehiveValidator ? 'dash.stakeToBeehive' : 'dash.startStaking')}
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
