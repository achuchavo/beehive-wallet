import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  ShieldCheck,
  Clock,
  TriangleAlert,
  CircleCheck,
  BellOff,
  Trash2,
  ExternalLink,
} from 'lucide-react'
import { api, type UptimeSubscription, type UptimeAlert } from '../api'
import { DEFAULT_CHAIN } from '../chains'
import { useAuth } from '../auth/AuthContext'
import { useT } from '../i18n/I18nContext'

const POLL_MS = 30000
const FREQ_OPTIONS = [60, 360, 720, 1440]

interface Val {
  operator: string
  moniker: string
}

async function fetchValidators(): Promise<Val[]> {
  const chain = DEFAULT_CHAIN
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
      <div className="space-y-3">
        <h1 className="text-xl font-semibold">{t('uptime.title')}</h1>
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
  const chain = DEFAULT_CHAIN
  const [enabled, setEnabled] = useState(true)
  const [subs, setSubs] = useState<UptimeSubscription[]>([])
  const [alerts, setAlerts] = useState<UptimeAlert[]>([])
  const [unread, setUnread] = useState(0)
  const [validators, setValidators] = useState<Val[]>([])
  const [validator, setValidator] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

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
    fetchValidators().then(setValidators).catch(() => {})
    const id = setInterval(refresh, POLL_MS)
    return () => clearInterval(id)
  }, [refresh])

  async function apply(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const moniker = validators.find((v) => v.operator === validator)?.moniker ?? ''
      await api.uptimeApply(chain.key, validator.trim(), moniker)
      setValidator('')
      setNotice(t('uptime.applied'))
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('uptime.applyError'))
    } finally {
      setBusy(false)
    }
  }

  function shortMoniker(s: UptimeSubscription) {
    return s.moniker || `${s.validator_address.slice(0, 16)}...`
  }

  if (!enabled) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold">{t('uptime.title')}</h1>
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
          <BellOff className="h-4 w-4 shrink-0" /> {t('uptime.disabled')}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Activity className="h-5 w-5 text-amber-600" /> {t('uptime.title')}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{t('uptime.intro')}</p>
      </div>

      {notice && <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</div>}
      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {/* Apply */}
      <form onSubmit={apply} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-medium">{t('uptime.applyTitle')}</div>
        <select
          value={validators.some((v) => v.operator === validator) ? validator : ''}
          onChange={(e) => setValidator(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
        >
          <option value="">{t('uptime.selectValidator')}</option>
          {validators.map((v) => (
            <option key={v.operator} value={v.operator}>
              {v.moniker}
            </option>
          ))}
        </select>
        <input
          value={validator}
          onChange={(e) => setValidator(e.target.value.trim())}
          placeholder={t('uptime.validatorPlaceholder')}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-amber-500 focus:outline-none"
        />
        <button
          disabled={busy || !validator}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
        >
          {t('uptime.apply')}
        </button>
      </form>

      {/* Subscriptions */}
      <section className="space-y-2">
        <h2 className="font-medium">{t('uptime.yourValidators')}</h2>
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

      {/* Alerts */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">{t('uptime.alertsTitle')}</h2>
          {unread > 0 && (
            <button
              onClick={() => api.uptimeMarkRead().then(refresh)}
              className="text-sm text-amber-700 hover:underline"
            >
              {t('alarms.markRead')}
            </button>
          )}
        </div>
        {alerts.length === 0 ? (
          <p className="text-sm text-slate-500">{t('uptime.noAlerts')}</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
            {alerts.map((a) => {
              const name = a.moniker || `${a.validator_address.slice(0, 16)}...`
              const down = a.kind === 'down'
              return (
                <li key={a.id} className={`px-4 py-3 ${a.is_read ? '' : 'bg-amber-50'}`}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1.5 font-medium">
                      {down ? (
                        <TriangleAlert className="h-4 w-4 text-red-500" />
                      ) : (
                        <CircleCheck className="h-4 w-4 text-green-600" />
                      )}
                      {down
                        ? t('uptime.alertDown', { moniker: name, n: a.missed_blocks })
                        : t('uptime.alertRecovered', { moniker: name })}
                    </span>
                    <span className="text-xs text-slate-400">{a.detected_at}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

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
  const chain = DEFAULT_CHAIN
  const snoozed = sub.snooze_until !== null && new Date(sub.snooze_until.replace(' ', 'T')) > new Date()

  const statusBadge = {
    pending: { text: t('uptime.statusPending'), cls: 'bg-slate-100 text-slate-600' },
    approved: { text: t('uptime.statusApproved'), cls: 'bg-green-100 text-green-700' },
    denied: { text: t('uptime.statusDenied'), cls: 'bg-red-100 text-red-700' },
  }[sub.status]

  const down = sub.last_down_state === 1

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <span className="truncate">{name}</span>
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-normal ${statusBadge.cls}`}>
              {statusBadge.text}
            </span>
          </div>
          <a
            href={`${chain.explorerValidatorUrl}${sub.validator_address}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 truncate font-mono text-xs text-slate-400 hover:text-amber-700"
          >
            {sub.validator_address.slice(0, 20)}...
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <button
          onClick={() => api.uptimeCancel(sub.id).then(onChange)}
          className="shrink-0 text-slate-400 hover:text-red-600"
          aria-label={t('uptime.remove')}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {sub.status === 'approved' && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="flex items-center gap-1 text-slate-500">
              <ShieldCheck className="h-3.5 w-3.5" />
              {sub.authorized_until
                ? t('uptime.until', { date: sub.authorized_until.slice(0, 10) })
                : t('uptime.indefinite')}
            </span>
            <span className={`flex items-center gap-1 font-medium ${down ? 'text-red-600' : 'text-green-700'}`}>
              {down ? <TriangleAlert className="h-3.5 w-3.5" /> : <CircleCheck className="h-3.5 w-3.5" />}
              {down ? t('uptime.down') : t('uptime.ok')}
              <span className="font-normal text-slate-400">
                ({t('uptime.missedNow', { n: sub.last_missed })})
              </span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              <Clock className="h-3.5 w-3.5" /> {t('uptime.frequency')}
              <select
                value={sub.frequency_minutes}
                onChange={(e) =>
                  api.uptimeUpdate(sub.id, { frequency_minutes: Number(e.target.value) }).then(onChange)
                }
                className="rounded-lg border border-slate-300 px-1.5 py-1 text-xs"
              >
                {FREQ_OPTIONS.map((f) => (
                  <option key={f} value={f}>
                    {t(`uptime.freq${f}`)}
                  </option>
                ))}
              </select>
            </label>

            {snoozed ? (
              <button
                onClick={() => api.uptimeUpdate(sub.id, { snooze_minutes: 0 }).then(onChange)}
                className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs hover:border-amber-500"
              >
                {t('uptime.resume')}
              </button>
            ) : (
              <button
                onClick={() => api.uptimeUpdate(sub.id, { snooze_minutes: 1440 }).then(onChange)}
                className="flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs hover:border-amber-500"
              >
                <BellOff className="h-3 w-3" /> {t('uptime.snooze')}
              </button>
            )}
          </div>
          {snoozed && sub.snooze_until && (
            <p className="text-xs text-slate-400">
              {t('uptime.snoozedUntil', { date: sub.snooze_until.slice(0, 16) })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
