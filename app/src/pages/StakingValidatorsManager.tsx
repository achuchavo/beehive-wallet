import { useCallback, useEffect, useState } from 'react'
import { Landmark, TriangleAlert, Search, Trash2 } from 'lucide-react'
import { api, PERM_WRITE, type AdminStakingChain, type PermLevel } from '../api'
import { findChain, type StakingPolicy } from '../chains'
import { toBaseUnits, fromBaseUnits, formatBase, compareBase } from '../wallet/amount'
import { useT } from '../i18n/I18nContext'
import HelpTip from '../components/HelpTip'
import OptionPicker from '../components/OptionPicker'
import ConfirmDelete from '../components/ConfirmDelete'

const POLICY_KEY: Record<StakingPolicy, string> = {
  all: 'admin.policyAll',
  allowlist: 'admin.policyAllowlist',
  allowlist_paid: 'admin.policyAllowlistPaid',
}

interface ChainValidator {
  operator: string
  moniker: string
  jailed: boolean
  active: boolean
  /**
   * Total stake in base units, as a string.
   *
   * Medibloc's largest validator is about 7e14 umed, which a float still holds
   * exactly - but an 18-decimal chain reaches 1e26 for the same real value, and
   * sorting on Number() there silently ties validators that differ by millions.
   * Compared with compareBase for that reason.
   */
  tokens: string
}

/** Filter over the validator set. */
type VFilter = 'all' | 'active' | 'jailed'

/**
 * Status dot.
 *
 * Three states, not two, because "not green" covers two very different
 * situations: a jailed validator (punished, earning nothing) and one that is
 * simply outside the active set (fine, just not currently producing blocks).
 *
 * Colour is never the only signal - each dot carries a title and sits beside a
 * text badge - so this survives greyscale and colour blindness.
 */
