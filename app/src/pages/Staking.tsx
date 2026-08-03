import { useCallback, useEffect, useState } from 'react'
import { Coins, Gift, Search, Plus, Import, Wallet, ExternalLink } from 'lucide-react'
import { findChain, formatAmount, toBaseUnits, feeReserve, type ChainInfo } from '../chains'
import { sumBase, compareBase, addBase, floorBaseUnits, isPositiveBase } from '../wallet/amount'
import { useWallet } from '../wallet/WalletContext'
import {
  buildDelegate,
  buildUndelegate,
  buildClaim,
  serviceFeeActive,
  isFree,
  isValidatorAllowed,
  delegationHasServiceFee,
} from '../wallet/staking'
import { useTxReview, type Prepare } from '../wallet/useTxReview'
import type { ReviewRow } from '../components/TxReview'
import Card from '../components/Card'
import EmptyState from '../components/EmptyState'
import HelpTip from '../components/HelpTip'
import LoadingOverlay from '../components/LoadingOverlay'
import PageHeader from '../components/PageHeader'
import PercentButtons from '../components/PercentButtons'
import CopyAddress from '../components/CopyAddress'
import WalletSwitcher from '../components/WalletSwitcher'
import BottomSheet from '../components/BottomSheet'
import { maskAmount, usePrivacyMode } from '../privacyMode'
import { useT } from '../i18n/I18nContext'

interface Validator {
  operator: string
  moniker: string
  identity: string
  commission: number
  tokens: string
  jailed: boolean
  status: string // BOND_STATUS_BONDED | _UNBONDING | _UNBONDED
}

// A validator is "up" (signing) when it is bonded and not jailed.
function isUp(v: Validator): boolean {
  return v.status === 'BOND_STATUS_BONDED' && !v.jailed
}

interface StakeData {
  validators: Validator[]
  delegations: Record<string, string>
  rewards: Record<string, string>
  totalReward: string
  available: string
}

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

async function fetchStakeData(chain: ChainInfo, address: string): Promise<StakeData> {
  const [valsRes, delRes, rewRes, balRes] = await Promise.all([
    fetch(`${chain.lcd}/cosmos/staking/v1beta1/validators?pagination.limit=500`),
    fetch(`${chain.lcd}/cosmos/staking/v1beta1/delegations/${address}`),
    fetch(`${chain.lcd}/cosmos/distribution/v1beta1/delegators/${address}/rewards`),
    fetch(`${chain.lcd}/cosmos/bank/v1beta1/balances/${address}`),
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
      status: string
    }) => ({
      operator: v.operator_address,
      moniker: v.description?.moniker ?? v.operator_address,
      identity: v.description?.identity ?? '',
      commission: Number(v.commission?.commission_rates?.rate ?? 0),
      tokens: v.tokens ?? '0',
      jailed: !!v.jailed,
      status: v.status ?? '',
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
      if (coin) rewards[r.validator_address] = floorBaseUnits(coin.amount)
    }
    const totalCoin = (rewData.total ?? []).find((c: { denom: string }) => c.denom === chain.denom)
    if (totalCoin) totalReward = floorBaseUnits(totalCoin.amount)
  }

  let available = '0'
  if (balRes.ok) {
    const balData = await balRes.json()
    const coin = (balData.balances ?? []).find((c: { denom: string }) => c.denom === chain.denom)
    if (coin) available = String(coin.amount)
  }

  return { validators, delegations, rewards, totalReward, available }
}

