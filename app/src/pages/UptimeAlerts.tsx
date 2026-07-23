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
import { DEFAULT_CHAIN, CHAINS, type ChainInfo } from '../chains'
import { useAuth } from '../auth/AuthContext'
import OptionPicker from '../components/OptionPicker'
import ConfirmDelete from '../components/ConfirmDelete'
import { useT } from '../i18n/I18nContext'

const POLL_MS = 30000
const FREQ_OPTIONS = [60, 360, 720, 1440]

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
  const [chainKey, setChainKey] = useState(DEFAULT_CHAIN.key)
  const chain = CHAINS.find((c) => c.key === chainKey) ?? DEFAULT_CHAIN
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
    const id = setInterval(refresh, POLL_MS)
    return () => clearInterval(id)
  }, [refresh])

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
          <Activity className="h-5 w-5 text-amber-700" /> {t('uptime.title')}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{t('uptime.intro')}</p>
      </div>

      {notice && <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</div>}
      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {/* Apply */}
      <form onSubmit={apply} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-medium">{t('uptime.applyTitle')}</div>

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
            options={CHAINS.map((c) => ({
              value: c.key,
              label: c.chainName,
              hint: c.chainId,
            }))}
          />
        </label>

        {/* Two distinct ways in, previously stacked with no explanation of how
            they related. The 251-entry list is the one place the picker's
            search genuinely earns its keep. */}
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

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            {t('uptime.orEnterManually')}
          </span>
          <input
            value={validator}
            onChange={(e) => setValidator(e.target.value.trim())}
            placeholder={`${chain.bech32Prefix}valoper1...`}
            aria-label={t('uptime.orEnterManually')}
            aria-invalid={validatorMatchesChain ? undefined : true}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-amber-500 focus:outline-none"
          />
        </label>
        {!validatorMatchesChain && (
          <p className="text-xs text-red-600">
            {t('uptime.errWrongNetwork', { chain: chain.chainName })}
          </p>
        )}
        <button
          disabled={busy || !validator || !validatorMatchesChain}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-amber-600 disabled:opacity-50"
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
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)
  // The subscription's own chain. This was DEFAULT_CHAIN, so a Chihuahua
  // subscription rendered a Medibloc explorer link - a dead link to a
  // validator that does not exist on that network.
  const chain = CHAINS.find((c) => c.key === sub.chain_key) ?? DEFAULT_CHAIN
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
            className="inline-flex items-center gap-1 truncate font-mono text-xs text-slate-500 hover:text-amber-700"
          >
            {sub.validator_address.slice(0, 20)}...
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <button
          onClick={() => setConfirming(true)}
          className="shrink-0 text-slate-500 hover:text-red-600"
          aria-label={t('uptime.remove')}
        >
          <Trash2 className="h-4 w-4" />
        </button>
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
              } finally {
                setRemoving(false)
                setConfirming(false)
              }
            }}
            onCancel={() => setConfirming(false)}
          />
        )}
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
              <span className="font-normal text-slate-500">
                ({t('uptime.missedNow', { n: sub.last_missed })})
              </span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              <Clock className="h-3.5 w-3.5" /> {t('uptime.frequency')}
              <OptionPicker
                label={t('uptime.frequency')}
                value={String(sub.frequency_minutes)}
                onChange={(v) =>
                  api.uptimeUpdate(sub.id, { frequency_minutes: Number(v) }).then(onChange)
                }
                className="py-1 text-xs"
                options={FREQ_OPTIONS.map((f) => ({ value: String(f), label: t(`uptime.freq${f}`) }))}
              />
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
            <p className="text-xs text-slate-500">
              {t('uptime.snoozedUntil', { date: sub.snooze_until.slice(0, 16) })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