function StatusDot({ v }: { v: ChainValidator }) {
  const { t } = useT()
  const [cls, label] = v.jailed
    ? ['bg-red-500', t('admin.validatorJailed')]
    : v.active
      ? ['bg-green-500', t('admin.validatorActive')]
      : ['bg-slate-300', t('staking.statusInactive')]
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${cls}`}
      title={label}
      role="img"
      aria-label={label}
    />
  )
}

/**
 * Which validators this app offers for staking, per chain, and what delegating
 * outside that list costs.
 *
 * The list is chosen by TICKING validators fetched from the chain, not by
 * pasting operator addresses: a valoper is 50-odd characters of base32, and a
 * mistyped one silently makes the wrong validator free (or none at all).
 * Pasting is still available for a validator the node has not returned.
 */
export default function StakingValidatorsManager({
  level,
  onError,
}: {
  level: PermLevel
  onError: (msg: string) => void
}) {
  const { t } = useT()
  const [chains, setChains] = useState<AdminStakingChain[] | null>(null)
  const [selected, setSelected] = useState('')
  const [validators, setValidators] = useState<ChainValidator[] | null>(null)
  const [vError, setVError] = useState('')
  const [search, setSearch] = useState('')
  const [vFilter, setVFilter] = useState<VFilter>('all')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [removing, setRemoving] = useState<{ id: number; moniker: string } | null>(null)

  const canWrite = level >= PERM_WRITE

  const load = useCallback(() => {
    api
      .adminStaking()
      .then((r) => {
        setChains(r.chains)
        setSelected((cur) => cur || r.chains[0]?.chain_key || '')
      })
      .catch((e) => onError(e instanceof Error ? e.message : 'Failed'))
  }, [onError])

  useEffect(() => {
    load()
  }, [load])

  const chain = chains?.find((c) => c.chain_key === selected) ?? null

  // Draft policy/fee, editable before saving.
  const [policy, setPolicy] = useState<StakingPolicy>('all')
  const [feeDisplay, setFeeDisplay] = useState('0')
  const [collector, setCollector] = useState('')

  useEffect(() => {
    if (!chain) return
    setPolicy(chain.staking_policy)
    setFeeDisplay(fromBaseUnits(chain.service_fee, chain.decimals))
    setCollector(chain.fee_collector)
    setSaved(false)
  }, [chain?.chain_key, chain])

  // The chain's own validator set, so the admin picks from reality rather than
  // from memory. Read through the LCD proxy, the same path the staking page
  // uses, so a chain with no working endpoint fails visibly here too.
  useEffect(() => {
    const info = selected ? findChain(selected) : undefined
    if (!info) {
      setValidators(null)
      return
    }
    let cancelled = false
    setValidators(null)
    setVError('')
    fetch(`${info.lcd}/cosmos/staking/v1beta1/validators?pagination.limit=500`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        const list = (d.validators ?? []) as {
          operator_address: string
          description?: { moniker?: string }
          jailed?: boolean
          status?: string
          tokens?: string
        }[]
        setValidators(
          list.map((v) => ({
            operator: v.operator_address,
            moniker: v.description?.moniker || v.operator_address,
            jailed: v.jailed === true,
            active: v.status === 'BOND_STATUS_BONDED',
            // Kept as a string and compared with compareBase: a chain's total
            // stake passes Number.MAX_SAFE_INTEGER easily, so sorting on
            // Number(tokens) would put validators in the wrong order.
            tokens: /^\d+$/.test(String(v.tokens)) ? String(v.tokens) : '0',
          })),
        )
      })
      .catch(() => {
        if (!cancelled) setVError(t('admin.validatorsLoadFailed'))
      })
    return () => {
      cancelled = true
    }
  }, [selected, t])

  const allowed = chain?.allowed_validators ?? []
  const allowedSet = new Set(allowed.map((a) => a.valoper))

  let feeBase: string | null = null
  const feeTrimmed = feeDisplay.trim()
  if (feeTrimmed === '' || /^0(\.0*)?$/.test(feeTrimmed)) {
    feeBase = '0'
  } else if (chain) {
    try {
      feeBase = toBaseUnits(feeTrimmed, chain.decimals)
    } catch {
      feeBase = null
    }
  }

  async function savePolicy() {
    if (!chain || feeBase === null) return
    setBusy(true)
    onError('')
    try {
      await api.adminStakingSave({
        chain_key: chain.chain_key,
        staking_policy: policy,
        service_fee: feeBase,
        fee_collector: collector.trim(),
      })
      setSaved(true)
      load()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  async function toggleValidator(v: ChainValidator) {
    if (!chain) return
    onError('')
    try {
      const existing = allowed.find((a) => a.valoper === v.operator)
      if (existing) {
        await api.adminFreeValidatorRemove(existing.id)
      } else {
        await api.adminFreeValidatorAdd(chain.chain_key, v.operator)
      }
      load()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed')
    }
  }

  async function confirmRemove() {
    if (!removing) return
    setBusy(true)
    try {
      await api.adminFreeValidatorRemove(removing.id)
      setRemoving(null)
      load()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  if (!chains) return <p className="text-sm text-slate-500">{t('common.loading')}</p>

  const needle = search.trim().toLowerCase()

  /**
   * Chosen validators first, then by stake, largest first.
   *
   * The chosen ones float to the top because this screen exists to manage that
   * selection - having to hunt for what you already picked among two hundred
   * others is the thing that made the list feel random. Within each group the
   * order is by stake, which is the ranking every explorer uses and the one an
   * operator is thinking in.
   *
   * A jailed validator is pushed below an unjailed one at the same stake: it is
   * the least likely thing to want to select.
   */
  const visible = (validators ?? [])
    .filter((v) => {
      if (vFilter === 'active' && (!v.active || v.jailed)) return false
      if (vFilter === 'jailed' && !v.jailed) return false
      if (needle === '') return true
      return v.moniker.toLowerCase().includes(needle) || v.operator.includes(search.trim())
    })
    .sort((a, b) => {
      const aOn = allowedSet.has(a.operator)
      const bOn = allowedSet.has(b.operator)
      if (aOn !== bOn) return aOn ? -1 : 1
      if (a.jailed !== b.jailed) return a.jailed ? 1 : -1
      // Exact, string-based: these values exceed what a float can hold.
      return compareBase(b.tokens, a.tokens)
    })

  const counts = {
    all: (validators ?? []).length,
    active: (validators ?? []).filter((v) => v.active && !v.jailed).length,
    jailed: (validators ?? []).filter((v) => v.jailed).length,
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 font-medium">
          <Landmark className="h-4 w-4 text-amber-600" /> {t('admin.stakingTitle')}
          <HelpTip text={t('help.adminStakingScope')} />
        </h2>
        <p className="text-sm text-slate-500">{t('admin.stakingIntro')}</p>
      </div>

      {!canWrite && (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {t('admin.readOnlyNote')}
        </p>
      )}

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">
          {t('dash.chainFilter')}
        </span>
        <OptionPicker
          full
          label={t('dash.chainFilter')}
          value={selected}
          onChange={setSelected}
          options={chains.map((c) => ({
            value: c.chain_key,
            label: c.chain_name,
            hint: t(POLICY_KEY[c.staking_policy]),
          }))}
        />
      </label>

      {chain && (
        <>
          {/* Policy first: it decides whether the list below is "these are
              free" or "these and nothing else". */}
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
              {t('admin.stakingPolicy')}
              <HelpTip text={t('help.adminStakingPolicy')} align="start" />
            </div>
            <OptionPicker
              full
              layout="list"
              label={t('admin.stakingPolicy')}
              value={policy}
              onChange={(v) => {
                setPolicy(v as StakingPolicy)
                setSaved(false)
              }}
              options={(['all', 'allowlist', 'allowlist_paid'] as StakingPolicy[]).map((p) => ({
                value: p,
                label: t(POLICY_KEY[p]),
                hint: t(`${POLICY_KEY[p]}Hint`),
              }))}
            />

            {policy === 'allowlist_paid' && (
              <div className="space-y-3 rounded-lg bg-slate-50 p-3">
                <label className="block">
                  <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    {t('admin.stakingFee')}
                    <HelpTip text={t('help.adminStakingFee')} align="start" />
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      value={feeDisplay}
                      onChange={(e) => {
                        setFeeDisplay(e.target.value.trim())
                        setSaved(false)
                      }}
                      inputMode="decimal"
                      aria-invalid={feeBase === null}
                      className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums focus:border-amber-500 focus:outline-none"
                    />
                    <span className="text-sm text-slate-500">{chain.display_denom}</span>
                  </div>
                  <span className="mt-1 block text-xs text-slate-500">
                    {feeBase === null
                      ? t('admin.pricingFeeInvalid')
                      : t('admin.pricingFeeBase', { base: feeBase, denom: chain.denom })}
                  </span>
                </label>

                <label className="block">
                  <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    {t('admin.stakingCollector')}
                    <HelpTip text={t('help.adminStakingCollector')} align="start" />
                  </span>
                  <input
                    value={collector}
                    onChange={(e) => {
                      setCollector(e.target.value.trim())
                      setSaved(false)
                    }}
                    placeholder={`${chain.bech32_prefix}1...`}
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs focus:border-amber-500 focus:outline-none"
                  />
                </label>

                {/* The staking fee rides inside the delegation transaction, so
                    unlike the alert fee there is no server-side verification of
                    it. Saying so here is the honest thing to do on the screen
                    that sets it. */}
                <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {t('admin.stakingFeeInBand')}
                </p>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={savePolicy}
                disabled={!canWrite || busy || feeBase === null}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-amber-600 disabled:opacity-50"
              >
                {busy ? t('alarms.working') : t('common.save')}
              </button>
              {saved && <span className="text-xs font-medium text-green-700">{t('admin.pricingSaved')}</span>}
            </div>
          </section>

          {/* The list. Always shown, including under 'all', so an admin can set
              it up before switching the policy on. */}
          <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                {t('admin.allowedValidators')}
                <HelpTip text={t('help.adminAllowedValidators')} align="start" />
                <HelpTip text={t('help.adminStatusDot')} align="start" />
                <span className="normal-case tabular-nums text-slate-400">
                  {t('admin.allowedCount', { count: allowed.length })}
                </span>
              </span>
              <div className="flex items-center gap-2">
                {/* Counts live on the filter itself, so "why is this list
                    short?" is answered before it is asked. */}
                <div className="flex rounded-lg border border-slate-300 p-0.5 text-xs">
                  {(['all', 'active', 'jailed'] as VFilter[]).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setVFilter(f)}
                      aria-pressed={vFilter === f}
                      className={`rounded px-2 py-1 ${
                        vFilter === f
                          ? 'bg-amber-500 font-medium text-slate-900'
                          : 'text-slate-600 hover:text-amber-700'
                      }`}
                    >
                      {t(`admin.filter${f[0].toUpperCase()}${f.slice(1)}`)} ({counts[f]})
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('admin.validatorSearch')}
                    aria-label={t('admin.validatorSearch')}
                    className="w-40 rounded-lg border border-slate-300 py-1.5 pl-8 pr-2 text-xs focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
            <p className="text-xs text-slate-400">{t('admin.validatorOrderNote')}</p>

            {policy === 'all' && (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {t('admin.listIgnoredUnderAll')}
              </p>
            )}

            {vError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{vError}</p>
            )}

            {/* Anything on the list that the node did not return - a validator
                that has since left the set, or one added by hand. Shown so it
                can be removed; it would otherwise be invisible and permanent. */}
            {allowed
              .filter((a) => !(validators ?? []).some((v) => v.operator === a.valoper))
              .map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs"
                >
                  <span className="min-w-0 truncate font-mono text-amber-900">{a.valoper}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-amber-800">{t('admin.validatorNotOnChain')}</span>
                    <button
                      onClick={() => setRemoving({ id: a.id, moniker: a.valoper })}
                      disabled={!canWrite}
                      aria-label={t('common.remove')}
                      className="rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </div>
              ))}

            {!validators && !vError ? (
              <p className="text-sm text-slate-500">{t('common.loading')}</p>
            ) : visible.length === 0 ? (
              <p className="text-sm text-slate-500">{t('admin.noValidators')}</p>
            ) : (
              <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                {visible.map((v) => {
                  const on = allowedSet.has(v.operator)
                  const isBeehive = v.operator === chain.beehive_validator
                  return (
                    <li key={v.operator} className="flex items-center justify-between gap-2 px-3 py-2">
                      <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={!canWrite}
                          onChange={() => toggleValidator(v)}
                        />
                        <StatusDot v={v} />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate">{v.moniker}</span>
                            {isBeehive && (
                              <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] text-amber-800">
                                {t('admin.ourValidator')}
                              </span>
                            )}
                            {v.jailed && (
                              <span className="shrink-0 rounded bg-red-100 px-1 text-[10px] text-red-700">
                                {t('admin.validatorJailed')}
                              </span>
                            )}
                            {!v.active && !v.jailed && (
                              <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] text-slate-600">
                                {t('staking.statusInactive')}
                              </span>
                            )}
                          </span>
                          <span className="block truncate font-mono text-[11px] text-slate-400">
                            {v.operator}
                          </span>
                        </span>
                      </label>
                      {/* The number the ordering is by, so the sort is legible
                          rather than something you have to take on trust. */}
                      <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-slate-500">
                        {formatBase(v.tokens, chain.decimals)} {chain.display_denom}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}

      {removing && (
        <ConfirmDelete
          title={t('admin.removeValidatorTitle')}
          name={removing.moniker}
          impact={t('admin.removeValidatorImpact')}
          busy={busy}
          onConfirm={confirmRemove}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  )
}