export default function Staking() {
  const { t } = useT()
  const { active, wallets, getSigner } = useWallet()
  const hidden = usePrivacyMode()
  // Chain resolved from the active wallet, never a global default.
  const chain = active ? findChain(active.chainKey) : undefined
  const [data, setData] = useState<StakeData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'active' | 'jailed'>('active')
  // The claim password form lives in a BottomSheet, like delegate/undelegate.
  const [claimOpen, setClaimOpen] = useState(false)
  const { prepare, modal } = useTxReview()

  const load = useCallback(async () => {
    if (!active || !chain) return
    setLoading(true)
    setError('')
    try {
      setData(await fetchStakeData(chain, active.address))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('staking.errLoad'))
    } finally {
      setLoading(false)
    }
  }, [active, chain, t])

  useEffect(() => {
    setData(null)
    load()
  }, [load])

  if (!active) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('staking.title')} />
        <EmptyState
          icon={Coins}
          title={t('send.noWallet')}
          description={t('staking.noWalletDesc')}
          actions={[
            { label: t('dash.createWallet'), to: '/settings?action=create', icon: Plus },
            { label: t('dash.importWallet'), to: '/settings?action=import', icon: Import, variant: 'secondary' },
          ]}
        />
      </div>
    )
  }
  if (!chain) {
    return (
      <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
        {t('send.errUnknownChain', { chain: active.chainKey })}
      </div>
    )
  }

  const staked = data ? sumBase(Object.values(data.delegations)) : '0'
  const rewardValidators = data ? Object.keys(data.rewards) : []

  async function claimAll(password: string) {
    if (!active || !chain || rewardValidators.length === 0) return
    setNotice('')
    setError('')
    const signer = await getSigner(active.id, password)
    const { messages, memo } = buildClaim(active.address, rewardValidators, null)
    const claimChain = chain
    await prepare({
      chain: claimChain,
      signer,
      sender: active.address,
      messages,
      memo,
      confirmLabel: t('review.confirmClaim'),
      onDone: (hash) => {
        setNotice(t('staking.rewardsClaimed', { hash: hash.slice(0, 12) }))
        load()
      },
      onError: setError,
      buildRows: (est) => [
        { label: t('review.network'), value: `${claimChain.chainName} (${claimChain.chainId})` },
        { label: t('review.from'), value: `${active.name} · ${active.address}`, mono: true },
        {
          label: t('review.claimAmount'),
          value: `${formatAmount(data?.totalReward ?? '0', claimChain)} ${claimChain.displayDenom}`,
        },
        { label: t('review.fee'), value: `${formatAmount(est.amount, claimChain)} ${claimChain.displayDenom}` },
        { label: t('review.action'), value: t('review.actionClaim') },
      ],
    })
  }

  const q = query.trim().toLowerCase()
  const activeCount = data ? data.validators.filter((v) => isUp(v)).length : 0
  const jailedCount = data ? data.validators.filter((v) => !isUp(v)).length : 0
  const ordered = data
    ? [...data.validators]
        // Show exactly one set: the online (active) validators, or the jailed/
        // inactive ones - never a mix.
        .filter((v) => (view === 'active' ? isUp(v) : !isUp(v)))
        // Operator address as well as moniker: monikers are not unique and can
        // be chosen to impersonate, so the address is the reliable handle.
        .filter(
          (v) => q === '' || v.moniker.toLowerCase().includes(q) || v.operator.toLowerCase().includes(q),
        )
        .sort((a, b) => {
          const af = isFree(chain, a.operator)
          const bf = isFree(chain, b.operator)
          if (af && !bf) return -1
          if (bf && !af) return 1
          return compareBase(b.tokens, a.tokens)
        })
    : []

  return (
    <div className="space-y-5">
      <PageHeader title={t('staking.title')} />

      <div className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200/70">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <Wallet className="h-4.5 w-4.5" strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-slate-500">{t('staking.stakingFrom')}</div>
          <CopyAddress
            address={active.address}
            display={`${active.address.slice(0, 18)}...${active.address.slice(-6)}`}
            className="max-w-full text-xs text-slate-500"
          />
        </div>
        {/* Keyed by wallet id via WalletSwitcher. This used to hand the
            ADDRESS to setActive (which takes an id), so picking any wallet
            here silently fell back to the first one. */}
        {wallets.length > 1 ? (
          <WalletSwitcher label={t('staking.stakingFrom')} className="shrink-0" />
        ) : (
          <span className="shrink-0 text-sm font-medium">{active.name}</span>
        )}
      </div>

      {notice && (
        <div className="rounded-xl bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</div>
      )}
      {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {/* The two figures that decide what you do on this page, so they get the
          space. Both honour privacy mode. */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Coins className="h-3.5 w-3.5" strokeWidth={1.8} /> {t('staking.totalStaked')}
            <HelpTip text={t('help.staked')} />
          </div>
          <div className="mt-0.5 text-2xl font-semibold tabular-nums">
            {data ? maskAmount(formatAmount(staked, chain), hidden) : '...'}{' '}
            <span className="text-xs font-medium text-slate-500">{chain.displayDenom}</span>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Gift className="h-3.5 w-3.5" strokeWidth={1.8} /> {t('rewards.claimableTotal')}
            <HelpTip text={t('help.rewards')} />
          </div>
          <div className="mt-0.5 text-2xl font-semibold tabular-nums">
            {data ? maskAmount(formatAmount(data.totalReward, chain), hidden) : '...'}{' '}
            <span className="text-xs font-medium text-slate-500">{chain.displayDenom}</span>
          </div>
          {/* Quiet, and on the figure it acts on. The password form used to sit
              inline between the heroes and the search bar, an amber submit
              competing with the Stake buttons below. */}
          {data && isPositiveBase(data.totalReward) && (
            <button
              type="button"
              onClick={() => setClaimOpen(true)}
              className="mt-2 rounded-lg px-3 py-1.5 text-sm font-medium text-amber-700 ring-1 ring-amber-300 hover:bg-amber-50"
            >
              {t('rewards.claim')}
            </button>
          )}
        </Card>
      </div>

      {claimOpen && data && (
        <BottomSheet
          title={t('rewards.claim')}
          subtitle={`${active.name} · ${chain.chainName}`}
          onClose={() => setClaimOpen(false)}
        >
          <ActionForm
            chain={chain}
            label={t('staking.claimAll', { count: rewardValidators.length })}
            submitLabel={t('rewards.claim')}
            onSubmit={async (pw) => {
              await claimAll(pw)
              // Only on success - the review dialog has taken over. A throw
              // keeps the sheet (and its inline error) up.
              setClaimOpen(false)
            }}
            onError={setError}
          />
        </BottomSheet>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            name="beehive-validator-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('staking.search')}
            aria-label={t('staking.search')}
            autoComplete="off"
            className="w-full rounded-xl bg-white py-2.5 pl-9 pr-3 text-sm ring-1 ring-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="inline-flex rounded-xl bg-slate-100 p-0.5 text-sm">
            <button
              type="button"
              aria-pressed={view === 'active'}
              onClick={() => setView('active')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-colors ${
                view === 'active' ? 'bg-white font-medium text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-green-500" /> {t('staking.active')}
              <span className="text-xs text-slate-500">{activeCount}</span>
            </button>
            <button
              type="button"
              aria-pressed={view === 'jailed'}
              onClick={() => setView('jailed')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-colors ${
                view === 'jailed' ? 'bg-white font-medium text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-red-500" /> {t('staking.jailedInactive')}
              <span className="text-xs text-slate-500">{jailedCount}</span>
            </button>
          </div>
          {/* One tip for the whole toggle rather than a badge on every jailed
              row - the word is the thing that needs explaining, not each row. */}
          <HelpTip text={t('help.jailed')} align="end" className="text-slate-500" />
        </div>
      </div>

      {loading && !data && (
        <LoadingOverlay title={t('staking.loading')} subtitle={t('staking.loadingHint')} />
      )}

      <div className="max-h-[60vh] overflow-y-auto rounded-2xl bg-white ring-1 ring-slate-200/70">
        {ordered.map((v, i) => (
          <ValidatorRow
            key={v.operator}
            chain={chain}
            prepare={prepare}
            validator={v}
            staked={data?.delegations[v.operator]}
            reward={data?.rewards[v.operator]}
            available={data?.available}
            first={i === 0}
            onDone={(msg) => {
              setNotice(msg)
              load()
            }}
            onError={setError}
          />
        ))}
        {data && ordered.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-slate-500">{t('staking.noMatch')}</p>
        )}
      </div>
      {modal}
    </div>
  )
}

function ValidatorRow({
  chain,
  prepare,
  validator,
  staked,
  reward,
  available,
  first,
  onDone,
  onError,
}: {
  chain: ChainInfo
  prepare: Prepare
  validator: Validator
  staked?: string
  reward?: string
  available?: string
  first: boolean
  onDone: (msg: string) => void
  onError: (msg: string) => void
}) {
  const { t } = useT()
  const { active, getSigner } = useWallet()
  const [action, setAction] = useState<'none' | 'delegate' | 'undelegate'>('none')
  // Shown when a validator this app does not offer is tapped anyway.
  const [blockedInfo, setBlockedInfo] = useState(false)
  const free = isFree(chain, validator.operator)
  // Whether this app offers delegation here at all. Undelegating stays
  // available regardless: someone who staked before a restriction was
  // introduced must always be able to get their tokens back out.
  const allowed = isValidatorAllowed(chain, validator.operator)
  const up = isUp(validator)
  const power = Number(validator.tokens) / 10 ** chain.decimals

  const baseRows = (): ReviewRow[] => [
    { label: t('review.network'), value: `${chain.chainName} (${chain.chainId})` },
    { label: t('review.from'), value: `${active!.name} · ${active!.address}`, mono: true },
    { label: t('review.validator'), value: `${validator.moniker} · ${validator.operator}`, mono: true },
  ]

  async function submitDelegate(password: string, amount: string) {
    if (!active) return
    const base = toBaseUnits(amount, chain)
    const signer = await getSigner(active.id, password)
    const { messages, memo } = buildDelegate(chain, active.address, validator.operator, base)
    const hasFee = delegationHasServiceFee(chain, validator.operator)
    await prepare({
      chain,
      signer,
      sender: active.address,
      messages,
      memo,
      confirmLabel: t('review.confirmDelegate'),
      onDone: (hash) => {
        setAction('none')
        onDone(t('staking.delegatedTo', { name: validator.moniker, hash: hash.slice(0, 12) }))
      },
      onError,
      buildRows: (est) => {
        const serviceFee = hasFee ? chain.serviceFee : '0'
        const total = addBase(addBase(base, est.amount), serviceFee)
        const rows = baseRows()
        rows.push({ label: t('review.amount'), value: `${formatAmount(base, chain)} ${chain.displayDenom}` })
        if (hasFee) {
          rows.push({ label: t('review.serviceFee'), value: `${formatAmount(serviceFee, chain)} ${chain.displayDenom}` })
        }
        rows.push({ label: t('review.fee'), value: `${formatAmount(est.amount, chain)} ${chain.displayDenom}` })
        rows.push({ label: t('review.total'), value: `${formatAmount(total, chain)} ${chain.displayDenom}`, strong: true })
        rows.push({ label: t('review.action'), value: t('review.actionDelegate') })
        return rows
      },
    })
  }

  async function submitUndelegate(password: string, amount: string) {
    if (!active) return
    const base = toBaseUnits(amount, chain)
    const signer = await getSigner(active.id, password)
    const { messages, memo } = buildUndelegate(chain, active.address, validator.operator, base)
    await prepare({
      chain,
      signer,
      sender: active.address,
      messages,
      memo,
      confirmLabel: t('review.confirmUndelegate'),
      warning: t('review.warnUnbond'),
      onDone: (hash) => {
        setAction('none')
        onDone(t('staking.undelegationStarted', { name: validator.moniker, hash: hash.slice(0, 12) }))
      },
      onError,
      buildRows: (est) => {
        const rows = baseRows()
        rows.push({ label: t('review.unbondAmount'), value: `${formatAmount(base, chain)} ${chain.displayDenom}` })
        rows.push({ label: t('review.fee'), value: `${formatAmount(est.amount, chain)} ${chain.displayDenom}` })
        rows.push({ label: t('review.action'), value: t('review.actionUndelegate') })
        return rows
      },
    })
  }

  return (
    <div className={`${first ? '' : 'border-t border-slate-100'} ${free ? 'bg-amber-50/50' : ''}`}>
      <div className="flex items-center gap-3 px-3 py-2">
        <div className="relative shrink-0">
          <ValidatorAvatar identity={validator.identity} moniker={validator.moniker} />
          <span
            title={up ? t('staking.statusActive') : validator.jailed ? t('staking.statusJailed') : t('staking.statusInactive')}
            className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ${
              up ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <span className="truncate">{validator.moniker}</span>
            {/* A star and a shield read as "vetted" or "secure". We have made
                no security assessment of any validator - the only thing this
                marks is our own fee waiver, so it says exactly that in words
                and carries no trust iconography. */}
            {free && (
              <span className="flex shrink-0 items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                {t('staking.noBeehiveFee')}
                {/* Was a title attribute, which never appears on touch. The
                    caveat - that this is our fee waiver and not a security
                    review - is the whole point of the badge, so it has to be
                    reachable on a phone too. */}
                <HelpTip text={t('staking.noFeeExplain')} />
              </span>
            )}
            {validator.jailed && (
              <span className="shrink-0 rounded bg-red-100 px-1.5 text-[11px] font-medium text-red-700">
                {t('staking.statusJailed')}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
            <span title={t('help.validatorCommission')}>
              {t('staking.comm', { pct: (validator.commission * 100).toFixed(0) })}
            </span>
            <span>·</span>
            <span title={t('help.votingPower')}>{abbrev(power)} {chain.displayDenom}</span>
            {chain.explorerValidatorUrl && (
              <>
                <span>·</span>
                <a
                  href={`${chain.explorerValidatorUrl}${validator.operator}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-0.5 text-amber-700 hover:underline"
                >
                  {validator.operator.slice(0, 12)}… <ExternalLink className="h-3 w-3" />
                </a>
              </>
            )}
            {staked && (
              <>
                <span>·</span>
                <span className="font-medium text-slate-700">
                  {t('staking.you', { amount: formatAmount(staked, chain) })}
                </span>
                {reward && Number(reward) > 0 && (
                  <span className="text-green-700">+{formatAmount(reward, chain)}</span>
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {/* Not offered here, rather than offered and then refused. The reason
              is stated, because a greyed button with no explanation reads as a
              bug rather than as a deliberate choice by the operator. */}
          {allowed ? (
            <button
              onClick={() => setAction(action === 'delegate' ? 'none' : 'delegate')}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                free
                  ? 'bg-amber-500 text-slate-900 hover:bg-amber-600'
                  : 'text-slate-600 ring-1 ring-slate-200 hover:text-amber-700'
              }`}
            >
              {free ? t('staking.stake') : t('staking.delegate')}
            </button>
          ) : (
            /* Still a button, greyed rather than removed, and it EXPLAINS
               itself when pressed. A disabled control with no explanation is
               indistinguishable from a broken one, and silently hiding the
               action invites "why can I stake here in another wallet?". */
            <button
              onClick={() => setBlockedInfo(true)}
              className="cursor-help rounded-lg px-2.5 py-1.5 text-xs text-slate-400 ring-1 ring-slate-200"
            >
              {free ? t('staking.stake') : t('staking.delegate')}
            </button>
          )}
          {staked && (
            <button
              onClick={() => setAction(action === 'undelegate' ? 'none' : 'undelegate')}
              className="rounded-lg px-2.5 py-1.5 text-xs text-slate-600 ring-1 ring-slate-200 hover:text-amber-700"
            >
              {t('staking.undelegate')}
            </button>
          )}
        </div>
      </div>

      {/* Both forms live in a sheet anchored to the bottom of the screen rather
          than expanding inline. Inline, opening a form under one row pushed
          every row below it, and on a phone it could open below the fold - so
          tapping "Delegate" looked like nothing happened. */}
      {action === 'delegate' && (
        <BottomSheet
          title={t('staking.delegateTo', { name: validator.moniker })}
          subtitle={validator.operator}
          onClose={() => setAction('none')}
        >
          {!free && serviceFeeActive(chain) && (
            <p className="mb-2 flex items-center gap-1 text-xs text-slate-500">
              {t('staking.serviceFee', { fee: formatAmount(chain.serviceFee, chain), denom: chain.displayDenom })}
              <HelpTip text={t('help.serviceFee')} align="start" />
            </p>
          )}
          <ActionForm
            chain={chain}
            label={t('staking.delegateTo', { name: validator.moniker })}
            submitLabel={t('staking.signAndDelegate')}
            withAmount
            maxBase={available ?? '0'}
            reserveBase={addBase(
              feeReserve(chain, 250000),
              !free && serviceFeeActive(chain) ? chain.serviceFee : '0',
            )}
            onSubmit={submitDelegate}
            onError={onError}
          />
        </BottomSheet>
      )}
      {action === 'undelegate' && (
        <BottomSheet
          title={t('staking.undelegateFrom', { name: validator.moniker })}
          subtitle={validator.operator}
          onClose={() => setAction('none')}
        >
          <p className="mb-2 flex items-center gap-1 text-xs text-slate-500">
            {t('staking.unbondNote')}
            <HelpTip text={t('help.unbonding')} align="start" />
          </p>
          <ActionForm
            chain={chain}
            label={t('staking.undelegateFrom', { name: validator.moniker })}
            submitLabel={t('staking.signAndUndelegate')}
            withAmount
            maxBase={staked ?? '0'}
            onSubmit={submitUndelegate}
            onError={onError}
          />
        </BottomSheet>
      )}

      {/* Why this validator is not available, in the user's terms. It is
          deliberately explicit that this is OUR policy and not a restriction on
          their tokens - they can still delegate anywhere from another wallet,
          and anything already staked here is untouched. */}
      {blockedInfo && (
        <BottomSheet
          title={t('staking.notOfferedTitle')}
          subtitle={validator.moniker}
          onClose={() => setBlockedInfo(false)}
        >
          <div className="space-y-3 text-sm text-slate-600">
            <p>{t('staking.notOfferedBody', { chain: chain.chainName })}</p>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
              {t('staking.notOfferedYourStake')}
            </p>
            <button
              onClick={() => setBlockedInfo(false)}
              className="w-full rounded-lg bg-amber-500 py-2 text-sm font-medium text-slate-900 hover:bg-amber-600"
            >
              {t('common.close')}
            </button>
          </div>
        </BottomSheet>
      )}
    </div>
  )
}

function ActionForm({
  chain,
  label,
  submitLabel,
  withAmount = false,
  maxBase,
  reserveBase,
  onSubmit,
  onError,
}: {
  chain: ChainInfo
  label: string
  submitLabel: string
  withAmount?: boolean
  maxBase?: string
  reserveBase?: string
  onSubmit: (password: string, amount: string) => Promise<void>
  onError: (msg: string) => void
}) {
  const { t } = useT()
  const [amount, setAmount] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLocalError('')
    setBusy(true)
    onError('')
    try {
      // onSubmit derives the signer and opens the review. Once it returns, the
      // plaintext password has served its purpose, so clear it rather than
      // holding it through review/broadcast. Cancelling the review therefore
      // requires deliberately re-entering it.
      await onSubmit(password, amount)
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('staking.errTx')
      // Shown inside the form as well as reported upward: this form renders in
      // BottomSheets, and the page-level error banner is behind their overlay.
      setLocalError(msg)
      onError(msg)
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
    <form onSubmit={submit} className="space-y-2 rounded-xl bg-slate-50 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      {withAmount && (
        <>
          <div className="flex items-center gap-2">
            <input
              name="beehive-stake-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value.trim())}
              placeholder={t('send.amount')}
              aria-label={t('send.amountLabel', { denom: chain.displayDenom })}
              required
              inputMode="decimal"
              autoComplete="off"
              className="flex-1 rounded-xl bg-white px-3.5 py-2.5 text-sm tabular-nums ring-1 ring-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <span className="text-sm text-slate-500">{chain.displayDenom}</span>
          </div>
          {maxBase && (
            <PercentButtons
              maxBase={maxBase}
              reserveBase={reserveBase}
              chain={chain}
              onPick={setAmount}
            />
          )}
        </>
      )}
      <label
        className="flex items-center gap-1 text-xs font-medium text-slate-600"
        htmlFor="beehive-stake-password"
      >
        {t('send.signPassword')}
        <HelpTip text={t('help.walletPassword')} align="start" />
      </label>
      <input
        id="beehive-stake-password"
        type="password"
        name="beehive-stake-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        autoComplete="new-password"
        className="w-full rounded-xl bg-white px-3.5 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500"
      />
      <button
        disabled={busy}
        className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-medium text-slate-900 hover:bg-amber-600 disabled:opacity-50"
      >
        {busy ? t('rewards.signing') : submitLabel}
      </button>
      {localError && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {localError}
        </div>
      )}
    </form>
  )
}
