import { useCallback, useEffect, useState } from 'react'
import { Coins, Gift, ShieldCheck, Star, Search, Plus, Import, Wallet } from 'lucide-react'
import { DEFAULT_CHAIN, formatAmount, toBaseUnits } from '../chains'
import { useWallet } from '../wallet/WalletContext'
import { delegate, undelegate, claimRewards, serviceFeeActive, isBeehive } from '../wallet/staking'
import EmptyState from '../components/EmptyState'

interface Validator {
  operator: string
  moniker: string
  identity: string
  commission: number
  tokens: string
  jailed: boolean
}

interface StakeData {
  validators: Validator[]
  delegations: Record<string, string>
  rewards: Record<string, string>
  totalReward: string
}

const chain = DEFAULT_CHAIN

function abbrev(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return n.toFixed(0)
}

// Keybase avatar lookup, cached per identity across renders.
const avatarCache = new Map<string, string | null>()

function ValidatorAvatar({ identity, moniker }: { identity: string; moniker: string }) {
  const [url, setUrl] = useState<string | null>(identity ? avatarCache.get(identity) ?? null : null)

  useEffect(() => {
    if (!identity || avatarCache.has(identity)) return
    let cancelled = false
    fetch(`https://keybase.io/_/api/1.0/user/lookup.json?fields=pictures&key_suffix=${identity}`)
      .then((r) => r.json())
      .then((d) => {
        const pic = d.them?.[0]?.pictures?.primary?.url ?? null
        avatarCache.set(identity, pic)
        if (!cancelled) setUrl(pic)
      })
      .catch(() => avatarCache.set(identity, null))
    return () => {
      cancelled = true
    }
  }, [identity])

  const palette = [
    'bg-amber-100 text-amber-700',
    'bg-blue-100 text-blue-700',
    'bg-teal-100 text-teal-700',
    'bg-purple-100 text-purple-700',
    'bg-pink-100 text-pink-700',
  ]
  const color = palette[[...moniker].reduce((s, c) => s + c.charCodeAt(0), 0) % palette.length]

  if (url) {
    return <img src={url} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
  }
  return (
    <div
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium ${color}`}
    >
      {moniker.slice(0, 1).toUpperCase()}
    </div>
  )
}

async function fetchStakeData(address: string): Promise<StakeData> {
  const [valsRes, delRes, rewRes] = await Promise.all([
    fetch(`${chain.lcd}/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=300`),
    fetch(`${chain.lcd}/cosmos/staking/v1beta1/delegations/${address}`),
    fetch(`${chain.lcd}/cosmos/distribution/v1beta1/delegators/${address}/rewards`),
  ])
  if (!valsRes.ok) throw new Error(`Validator list failed (${valsRes.status})`)

  const valsData = await valsRes.json()
  const validators: Validator[] = (valsData.validators ?? []).map(
    (v: {
      operator_address: string
      description: { moniker: string; identity: string }
      commission: { commission_rates: { rate: string } }
      tokens: string
      jailed: boolean
    }) => ({
      operator: v.operator_address,
      moniker: v.description?.moniker ?? v.operator_address,
      identity: v.description?.identity ?? '',
      commission: Number(v.commission?.commission_rates?.rate ?? 0),
      tokens: v.tokens ?? '0',
      jailed: !!v.jailed,
    }),
  )

  const delegations: Record<string, string> = {}
  if (delRes.ok) {
    const delData = await delRes.json()
    for (const d of delData.delegation_responses ?? []) {
      delegations[d.delegation.validator_address] = d.balance.amount
    }
  }

  const rewards: Record<string, string> = {}
  let totalReward = '0'
  if (rewRes.ok) {
    const rewData = await rewRes.json()
    for (const r of rewData.rewards ?? []) {
      const coin = (r.reward ?? []).find((c: { denom: string }) => c.denom === chain.denom)
      if (coin) rewards[r.validator_address] = String(Math.floor(Number(coin.amount)))
    }
    const totalCoin = (rewData.total ?? []).find((c: { denom: string }) => c.denom === chain.denom)
    if (totalCoin) totalReward = String(Math.floor(Number(totalCoin.amount)))
  }

  return { validators, delegations, rewards, totalReward }
}

export default function Staking() {
  const { active, wallets, setActive, getSigner } = useWallet()
  const [data, setData] = useState<StakeData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    if (!active) return
    setLoading(true)
    setError('')
    try {
      setData(await fetchStakeData(active.address))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load staking data')
    } finally {
      setLoading(false)
    }
  }, [active])

  useEffect(() => {
    setData(null)
    load()
  }, [load])

  if (!active) {
    return (
      <div>
        <h1 className="text-xl font-semibold">Staking</h1>
        <EmptyState
          icon={Coins}
          title="No wallet yet"
          description="Add a wallet to stake to Beehive for free and earn rewards."
          actions={[
            { label: 'Create wallet', to: '/settings?action=create', icon: Plus },
            { label: 'Import wallet', to: '/settings?action=import', icon: Import, variant: 'secondary' },
          ]}
        />
      </div>
    )
  }

  const staked = data ? Object.values(data.delegations).reduce((s, a) => s + Number(a), 0) : 0
  const rewardValidators = data ? Object.keys(data.rewards) : []

  async function claimAll(password: string) {
    if (!active || rewardValidators.length === 0) return
    setNotice('')
    setError('')
    const signer = await getSigner(active.address, password)
    const hash = await claimRewards(chain, signer, active.address, rewardValidators)
    setNotice(`Rewards claimed. ${hash.slice(0, 12)}...`)
    await load()
  }

  const q = query.trim().toLowerCase()
  const ordered = data
    ? [...data.validators]
        .filter((v) => !v.jailed || data.delegations[v.operator])
        .filter((v) => q === '' || v.moniker.toLowerCase().includes(q))
        .sort((a, b) => {
          if (isBeehive(chain, a.operator)) return -1
          if (isBeehive(chain, b.operator)) return 1
          return Number(b.tokens) - Number(a.tokens)
        })
    : []

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Staking</h1>

      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <Wallet className="h-4.5 w-4.5" strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-slate-500">Staking from</div>
          <div className="truncate font-mono text-xs text-slate-400">
            {active.address.slice(0, 18)}...{active.address.slice(-6)}
          </div>
        </div>
        {wallets.length > 1 ? (
          <select
            value={active.address}
            onChange={(e) => setActive(e.target.value)}
            className="shrink-0 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          >
            {wallets.map((w) => (
              <option key={w.address} value={w.address}>
                {w.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="shrink-0 text-sm font-medium">{active.name}</span>
        )}
      </div>

      {notice && (
        <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</div>
      )}
      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Coins className="h-3.5 w-3.5" /> Total staked
          </div>
          <div className="text-xl font-semibold">
            {data ? formatAmount(String(staked), chain) : '...'}{' '}
            <span className="text-xs font-normal text-slate-400">{chain.displayDenom}</span>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Gift className="h-3.5 w-3.5" /> Claimable rewards
          </div>
          <div className="text-xl font-semibold">
            {data ? formatAmount(data.totalReward, chain) : '...'}{' '}
            <span className="text-xs font-normal text-slate-400">{chain.displayDenom}</span>
          </div>
        </div>
      </div>

      {data && Number(data.totalReward) > 0 && (
        <ActionForm
          label={`Claim all rewards (${rewardValidators.length} validator${rewardValidators.length > 1 ? 's' : ''})`}
          submitLabel="Claim"
          onSubmit={claimAll}
          onError={setError}
        />
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input
          name="beehive-validator-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search validators"
          autoComplete="off"
          className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-amber-500 focus:outline-none"
        />
      </div>

      {loading && !data && <p className="text-sm text-slate-500">Loading validators...</p>}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {ordered.map((v, i) => (
          <ValidatorRow
            key={v.operator}
            validator={v}
            staked={data?.delegations[v.operator]}
            reward={data?.rewards[v.operator]}
            first={i === 0}
            onDone={(msg) => {
              setNotice(msg)
              load()
            }}
            onError={setError}
          />
        ))}
        {data && ordered.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-slate-500">No validators match.</p>
        )}
      </div>
    </div>
  )
}

function ValidatorRow({
  validator,
  staked,
  reward,
  first,
  onDone,
  onError,
}: {
  validator: Validator
  staked?: string
  reward?: string
  first: boolean
  onDone: (msg: string) => void
  onError: (msg: string) => void
}) {
  const { active, getSigner } = useWallet()
  const [action, setAction] = useState<'none' | 'delegate' | 'undelegate'>('none')
  const beehive = isBeehive(chain, validator.operator)
  const power = Number(validator.tokens) / 10 ** chain.decimals

  async function submitDelegate(password: string, amount: string) {
    if (!active) return
    const base = toBaseUnits(amount, chain)
    const signer = await getSigner(active.address, password)
    const hash = await delegate(chain, signer, active.address, validator.operator, base)
    setAction('none')
    onDone(`Delegated to ${validator.moniker}. ${hash.slice(0, 12)}...`)
  }

  async function submitUndelegate(password: string, amount: string) {
    if (!active) return
    const base = toBaseUnits(amount, chain)
    const signer = await getSigner(active.address, password)
    const hash = await undelegate(chain, signer, active.address, validator.operator, base)
    setAction('none')
    onDone(`Undelegation started from ${validator.moniker}. ${hash.slice(0, 12)}...`)
  }

  return (
    <div className={`${first ? '' : 'border-t border-slate-100'} ${beehive ? 'bg-amber-50/50' : ''}`}>
      <div className="flex items-center gap-3 px-3 py-2">
        <ValidatorAvatar identity={validator.identity} moniker={validator.moniker} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            {beehive && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />}
            <span className="truncate">{validator.moniker}</span>
            {beehive && (
              <span className="flex shrink-0 items-center gap-0.5 rounded bg-green-100 px-1 text-[11px] font-medium text-green-700">
                <ShieldCheck className="h-2.5 w-2.5" /> Free
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
            <span>{(validator.commission * 100).toFixed(0)}% comm</span>
            <span>·</span>
            <span>{abbrev(power)} {chain.displayDenom}</span>
            {staked && (
              <>
                <span>·</span>
                <span className="font-medium text-slate-700">
                  you: {formatAmount(staked, chain)}
                </span>
                {reward && Number(reward) > 0 && (
                  <span className="text-green-700">+{formatAmount(reward, chain)}</span>
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            onClick={() => setAction(action === 'delegate' ? 'none' : 'delegate')}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
              beehive
                ? 'bg-amber-500 text-white hover:bg-amber-600'
                : 'border border-slate-300 hover:border-amber-500'
            }`}
          >
            {beehive ? 'Stake' : 'Delegate'}
          </button>
          {staked && (
            <button
              onClick={() => setAction(action === 'undelegate' ? 'none' : 'undelegate')}
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs hover:border-amber-500"
            >
              Undelegate
            </button>
          )}
        </div>
      </div>

      {action === 'delegate' && (
        <div className="px-3 pb-3">
          {!beehive && serviceFeeActive(chain) && (
            <p className="mb-1 text-xs text-slate-500">
              Service fee of {formatAmount(chain.serviceFee, chain)} {chain.displayDenom} applies.
            </p>
          )}
          <ActionForm
            label={`Delegate to ${validator.moniker}`}
            submitLabel="Sign and delegate"
            withAmount
            onSubmit={submitDelegate}
            onError={onError}
          />
        </div>
      )}
      {action === 'undelegate' && (
        <div className="px-3 pb-3">
          <p className="mb-1 text-xs text-slate-500">
            Undelegated funds unlock after the ~21-day unbonding period.
          </p>
          <ActionForm
            label={`Undelegate from ${validator.moniker}`}
            submitLabel="Sign and undelegate"
            withAmount
            onSubmit={submitUndelegate}
            onError={onError}
          />
        </div>
      )}
    </div>
  )
}

function ActionForm({
  label,
  submitLabel,
  withAmount = false,
  onSubmit,
  onError,
}: {
  label: string
  submitLabel: string
  withAmount?: boolean
  onSubmit: (password: string, amount: string) => Promise<void>
  onError: (msg: string) => void
}) {
  const [amount, setAmount] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    onError('')
    try {
      await onSubmit(password, amount)
      setAmount('')
      setPassword('')
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Transaction failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg bg-slate-50 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      {withAmount && (
        <div className="flex items-center gap-2">
          <input
            name="beehive-stake-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value.trim())}
            placeholder="Amount"
            required
            inputMode="decimal"
            autoComplete="off"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
          />
          <span className="text-sm text-slate-500">{chain.displayDenom}</span>
        </div>
      )}
      <input
        type="password"
        name="beehive-stake-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Wallet password to sign"
        required
        autoComplete="new-password"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
      />
      <button
        disabled={busy}
        className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
      >
        {busy ? 'Signing...' : submitLabel}
      </button>
    </form>
  )
}
