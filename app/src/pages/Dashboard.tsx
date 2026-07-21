import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Wallet, Coins, Copy, Check, SendHorizontal, History as HistoryIcon } from 'lucide-react'
import { DEFAULT_CHAIN, formatAmount } from '../chains'
import { useWallet } from '../wallet/WalletContext'

interface Coin {
  denom: string
  amount: string
}

interface Balances {
  available: string
  staked: string | null
}

async function fetchBalances(address: string): Promise<Balances> {
  const chain = DEFAULT_CHAIN
  const balRes = await fetch(`${chain.lcd}/cosmos/bank/v1beta1/balances/${address}`)
  if (!balRes.ok) throw new Error(`Chain API returned ${balRes.status}`)
  const balData = await balRes.json()
  const available =
    (balData.balances ?? []).find((b: Coin) => b.denom === chain.denom)?.amount ?? '0'

  let staked: string | null = null
  const delRes = await fetch(`${chain.lcd}/cosmos/staking/v1beta1/delegations/${address}`)
  if (delRes.ok) {
    const delData = await delRes.json()
    staked = String(
      (delData.delegation_responses ?? []).reduce(
        (sum: number, d: { balance: Coin }) => sum + Number(d.balance.amount),
        0,
      ),
    )
  }
  return { available, staked }
}

export default function Dashboard() {
  const chain = DEFAULT_CHAIN
  const { active, wallets, setActive } = useWallet()
  const [balances, setBalances] = useState<Balances | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    if (!active) return
    setLoading(true)
    setError('')
    try {
      setBalances(await fetchBalances(active.address))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load balances')
    } finally {
      setLoading(false)
    }
  }, [active])

  useEffect(() => {
    setBalances(null)
    load()
  }, [load])

  if (!active) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-slate-500">
          Welcome to Beehive Wallet. Get started by{' '}
          <Link to="/settings" className="text-amber-700 underline">
            creating or importing a wallet
          </Link>{' '}
          - it stays in your browser, encrypted with your password.
        </p>
        <p className="text-sm text-slate-500">
          Or just want transaction alarms on an address?{' '}
          <Link to="/alarms" className="text-amber-700 underline">
            Set one up here
          </Link>
          .
        </p>
      </div>
    )
  }

  async function copy() {
    await navigator.clipboard.writeText(active!.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        {wallets.length > 1 && (
          <select
            value={active.address}
            onChange={(e) => setActive(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          >
            {wallets.map((w) => (
              <option key={w.address} value={w.address}>
                {w.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <Wallet className="h-4.5 w-4.5" strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{active.name}</div>
          <button
            onClick={copy}
            title="Copy address"
            className="flex max-w-full items-center gap-1.5 truncate font-mono text-xs text-slate-400 hover:text-amber-700"
          >
            <span className="truncate">{active.address}</span>
            {copied ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-green-600" />
            ) : (
              <Copy className="h-3.5 w-3.5 shrink-0" />
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          <button onClick={load} className="underline">
            Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Wallet className="h-3.5 w-3.5" /> Available
          </div>
          <div className="text-2xl font-semibold">
            {loading || !balances ? '...' : formatAmount(balances.available, chain)}
          </div>
          <div className="text-xs text-slate-400">{chain.displayDenom}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Coins className="h-3.5 w-3.5" /> Staked
          </div>
          <div className="text-2xl font-semibold">
            {loading || !balances || balances.staked === null
              ? '...'
              : formatAmount(balances.staked, chain)}
          </div>
          <div className="text-xs text-slate-400">{chain.displayDenom}</div>
        </div>
      </div>

      <div className="flex gap-2">
        <Link
          to="/send"
          className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
        >
          <SendHorizontal className="h-4 w-4" /> Send / receive
        </Link>
        <Link
          to="/history"
          className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:border-amber-500"
        >
          <HistoryIcon className="h-4 w-4" /> History
        </Link>
      </div>
    </div>
  )
}
