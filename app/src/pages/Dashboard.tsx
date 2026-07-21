import { useState } from 'react'
import { DEFAULT_CHAIN, formatAmount } from '../chains'

interface Coin {
  denom: string
  amount: string
}

export default function Dashboard() {
  const chain = DEFAULT_CHAIN
  const [address, setAddress] = useState('')
  const [balances, setBalances] = useState<Coin[] | null>(null)
  const [staked, setStaked] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function lookup() {
    if (!address.startsWith(chain.bech32Prefix)) {
      setError(`Enter a ${chain.chainName} address (starts with "${chain.bech32Prefix}")`)
      return
    }
    setLoading(true)
    setError('')
    setBalances(null)
    setStaked(null)
    try {
      const balRes = await fetch(`${chain.lcd}/cosmos/bank/v1beta1/balances/${address}`)
      if (!balRes.ok) throw new Error(`LCD returned ${balRes.status}`)
      const balData = await balRes.json()
      setBalances(balData.balances ?? [])

      const delRes = await fetch(`${chain.lcd}/cosmos/staking/v1beta1/delegations/${address}`)
      if (delRes.ok) {
        const delData = await delRes.json()
        const total = (delData.delegation_responses ?? []).reduce(
          (sum: number, d: { balance: Coin }) => sum + Number(d.balance.amount),
          0,
        )
        setStaked(String(total))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lookup failed')
    } finally {
      setLoading(false)
    }
  }

  const available = balances?.find((b) => b.denom === chain.denom)?.amount ?? '0'

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <p className="text-sm text-slate-500">
        Skeleton milestone: look up any {chain.chainName} address to confirm the app can read
        the chain. Wallet import and signing come next.
      </p>
      <div className="flex gap-2">
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value.trim())}
          placeholder={`${chain.bech32Prefix}1...`}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-amber-500 focus:outline-none"
        />
        <button
          onClick={lookup}
          disabled={loading || !address}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Look up'}
        </button>
      </div>
      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {balances !== null && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">Available</div>
            <div className="text-2xl font-semibold">{formatAmount(available, chain)}</div>
            <div className="text-xs text-slate-400">{chain.displayDenom}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">Staked</div>
            <div className="text-2xl font-semibold">
              {staked === null ? '-' : formatAmount(staked, chain)}
            </div>
            <div className="text-xs text-slate-400">{chain.displayDenom}</div>
          </div>
        </div>
      )}
    </div>
  )
}
