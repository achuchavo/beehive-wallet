import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ShieldCheck,
  Clock,
  TriangleAlert,
  CircleCheck,
  BellOff,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ListFilter,
  Plus,
  Trash2,
} from 'lucide-react'
import { api, type UptimeSubscription, type UptimeAlert } from '../api'
import { DEFAULT_CHAIN, CHAINS, type ChainInfo } from '../chains'
import { useAuth } from '../auth/AuthContext'
import Checkbox from '../components/Checkbox'
import Collapsible from '../components/Collapsible'
import HelpTip from '../components/HelpTip'
import Modal from '../components/Modal'
import OptionPicker from '../components/OptionPicker'
import PageHeader from '../components/PageHeader'
import ConfirmDelete from '../components/ConfirmDelete'
import { useT } from '../i18n/I18nContext'

const POLL_MS = 30000
const FREQ_OPTIONS = [60, 360, 720, 1440]
const ALERTS_PER_PAGE = 10

interface Val {
  operator: string
  moniker: string
}

async function fetchValidators(chain: ChainInfo): Promise<Val[]> {
  const res = await fetch(
    `${chain.lcd}/cosmos/staking/v1beta1/validators?pagination.limit=500&status=BOND_STATUS_BONDED`,
  )
  if (!res.ok) return []
  const data = await res.json()
  return (data.validators ?? [])
    .map((v: { operator_address: string; description?: { moniker?: string } }) => ({
      operator: v.operator_address,
      moniker: v.description?.moniker ?? v.operator_address,
    }))
    .sort((a: Val, b: Val) => a.moniker.localeCompare(b.moniker))
}

export default function UptimeAlerts() {
  const auth = useAuth()
  const { t } = useT()

  if (auth.status === 'loading') {
    return <p className="text-sm text-slate-500">{t('common.loading')}</p>
  }
  if (auth.status === 'out') {
    return (
      <div className="space-y-4">
        <PageHeader title={t('uptime.title')} />
        <p className="text-sm text-slate-500">{t('uptime.notLoggedIn')}</p>
        <a href={`${import.meta.env.BASE_URL}alarms`} className="text-sm text-amber-700 hover:underline">
          {t('account.signIn')}
        </a>
      </div>
    )
  }
  return <UptimePanel />
}

