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
} from 'lucide-react'
import { DEFAULT_CHAIN, findChain, formatAmount, type ChainInfo } from '../chains'
import { addBase, sumBase, isPositiveBase } from '../wallet/amount'
import { useWallet } from '../wallet/WalletContext'
import EmptyState from '../components/EmptyState'
import CopyAddress from '../components/CopyAddress'
import Select from '../components/Select'
import { CURRENCIES, getCurrency, setCurrency, fetchPrice, fiatValue, formatFiat } from '../currency'
import { useT } from '../i18n/I18nContext'
import {
  fetchValidatorMonikers,
  fetchWalletPortfolio,
  type WalletPortfolio,
} from '../wallet/portfolio'

interface Row {
  name: string
  // Each row carries the chain it was actually queried against, so no total or
  // format ever mixes denoms/decimals from different networks.
  chain: ChainInfo
  portfolio: WalletPortfolio
  /** Set when this wallet's balances could not be loaded. */
  failed?: string
}

export default function Dashboard() {
  const { t } = useT()
  const { wallets } = useWallet()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [currency, setCurrencyState] = useState(getCurrency())
  // Price per chain key - different chains have different coingecko ids.
  const [prices, setPrices] = useState<Record<string, number | null>>({})
  // '' = show every chain.
  const [chainFilter, setChainFilter] = useState('')

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

  const load = useCallback(async () => {
    if (wallets.length === 0) return
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
            // Unknown chain key: never silently fall back to another network.
            return {
              name: w.name,
              chain: DEFAULT_CHAIN,
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
      setRows(data.filter((r): r is Row => r !== null))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load balances')
    } finally {
      setLoading(false)
    }
  }, [wallets, t])

  useEffect(() => {
    setRows(null)
    load()
  }, [load])

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

  const visibleRows = (rows ?? []).filter((r) => !chainFilter || r.chain.key === chainFilter)

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
        <h1 className="text-xl font-semibold">{t('dash.title')}</h1>
        <div className="flex gap-2">
          <Select value={currency} onChange={(e) => changeCurrency(e.target.value)} aria-label="Currency">
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </Select>
          {walletChains.length > 1 && (
            <Select
              value={chainFilter}
              onChange={(e) => setChainFilter(e.target.value)}
              aria-label={t('dash.chainFilter')}
            >
              <option value="">{t('dash.allChains')}</option>
              {walletChains.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.chainName}
                </option>
              ))}
            </Select>
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
      {!rows && loading && <p className="text-sm text-slate-500">{t('dash.loadingWallets')}</p>}

      {groups.map((g) => (
        <div key={g.chain.key} className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>
                {t('dash.totalValue')} ·{' '}
                {t(g.rows.length > 1 ? 'dash.wallets' : 'dash.wallet', { count: g.rows.length })}
              </span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium">{g.chain.chainName}</span>
            </div>
            <div className="text-3xl font-semibold">
              {formatAmount(g.total, g.chain)}{' '}
              <span className="text-base font-normal text-slate-500">{g.chain.displayDenom}</span>
            </div>
            {fiatFor(g.chain, g.total) && (
              <div className="text-sm font-medium text-slate-500">≈ {fiatFor(g.chain, g.total)}</div>
            )}

            {/* Partial failure: say so rather than presenting a short total as current. */}
            {g.failures.length > 0 && (
              <div role="status" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {t('dash.partialFailure', { count: g.failures.length })}
              </div>
            )}

            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
              <Stat icon={Wallet} label={t('dash.available')} value={formatAmount(g.available, g.chain)} />
              <Stat icon={Coins} label={t('dash.staked')} value={formatAmount(g.staked, g.chain)} />
              <Stat icon={Gift} label={t('dash.rewards')} value={formatAmount(g.rewards, g.chain)} />
              {g.anyValidator && (
                <Stat icon={Landmark} label={t('dash.commission')} value={formatAmount(g.commission, g.chain)} />
              )}
            </div>
          </div>

          {isPositiveBase(g.claimable) && (
            <Link
              to="/rewards"
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
                />
              ))}
            </div>
          </section>
        </div>
      ))}

      <div className="flex gap-2">
        <Link
          to="/send"
          className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-amber-600"
        >
          <SendHorizontal className="h-4 w-4" /> {t('dash.send')}
        </Link>
        <Link
          to="/staking"
          className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:border-amber-500"
        >
          <Coins className="h-4 w-4" /> {t('dash.stake')}
        </Link>
        <Link
          to="/history"
          className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:border-amber-500"
        >
          <HistoryIcon className="h-4 w-4" /> {t('dash.history')}
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
            className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:border-amber-500"
          >
            <Plus className="h-4 w-4" /> {t('dash.createWallet')}
          </Link>
          <Link
            to="/settings?action=import"
            className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:border-amber-500"
          >
            <Import className="h-4 w-4" /> {t('dash.importWallet')}
          </Link>
          <Link
            to="/alarms"
            className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:border-amber-500"
          >
            <Bell className="h-4 w-4" /> {t('dash.watchAddress')}
          </Link>
        </div>
      </div>
    </div>
  )
}

function Stat({ icon: Icon, label, value }: { icon: typeof Wallet; label: string; value: string }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-slate-500">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="font-medium">{value}</div>
    </div>
  )
}

/** Placeholder used when a wallet's balances could not be fetched. */
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
}: {
  name: string
  chain: ChainInfo
  p: WalletPortfolio
  price: number | null
  currency: string
  failed?: string
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
          {failed && (
            <div role="status" className="mt-0.5 text-xs text-amber-700">
              {t('dash.balanceUnavailable')}
            </div>
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
              <Link to="/staking" className="text-amber-700 hover:underline">
                {t('dash.stakeToBeehive')}
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
