import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Coins, Gift, ShieldCheck, ExternalLink, Star } from 'lucide-react'
import { DEFAULT_CHAIN, formatAmount, toBaseUnits } from '../chains'
import { useWallet } from '../wallet/WalletContext'
import { delegate, undelegate, claimRewards, serviceFeeActive, isBeehive } from '../wallet/staking'

interface Validator {
  operator: string
  moniker: string
  commission: number
  tokens: string
  jailed: boolean
}

interface StakeData {
  validators: Validator[]
  delegations: Record<string, string> // operator -> staked base amount
  rewards: Record<string, string> // operator -> reward base amount (floored)
  totalReward: string
}

const chain = DEFAULT_CHAIN

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
      description: { moniker: string }
      commission: { commission_rates: { rate: string } }
      tokens: string
      jailed: boolean
    }) => ({
      operator: v.operator_address,
      moniker: v.description?.moniker ?? v.operator_address,
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
  const { active, getSigner } = useWallet()
  const [data, setData] = useState<StakeData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')

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
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Staking</h1>
        <p className="text-sm text-slate-500">
          No wallet yet.{' '}
          <Link to="/settings" className="text-amber-700 underline">
            Create or import one in Settings
          </Link>{' '}
          to stake.
        </p>
      </div>
    )
  }

  const staked = data
    ? Object.values(data.delegations).reduce((s, a) => s + Number(a), 0)
    : 0
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

  // Beehive first, then by voting power desc; jailed hidden unless delegated.
  const ordered = data
    ? [...data.validators]
        .filter((v) => !v.jailed || data.delegations[v.operator])
        .sort((a, b) => {
          if (isBeehive(chain, a.operator)) return -1
          if (isBeehive(chain, b.operator)) return 1
          return Number(b.tokens) - Number(a.tokens)
        })
    : []

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Staking</h1>

      {notice && (
        <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</div>
      )}
      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Coins className="h-3.5 w-3.5" /> Total staked
          </div>
          <div className="text-2xl font-semibold">
            {data ? formatAmount(String(staked), chain) : '...'}
          </div>
          <div className="text-xs text-slate-400">{chain.displayDenom}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Gift className="h-3.5 w-3.5" /> Claimable rewards
          </div>
          <div className="text-2xl font-semibold">
            {data ? formatAmount(data.totalReward, chain) : '...'}
          </div>
          <div className="text-xs text-slate-400">{chain.displayDenom}</div>
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

      {loading && !data && (
        <p className="text-sm text-slate-500">Loading validators from the chain...</p>
      )}

      <div className="space-y-2">
        {ordered.map((v) => (
          <ValidatorRow
            key={v.operator}
            validator={v}
            staked={data?.delegations[v.operator]}
            reward={data?.rewards[v.operator]}
            onDone={(msg) => {
              setNotice(msg)
              load()
            }}
            onError={setError}
          />
        ))}
      </div>
    </div>
  )
}

function ValidatorRow({
  validator,
  staked,
  reward,
  onDone,
  onError,
}: {
  validator: Validator
  staked?: string
  reward?: string
  onDone: (msg: string) => void
  onError: (msg: string) => void
}) {
  const { active, getSigner } = useWallet()
  const [action, setAction] = useState<'none' | 'delegate' | 'undelegate'>('none')
  const beehive = isBeehive(chain, validator.operator)

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

  const feeNote =
    !beehive && serviceFeeActive(chain)
      ? `A service fee of ${formatAmount(chain.serviceFee, chain)} ${chain.displayDenom} applies.`
      : ''

  return (
    <div
      className={`rounded-xl border bg-white p-4 ${
        beehive ? 'border-amber-300' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-medium">
            {beehive && <Star className="h-4 w-4 fill-amber-400 text-amber-400" />}
            <span className="truncate">{validator.moniker}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{(validator.commission * 100).toFixed(0)}% commission</span>
            {beehive ? (
              <span className="flex items-center gap-1 rounded bg-green-100 px-1.5 py-0.5 font-medium text-green-700">
                <ShieldCheck className="h-3 w-3" /> No fee
              </span>
            ) : serviceFeeActive(chain) ? (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                Service fee {formatAmount(chain.serviceFee, chain)} {chain.displayDenom}
              </span>
            ) : null}
            <a
              href={`${chain.explorerValidatorUrl}${validator.operator}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-amber-700 hover:underline"
            >
              details <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          {staked && (
            <div className="mt-1 text-xs text-slate-600">
              Staked: <span className="font-medium">{formatAmount(staked, chain)} {chain.displayDenom}</span>
              {reward && Number(reward) > 0 && (
                <span className="ml-2 text-green-700">
                  +{formatAmount(reward, chain)} reward
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => setAction(action === 'delegate' ? 'none' : 'delegate')}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
            beehive
              ? 'bg-amber-500 text-white hover:bg-amber-600'
              : 'border border-slate-300 hover:border-amber-500'
          }`}
        >
          {beehive ? 'Stake free' : 'Delegate'}
        </button>
        {staked && (
          <button
            onClick={() => setAction(action === 'undelegate' ? 'none' : 'undelegate')}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:border-amber-500"
          >
            Undelegate
          </button>
        )}
      </div>

      {action === 'delegate' && (
        <div className="mt-3">
          {feeNote && <p className="mb-1 text-xs text-slate-500">{feeNote}</p>}
          <ActionForm
            label={`Amount to delegate to ${validator.moniker}`}
            submitLabel="Sign and delegate"
            withAmount
            onSubmit={submitDelegate}
            onError={onError}
          />
        </div>
      )}
      {action === 'undelegate' && (
        <div className="mt-3">
          <p className="mb-1 text-xs text-slate-500">
            Undelegated funds are locked for the chain's unbonding period (about 21 days) before
            they return to your balance.
          </p>
          <ActionForm
            label={`Amount to undelegate from ${validator.moniker}`}
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