function UptimePanel() {
  const { t } = useT()
  const [enabled, setEnabled] = useState(true)
  const [subs, setSubs] = useState<UptimeSubscription[]>([])
  const [alerts, setAlerts] = useState<UptimeAlert[]>([])
  const [unread, setUnread] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // The application form lives in a modal behind one button - the page's job
  // is showing status, not hosting a form.
  const [applyOpen, setApplyOpen] = useState(false)
  // Alerts: paginated, and filterable to a chosen set of subscriptions.
  const [page, setPage] = useState(0)
  const [filterIds, setFilterIds] = useState<Set<number>>(new Set())
  const [filterOpen, setFilterOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const r = await api.uptimeStatus()
      setEnabled(r.enabled)
      setSubs(r.subscriptions)
      setAlerts(r.alerts)
      setUnread(r.unread)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, POLL_MS)
    return () => clearInterval(id)
  }, [refresh])

  function shortMoniker(s: UptimeSubscription) {
    return s.moniker || `${s.validator_address.slice(0, 16)}...`
  }

  // Empty set = no filter = everything.
  const visibleAlerts = useMemo(
    () => alerts.filter((a) => filterIds.size === 0 || filterIds.has(a.subscription_id)),
    [alerts, filterIds],
  )
  const pageCount = Math.max(1, Math.ceil(visibleAlerts.length / ALERTS_PER_PAGE))
  const safePage = Math.min(page, pageCount - 1)
  const pageAlerts = visibleAlerts.slice(
    safePage * ALERTS_PER_PAGE,
    safePage * ALERTS_PER_PAGE + ALERTS_PER_PAGE,
  )

  if (!enabled) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('uptime.title')} />
        <div className="flex items-center gap-2 rounded-2xl bg-white px-4 py-6 text-sm text-slate-500 ring-1 ring-slate-200/70">
          <BellOff className="h-4 w-4 shrink-0" /> {t('uptime.disabled')}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* The title owns its row - a button beside it squeezed it into
          wrapping. The intro sits behind the "?" instead of a subtitle, and
          the one primary action gets the line below. */}
      <PageHeader title={t('uptime.title')} help={t('uptime.intro')} />
      <div>
        <button
          onClick={() => setApplyOpen(true)}
          className="flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-amber-500 px-3.5 py-2 text-sm font-medium text-slate-900 hover:bg-amber-600"
        >
          <Plus className="h-4 w-4" strokeWidth={1.8} /> {t('uptime.applyTitle')}
        </button>
      </div>

      {notice && <div className="rounded-xl bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</div>}
      {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {applyOpen && (
        <ApplyModal
          onClose={() => setApplyOpen(false)}
          onApplied={() => {
            setApplyOpen(false)
            setNotice(t('uptime.applied'))
            refresh()
          }}
        />
      )}

      {/* Subscriptions: one line each - the question this list answers is
          "what is my validator's current status", nothing more. Everything
          operable lives behind Manage. */}
      <section className="space-y-2">
        <h2 className="px-1 text-xs font-medium uppercase tracking-wide text-slate-500">
          {t('uptime.yourValidators')}
        </h2>
        {subs.length === 0 ? (
          <p className="text-sm text-slate-500">{t('uptime.none')}</p>
        ) : (
          <div className="space-y-2">
            {subs.map((s) => (
              <SubRow key={s.id} sub={s} name={shortMoniker(s)} onChange={refresh} />
            ))}
          </div>
        )}
      </section>

      {/* Alerts: ten per page, filterable to chosen validators. */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="px-1 text-xs font-medium uppercase tracking-wide text-slate-500">
            {t('uptime.alertsTitle')}
          </h2>
          <div className="flex items-center gap-3">
            {unread > 0 && (
              <button
                onClick={() => api.uptimeMarkRead().then(refresh)}
                className="text-sm text-amber-700 hover:underline"
              >
                {t('alarms.markRead')}
              </button>
            )}
            {subs.length > 1 && (
              <button
                onClick={() => setFilterOpen(true)}
                aria-haspopup="dialog"
                className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-sm ring-1 ${
                  filterIds.size > 0
                    ? 'bg-amber-50 font-medium text-amber-800 ring-amber-300'
                    : 'bg-white text-slate-600 ring-slate-200 hover:text-amber-700'
                }`}
              >
                <ListFilter className="h-4 w-4" strokeWidth={1.8} />
                {t('uptime.filter')}
                {filterIds.size > 0 && <span className="tabular-nums">({filterIds.size})</span>}
              </button>
            )}
          </div>
        </div>

        {filterOpen && (
          <FilterModal
            subs={subs}
            selected={filterIds}
            nameOf={shortMoniker}
            onApply={(ids) => {
              setFilterIds(ids)
              setPage(0)
              setFilterOpen(false)
            }}
            onClose={() => setFilterOpen(false)}
          />
        )}

        {visibleAlerts.length === 0 ? (
          <p className="text-sm text-slate-500">
            {alerts.length === 0 ? t('uptime.noAlerts') : t('uptime.noAlertsFiltered')}
          </p>
        ) : (
          <>
            <ul className="divide-y divide-slate-100 rounded-2xl bg-white ring-1 ring-slate-200/70">
              {pageAlerts.map((a) => {
                const name = a.moniker || `${a.validator_address.slice(0, 16)}...`
                const down = a.kind === 'down'
                return (
                  <li key={a.id} className={`px-4 py-3 ${a.is_read ? '' : 'bg-amber-50'}`}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5 font-medium">
                        {down ? (
                          <TriangleAlert className="h-4 w-4 text-red-500" />
                        ) : (
                          <CircleCheck className="h-4 w-4 text-green-700" />
                        )}
                        {down
                          ? t('uptime.alertDown', { moniker: name, n: a.missed_blocks })
                          : t('uptime.alertRecovered', { moniker: name })}
                      </span>
                      <span className="text-xs text-slate-500">{a.detected_at}</span>
                    </div>
                  </li>
                )
              })}
            </ul>
            {pageCount > 1 && (
              <div className="flex items-center justify-between text-sm">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-slate-600 ring-1 ring-slate-200 hover:text-amber-700 disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" /> {t('common.prev')}
                </button>
                <span className="text-xs text-slate-500">
                  {t('rewards.page', { page: safePage + 1, total: pageCount })}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  disabled={safePage >= pageCount - 1}
                  className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-slate-600 ring-1 ring-slate-200 hover:text-amber-700 disabled:opacity-40"
                >
                  {t('common.next')} <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}

/** The application form, in a dialog: chain, validator, submit. */
function ApplyModal({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const { t } = useT()
  const [chainKey, setChainKey] = useState(DEFAULT_CHAIN.key)
  const chain = CHAINS.find((c) => c.key === chainKey) ?? DEFAULT_CHAIN
  const [validators, setValidators] = useState<Val[]>([])
  const [validator, setValidator] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Re-fetch whenever the chosen network changes: a validator list is
  // chain-specific and offering Medibloc validators for a Chihuahua
  // subscription would register an operator that does not exist there.
  useEffect(() => {
    setValidators([])
    setValidator('')
    fetchValidators(chain).then(setValidators).catch(() => {})
  }, [chain])

  // Client-side HRP check; uptime_apply.php re-validates server-side.
  const validatorMatchesChain =
    validator.trim() === '' || validator.trim().startsWith(chain.bech32Prefix + 'valoper1')

  async function apply(e: React.FormEvent) {
    e.preventDefault()
    if (!validatorMatchesChain) {
      setError(t('uptime.errWrongNetwork', { chain: chain.chainName }))
      return
    }
    setBusy(true)
    setError('')
    try {
      const moniker = validators.find((v) => v.operator === validator)?.moniker ?? ''
      await api.uptimeApply(chain.key, validator.trim(), moniker)
      onApplied()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('uptime.applyError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={t('uptime.applyTitle')} onClose={onClose}>
      <form onSubmit={apply} className="space-y-3">
        {/* Network first: the validator list, the stored subscription and the
            explorer link are all chain-specific. */}
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            {t('dash.chainFilter')}
          </span>
          <OptionPicker
            full
            label={t('dash.chainFilter')}
            value={chainKey}
            onChange={setChainKey}
            options={CHAINS.map((c) => ({ value: c.key, label: c.chainName, hint: c.chainId }))}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            {t('uptime.chooseFromList')}
          </span>
          <OptionPicker
            full
            label={t('uptime.selectValidator')}
            value={validators.some((v) => v.operator === validator) ? validator : ''}
            onChange={setValidator}
            className="py-2"
            layout="list"
            options={[
              { value: '', label: t('uptime.selectValidator') },
              ...validators.map((v) => ({
                value: v.operator,
                label: v.moniker,
                hint: `${v.operator.slice(0, 20)}...${v.operator.slice(-6)}`,
              })),
            ]}
          />
        </label>

        {/* Folded away: nearly everyone picks from the list above. */}
        <Collapsible title={t('uptime.orEnterManually')}>
          <input
            value={validator}
            onChange={(e) => setValidator(e.target.value.trim())}
            placeholder={`${chain.bech32Prefix}valoper1...`}
            aria-label={t('uptime.orEnterManually')}
            aria-invalid={validatorMatchesChain ? undefined : true}
            className="w-full rounded-xl bg-white px-3.5 py-2.5 font-mono text-sm ring-1 ring-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </Collapsible>
        {!validatorMatchesChain && (
          <p className="text-xs text-red-600">
            {t('uptime.errWrongNetwork', { chain: chain.chainName })}
          </p>
        )}
        {error && (
          <div role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <button
          disabled={busy || !validator || !validatorMatchesChain}
          className="w-full rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-medium text-slate-900 hover:bg-amber-600 disabled:opacity-50"
        >
          {t('uptime.apply')}
        </button>
      </form>
    </Modal>
  )
}

/**
 * One subscription, one line: name, status, current health. The health figure
 * is recent_missed - misses within the watcher's current ~10-minute window -
 * never the chain's lifetime counter, which stays high for hours after an
 * outage the validator has already recovered from.
 */
function SubRow({
  sub,
  name,
  onChange,
}: {
  sub: UptimeSubscription
  name: string
  onChange: () => void
}) {
  const { t } = useT()
  const [managing, setManaging] = useState(false)
  const down = sub.last_down_state === 1

  const statusBadge = {
    pending: { text: t('uptime.statusPending'), cls: 'bg-slate-100 text-slate-600' },
    approved: { text: t('uptime.statusApproved'), cls: 'bg-green-100 text-green-700' },
    denied: { text: t('uptime.statusDenied'), cls: 'bg-red-100 text-red-700' },
  }[sub.status]

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200/70">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
          <span className="truncate">{name}</span>
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-normal ${statusBadge.cls}`}>
            {statusBadge.text}
          </span>
        </div>
        {sub.status === 'approved' && (
          <span
            className={`mt-0.5 flex items-center gap-1 text-xs font-medium ${
              down ? 'text-red-600' : 'text-green-700'
            }`}
          >
            {down ? (
              <TriangleAlert className="h-3.5 w-3.5" />
            ) : (
              <CircleCheck className="h-3.5 w-3.5" />
            )}
            {down ? t('uptime.down') : t('uptime.ok')}
            <span className="font-normal text-slate-500">
              ({t('uptime.missedNow', { n: sub.recent_missed ?? 0 })})
            </span>
          </span>
        )}
      </div>
      <button
        onClick={() => setManaging(true)}
        aria-haspopup="dialog"
        className="shrink-0 rounded-xl px-3 py-1.5 text-sm text-slate-600 ring-1 ring-slate-200 hover:text-amber-700"
      >
        {t('uptime.manage')}
      </button>
      {managing && (
        <ManageModal sub={sub} name={name} onChange={onChange} onClose={() => setManaging(false)} />
      )}
    </div>
  )
}

/** Everything that is not "what is the status": address, expiry, frequency,
 *  snooze and removal. */
function ManageModal({
  sub,
  name,
  onChange,
  onClose,
}: {
  sub: UptimeSubscription
  name: string
  onChange: () => void
  onClose: () => void
}) {
  const { t } = useT()
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)
  // The subscription's own chain, never a global default - the explorer link
  // must point at the network the validator actually lives on.
  const chain = CHAINS.find((c) => c.key === sub.chain_key) ?? DEFAULT_CHAIN
  const snoozed =
    sub.snooze_until !== null && new Date(sub.snooze_until.replace(' ', 'T')) > new Date()

  return (
    <Modal title={name} onClose={onClose}>
      <div className="space-y-4">
        <div className="space-y-1 text-xs text-slate-500">
          <a
            href={`${chain.explorerValidatorUrl}${sub.validator_address}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full items-center gap-1 font-mono hover:text-amber-700"
          >
            <span className="truncate">{sub.validator_address}</span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
          <div>{chain.chainName}</div>
          {sub.status === 'approved' && (
            <span className="flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5" />
              {sub.authorized_until
                ? t('uptime.until', { date: sub.authorized_until.slice(0, 10) })
                : t('uptime.indefinite')}
            </span>
          )}
        </div>

        {sub.status === 'approved' && (
          <>
            <div className="flex items-center justify-between gap-2 text-sm text-slate-600">
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" /> {t('uptime.frequency')}
                <HelpTip text={t('help.uptimeFrequency')} />
              </span>
              <OptionPicker
                label={t('uptime.frequency')}
                value={String(sub.frequency_minutes)}
                onChange={(v) =>
                  api.uptimeUpdate(sub.id, { frequency_minutes: Number(v) }).then(onChange)
                }
                className="py-1.5"
                options={FREQ_OPTIONS.map((f) => ({ value: String(f), label: t(`uptime.freq${f}`) }))}
              />
            </div>

            <div className="flex items-center justify-between gap-2 text-sm text-slate-600">
              <span>
                {snoozed && sub.snooze_until
                  ? t('uptime.snoozedUntil', { date: sub.snooze_until.slice(0, 16) })
                  : t('uptime.snooze')}
              </span>
              {snoozed ? (
                <button
                  onClick={() => api.uptimeUpdate(sub.id, { snooze_minutes: 0 }).then(onChange)}
                  className="rounded-lg px-2.5 py-1.5 text-sm text-slate-600 ring-1 ring-slate-200 hover:text-amber-700"
                >
                  {t('uptime.resume')}
                </button>
              ) : (
                <button
                  onClick={() => api.uptimeUpdate(sub.id, { snooze_minutes: 1440 }).then(onChange)}
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm text-slate-600 ring-1 ring-slate-200 hover:text-amber-700"
                >
                  <BellOff className="h-3.5 w-3.5" /> {t('uptime.snooze')}
                </button>
              )}
            </div>
          </>
        )}

        <button
          onClick={() => setConfirming(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-200 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
        >
          <Trash2 className="h-4 w-4" /> {t('uptime.remove')}
        </button>
      </div>

      {confirming && (
        <ConfirmDelete
          title={t('uptime.removeTitle')}
          name={name}
          impact={t('uptime.removeImpact')}
          busy={removing}
          onConfirm={async () => {
            setRemoving(true)
            try {
              await api.uptimeCancel(sub.id)
              onChange()
              onClose()
            } finally {
              setRemoving(false)
              setConfirming(false)
            }
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </Modal>
  )
}

/** Pick which validators' alerts to show; Apply commits, nothing else does. */
function FilterModal({
  subs,
  selected,
  nameOf,
  onApply,
  onClose,
}: {
  subs: UptimeSubscription[]
  selected: Set<number>
  nameOf: (s: UptimeSubscription) => string
  onApply: (ids: Set<number>) => void
  onClose: () => void
}) {
  const { t } = useT()
  const [draft, setDraft] = useState<Set<number>>(new Set(selected))

  function toggle(id: number, on: boolean) {
    setDraft((d) => {
      const next = new Set(d)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const chainName = (key: string) => CHAINS.find((c) => c.key === key)?.chainName ?? key

  return (
    <Modal title={t('uptime.filterTitle')} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {subs.map((s) => (
            // A div, not a label: Checkbox brings its own <label>, and nesting
            // labels double-fires the toggle.
            <div
              key={s.id}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm ${
                draft.has(s.id)
                  ? 'border-amber-500 bg-amber-50'
                  : 'border-slate-200 bg-white hover:border-amber-300'
              }`}
            >
              <Checkbox
                checked={draft.has(s.id)}
                onChange={(v) => toggle(s.id, v)}
                label={nameOf(s)}
                className="min-w-0 flex-1"
              />
              <span className="ml-auto shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
                {chainName(s.chain_key)}
              </span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onApply(draft)}
            className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-amber-600"
          >
            {t('common.apply')}
          </button>
          <button
            onClick={() => onApply(new Set())}
            className="rounded-xl px-3 py-2 text-sm text-slate-600 hover:text-amber-700"
          >
            {t('uptime.filterAll')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
