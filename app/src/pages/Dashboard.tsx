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
import { DEFAULT_CHAIN, CHAINS, formatAmount } from '../chains'
import { addBase } from '../wallet/amount'
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
  portfolio: WalletPortfolio
}

export default function Dashboard() {
  const chain = DEFAULT_CHAIN
  const { t } = useT()
  const { wallets } = useWallet()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [currency, setCurrencyState] = useState(getCurrency())
  const [price, setPrice] = useState<number | null>(null)

  useEffect(() => {
    fetchPrice(chain.coingeckoId, currency).then(setPrice)
  }, [chain.coingeckoId, currency])

  function changeCurrency(code: string) {
    setCurrency(code)
    setCurrencyState(code)
  }

  const fiat = (base: string | number) =>
    price !== null ? formatFiat(fiatValue(base, chain.decimals, price), currency) : null

  const load = useCallback(async () => {
    if (wallets.length === 0) return
    setLoading(true)
    setError('')
    try {
      const monikers = await fetchValidatorMonikers(chain)
      const data = await Promise.all(
        wallets.map(async (w) => ({
          name: w.name,
          portfolio: await fetchWalletPortfolio(chain, w.address, monikers),
        })),
      )
      setRows(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load balances')
    } finally {
      setLoading(false)
    }
  }, [wallets, chain])

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

  const sum = (fn: (p: WalletPortfolio) => string) =>
    (rows ?? []).reduce((s, r) => s + Number(fn(r.portfolio)), 0)
  const totalAvailable = sum((p) => p.available)
  const totalStaked = sum((p) => p.staked)
  const totalRewards = sum((p) => p.rewards)
  const totalCommission = sum((p) => p.commission)
  const grandTotal = totalAvailable + totalStaked
  const claimable = totalRewards + totalCommission
  const anyValidator = (rows ?? []).some((r) => r.portfolio.isValidator)

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
          <Select value={chain.key} disabled={CHAINS.length < 2} aria-label="Chain">
            {CHAINS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.chainName}
              </option>
            ))}
          </Select>
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

      {/* Portfolio totals across all wallets on this chain */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-xs text-slate-500">
          {t('dash.totalValue')} · {t(wallets.length > 1 ? 'dash.wallets' : 'dash.wallet', { count: wallets.length })}
        </div>
        <div className="text-3xl font-semibold">
          {rows ? formatAmount(String(grandTotal), chain) : '...'}{' '}
          <span className="text-base font-normal text-slate-400">{chain.displayDenom}</span>
        </div>
        {rows && fiat(grandTotal) && (
          <div className="text-sm font-medium text-slate-500">≈ {fiat(grandTotal)}</div>
        )}
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <Stat icon={Wallet} label={t('dash.available')} value={rows ? formatAmount(String(totalAvailable), chain) : '...'} />
          <Stat icon={Coins} label={t('dash.staked')} value={rows ? formatAmount(String(totalStaked), chain) : '...'} />
          <Stat icon={Gift} label={t('dash.rewards')} value={rows ? formatAmount(String(totalRewards), chain) : '...'} />
          {anyValidator && (
            <Stat icon={Landmark} label={t('dash.commission')} value={formatAmount(String(totalCommission), chain)} />
          )}
        </div>
      </div>

      {claimable > 0 && (
        <Link
          to="/rewards"
          className="flex items-center justify-between rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800 hover:bg-green-100"
        >
          <span className="flex items-center gap-2">
            <Gift className="h-4 w-4" />{' '}
            {t('dash.claimable', { amount: formatAmount(String(claimable), chain), denom: chain.displayDenom })}
          </span>
          <span className="font-medium">{t('dash.claim')}</span>
        </Link>
      )}

      {loading && !rows && <p className="text-sm text-slate-500">{t('dash.loadingWallets')}</p>}

      <section className="space-y-2">
        <h2 className="font-medium">{t('dash.yourWallets')}</h2>
        <div className="space-y-2">
          {rows?.map((r) => (
            <WalletRow
              key={r.portfolio.address}
              name={r.name}
              p={r.portfolio}
              price={price}
              currency={currency}
            />
          ))}
        </div>
      </section>

      <div className="flex gap-2">
        <Link
          to="/send"
          className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
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

function WalletRow({
  name,
  p,
  price,
  currency,
}: {
  name: string
  p: WalletPortfolio
  price: number | null
  currency: string
}) {
  const chain = DEFAULT_CHAIN
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
            className="max-w-full text-xs text-slate-400"
          />
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex shrink-0 items-center gap-2"
        >
          <span className="text-right">
            <span className="block text-sm font-semibold">{formatAmount(total, chain)}</span>
            <span className="block text-xs text-slate-400">
              {price !== null
                ? formatFiat(fiatValue(total, chain.decimals, price), currency)
                : chain.displayDenom}
            </span>
          </span>
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
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
                      {Number(d.reward) > 0 && (
                        <span className="ml-1 text-green-700">+{formatAmount(d.reward, chain)}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-slate-400">
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
