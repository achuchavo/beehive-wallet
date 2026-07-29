import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import {
  api,
  type AdminOverview,
  type UserAction,
  type AdminUptimeSub,
  ADMIN_FEATURES,
} from '../api'
import { CHAINS, DEFAULT_CHAIN, formatAmount } from '../chains'
import ChainManager from './ChainManager'
import OptionPicker from '../components/OptionPicker'

type Tab = 'overview' | 'users' | 'access' | 'chains' | 'announcements' | 'uptime'

export default function Admin() {
  const [data, setData] = useState<AdminOverview | null>(null)
  const [features, setFeatures] = useState<string[]>([])
  const [isSuper, setIsSuper] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')
  const [error, setError] = useState('')

  const load = useCallback(
    () =>
      api
        .adminOverview()
        .then((d) => {
          setData(d)
          setError('')
        })
        .catch((e) => setError(e.message)),
    [],
  )

  useEffect(() => {
    api.me().then((r) => {
      setFeatures(r.admin_features ?? [])
      setIsSuper(r.is_super_admin === true)
    })
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])

  const can = (feature: string) => features.includes(feature)

  async function userAction(id: number, action: UserAction) {
    if (action === 'delete' && !window.confirm('Delete this user and all their data?')) {
      return
    }
    try {
      await api.adminUserUpdate(id, action)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    }
  }

  if (!data) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Admin</h1>
        {error ? (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : (
          <p className="text-sm text-slate-500">Loading...</p>
        )}
      </div>
    )
  }

  const { stats } = data
  const watcherHealthy =
    stats.watcher_age_seconds !== null &&
    stats.watcher_age_seconds !== undefined &&
    stats.watcher_age_seconds < 300

  const allTabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'overview', label: 'Overview', show: true },
    { id: 'users', label: 'Users', show: can('users') },
    { id: 'access', label: 'Access', show: isSuper },
    { id: 'chains', label: 'Chains', show: can('chains') },
    { id: 'announcements', label: 'Announcements', show: can('announcements') },
    { id: 'uptime', label: 'Uptime', show: can('uptime') },
  ]
  const tabs = allTabs.filter((t) => t.show)

  const activeTab = tabs.some((t) => t.id === tab) ? tab : 'overview'

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Admin</h1>

      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              activeTab === t.id
                ? 'border-amber-500 font-medium text-amber-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Sections the server withheld (no feature grant) are simply absent. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.users !== undefined && <StatCard label="Users" value={stats.users} />}
            {stats.watched_addresses !== undefined && (
              <StatCard label="Watched addresses" value={stats.watched_addresses} />
            )}
            {stats.alerts_24h !== undefined && (
              <StatCard label="Alerts (24h)" value={stats.alerts_24h} />
            )}
            {stats.failed_logins_24h !== undefined && (
              <StatCard label="Failed logins (24h)" value={stats.failed_logins_24h} />
            )}
          </div>

          {can('uptime') && (
            <div
              className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${
                watcherHealthy
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              <span className="font-medium">
                Watcher: {watcherHealthy ? 'healthy' : 'not running or stale'}
              </span>
              <span>
                Last check:{' '}
                {stats.watcher_last_run
                  ? `${stats.watcher_last_run} (${stats.watcher_age_seconds}s ago)`
                  : 'never'}
              </span>
            </div>
          )}

          {/* Super admin only, matching admin_setting_set.php's own guard. */}
          {isSuper && <WatchLimitEditor onError={setError} />}

          <section className="space-y-2">
            <h2 className="font-medium">Recent alerts (all users)</h2>
            {!data.recent_alerts?.length ? (
              <p className="text-sm text-slate-500">No alerts yet.</p>
            ) : (
              <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                {data.recent_alerts.map((a) => {
                  const chain = CHAINS.find((c) => c.key === a.chain_key) ?? DEFAULT_CHAIN
                  return (
                    <li key={a.id} className="flex items-center justify-between px-4 py-2 text-sm">
                      <span className="truncate">
                        {a.label || `${a.address.slice(0, 14)}...`}
                        {a.amount && (
                          <span className="ml-2 text-slate-500">
                            {formatAmount(a.amount, chain)} {chain.displayDenom}
                          </span>
                        )}
                      </span>
                      <span className="ml-2 shrink-0 text-xs text-slate-500">{a.detected_at}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      )}

      {activeTab === 'announcements' && can('announcements') && (
        <AnnouncementEditor onChanged={load} />
      )}

      {activeTab === 'chains' && can('chains') && <ChainManager onError={setError} />}

      {activeTab === 'uptime' && can('uptime') && (
        <UptimeManager isSuper={isSuper} onError={setError} />
      )}

      {activeTab === 'access' && isSuper && (
        <RoleManager users={data.users ?? []} onChanged={load} onError={setError} />
      )}

      {activeTab === 'users' && can('users') && (
      <section className="space-y-2">
        <h2 className="font-medium">Users</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Watched</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Joined</th>
                <th className="px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data.users ?? []).map((u) => (
                <tr key={u.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2">
                    {u.email}
                    {u.main_address && (
                      <div className="font-mono text-xs text-slate-500">
                        {u.main_address.slice(0, 12)}...{u.main_address.slice(-6)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2">{u.watched_count}</td>
                  <td className="px-4 py-2">
                    {u.is_super_admin === 1 ? (
                      <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-700">
                        super
                      </span>
                    ) : u.is_admin === 1 ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                        admin
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">user</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {u.is_disabled === 1 ? (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">
                        disabled
                      </span>
                    ) : (
                      <span className="text-xs text-green-700">active</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">{u.created_at}</td>
                  <td className="px-4 py-2">
                    <div className="flex gap-2 text-xs">
                      <button
                        onClick={() =>
                          userAction(u.id, u.is_disabled === 1 ? 'enable' : 'disable')
                        }
                        className="text-amber-700 hover:underline"
                      >
                        {u.is_disabled === 1 ? 'Enable' : 'Disable'}
                      </button>
                      <button
                        onClick={() => userAction(u.id, 'delete')}
                        className="text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">
          Actions on your own account are blocked server-side.
        </p>
      </section>
      )}
    </div>
  )
}

function RoleManager({
  users,
  onChanged,
  onError,
}: {
  users: NonNullable<AdminOverview['users']>
  onChanged: () => void
  onError: (msg: string) => void
}) {
  const [editing, setEditing] = useState<number | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [isSuper, setIsSuper] = useState(false)
  const [feats, setFeats] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  function startEdit(u: NonNullable<AdminOverview['users']>[number]) {
    setEditing(u.id)
    setIsAdmin(u.is_admin === 1)
    setIsSuper(u.is_super_admin === 1)
    setFeats(u.features ? u.features.split(',') : [])
  }

  async function save(id: number) {
    setBusy(true)
    onError('')
    try {
      await api.adminRoleUpdate(id, isAdmin, isSuper, feats)
      setEditing(null)
      onChanged()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  function toggleFeat(f: string) {
    setFeats((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]))
  }

  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 font-medium">
        <ShieldCheck className="h-4 w-4 text-purple-500" /> Admin access
      </h2>
      <p className="text-sm text-slate-500">
        Grant admin access and choose which features each admin can use. Super admins have every
        feature and can manage other admins.
      </p>
      <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
        {users.map((u) => (
          <div key={u.id} className="px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{u.email}</div>
                <div className="text-xs text-slate-500">
                  {u.is_super_admin === 1
                    ? 'Super admin'
                    : u.is_admin === 1
                      ? `Admin · ${u.features || 'no features'}`
                      : 'User'}
                </div>
              </div>
              <button
                onClick={() => (editing === u.id ? setEditing(null) : startEdit(u))}
                className="shrink-0 text-xs text-amber-700 hover:underline"
              >
                {editing === u.id ? 'Cancel' : 'Edit access'}
              </button>
            </div>
            {editing === u.id && (
              <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isSuper}
                    onChange={(e) => {
                      setIsSuper(e.target.checked)
                      if (e.target.checked) setIsAdmin(true)
                    }}
                  />
                  Super admin (all features, manages admins)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isAdmin}
                    disabled={isSuper}
                    onChange={(e) => setIsAdmin(e.target.checked)}
                  />
                  Admin
                </label>
                {isAdmin && !isSuper && (
                  <div className="flex flex-wrap gap-3 pl-6">
                    {ADMIN_FEATURES.map((f) => (
                      <label key={f} className="flex items-center gap-1.5 text-sm capitalize">
                        <input
                          type="checkbox"
                          checked={feats.includes(f)}
                          onChange={() => toggleFeat(f)}
                        />
                        {f}
                      </label>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => save(u.id)}
                  disabled={busy}
                  className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-amber-600 disabled:opacity-50"
                >
                  {busy ? 'Saving...' : 'Save access'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500">Your own role can't be changed here.</p>
    </section>
  )
}

function AnnouncementEditor({ onChanged }: { onChanged: () => void }) {
  const [current, setCurrent] = useState<{ message: string; severity: string } | null>(null)
  const [message, setMessage] = useState('')
  const [severity, setSeverity] = useState('info')
  const [hours, setHours] = useState('24')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(
    () => api.announcementGet().then((r) => setCurrent(r.announcement)).catch(() => {}),
    [],
  )

  useEffect(() => {
    refresh()
  }, [refresh])

  async function publish(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.adminAnnouncementSet(message.trim(), severity, Number(hours) || 0)
      setMessage('')
      await refresh()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  async function clear() {
    setBusy(true)
    try {
      await api.adminAnnouncementClear()
      await refresh()
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="font-medium">Announcement banner</h2>
      {current ? (
        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
          <span>
            <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
              {current.severity}
            </span>
            {current.message}
          </span>
          <button
            onClick={clear}
            disabled={busy}
            className="text-xs text-red-600 hover:underline disabled:opacity-50"
          >
            Take down
          </button>
        </div>
      ) : (
        <p className="text-sm text-slate-500">No active banner.</p>
      )}
      <form onSubmit={publish} className="flex flex-col gap-2 sm:flex-row">
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Message shown to every user"
          aria-label="Announcement message"
          required
          maxLength={300}
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
        />
        <OptionPicker
          label="Severity"
          value={severity}
          onChange={setSeverity}
          className="py-2"
          options={[
            { value: 'info', label: 'Info' },
            { value: 'warning', label: 'Warning' },
            { value: 'danger', label: 'Danger' },
          ]}
        />
        <OptionPicker
          label="Expiry"
          value={hours}
          onChange={setHours}
          className="py-2"
          options={[
            { value: '0', label: 'No expiry' },
            { value: '6', label: '6 hours' },
            { value: '24', label: '24 hours' },
            { value: '72', label: '3 days' },
          ]}
        />
        <button
          disabled={busy}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-amber-600 disabled:opacity-50"
        >
          Publish
        </button>
      </form>
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
    </section>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-2xl font-semibold">{value.toLocaleString()}</div>
    </div>
  )
}

/**
 * How many addresses one user may watch. Stored in app_settings, read back
 * through settings_public.php, and enforced in watched_add.php - this screen
 * only writes it.
 */
function WatchLimitEditor({ onError }: { onError: (m: string) => void }) {
  // Server bounds, mirrored here so the field can't offer a value the API will
  // reject. watched_add.php clamps on read regardless.
  const MIN = 1
  const MAX = 500
  const [saved, setSaved] = useState<number | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const load = useCallback(() => {
    api
      .settingsPublic()
      .then((r) => {
        setSaved(r.watch_limit)
        setValue(String(r.watch_limit))
      })
      .catch((e) => onError(e instanceof Error ? e.message : 'Failed'))
  }, [onError])

  useEffect(() => {
    load()
  }, [load])

  const parsed = Number(value)
  const valid = /^\d+$/.test(value.trim()) && parsed >= MIN && parsed <= MAX
  const changed = saved !== null && parsed !== saved

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!valid || !changed) return
    setBusy(true)
    setDone(false)
    try {
      await api.adminSettingSet('watch_limit', parsed)
      setSaved(parsed)
      setDone(true)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  if (saved === null) return null

  return (
    <section className="space-y-2">
      <h2 className="font-medium">Limits</h2>
      <form
        onSubmit={save}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
      >
        <div>
          <label htmlFor="watch-limit" className="block text-sm font-medium">
            Watched addresses per user
          </label>
          <p className="text-xs text-slate-500">
            Applies to every user, across all networks. Lowering it never deletes
            anything - users already above the new limit keep what they have and
            simply cannot add more.
          </p>
        </div>
        <input
          id="watch-limit"
          value={value}
          onChange={(e) => {
            setValue(e.target.value.trim())
            setDone(false)
          }}
          inputMode="numeric"
          aria-invalid={!valid}
          aria-describedby="watch-limit-range"
          className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums focus:border-amber-500 focus:outline-none"
        />
        <button
          disabled={busy || !valid || !changed}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-amber-600 disabled:opacity-50"
        >
          {busy ? 'Saving...' : 'Save'}
        </button>
        <span id="watch-limit-range" className="text-xs text-slate-500">
          {valid ? `${MIN}-${MAX}` : `Enter a whole number between ${MIN} and ${MAX}`}
        </span>
        {done && !changed && <span className="text-xs font-medium text-green-700">Saved.</span>}
      </form>
    </section>
  )
}

function UptimeManager({ isSuper, onError }: { isSuper: boolean; onError: (m: string) => void }) {
  const [enabled, setEnabled] = useState(false)
  const [subs, setSubs] = useState<AdminUptimeSub[]>([])

  const load = useCallback(() => {
    api
      .adminUptimeList()
      .then((r) => {
        setEnabled(r.enabled)
        setSubs(r.subscriptions)
      })
      .catch((e) => onError(e instanceof Error ? e.message : 'Failed'))
  }, [onError])

  useEffect(() => {
    load()
  }, [load])

  async function toggle() {
    try {
      await api.adminSettingSet('uptime_alerts_enabled', !enabled)
      load()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed')
    }
  }

  async function decide(id: number, action: 'approve' | 'deny', days: number) {
    try {
      await api.adminUptimeDecide(id, action, days)
      load()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed')
    }
  }

  const statusCls: Record<string, string> = {
    pending: 'bg-slate-100 text-slate-600',
    approved: 'bg-green-100 text-green-700',
    denied: 'bg-red-100 text-red-700',
  }

  return (
    <div className="space-y-4">
      {isSuper ? (
        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div>
            <div className="text-sm font-medium">Validator uptime alerts</div>
            <div className="text-xs text-slate-500">Global on/off for the whole feature.</div>
          </div>
          <button
            onClick={toggle}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              enabled ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
            }`}
          >
            {enabled ? 'On' : 'Off'}
          </button>
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          Feature is currently {enabled ? 'on' : 'off'} (a super admin controls the global switch).
        </p>
      )}

      <section className="space-y-2">
        <h2 className="font-medium">Applications</h2>
        {subs.length === 0 ? (
          <p className="text-sm text-slate-500">No applications yet.</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
            {subs.map((s) => (
              <li key={s.id} className="space-y-2 px-4 py-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{s.moniker || s.validator_address}</div>
                    <div className="truncate text-xs text-slate-500">
                      {s.email} · <span className="font-mono">{s.validator_address.slice(0, 20)}...</span>
                    </div>
                  </div>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${statusCls[s.status]}`}>
                    {s.status}
                    {s.status === 'approved' &&
                      (s.authorized_until ? ` · until ${s.authorized_until.slice(0, 10)}` : ' · no expiry')}
                  </span>
                </div>
                {s.status === 'pending' && (
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => decide(s.id, 'approve', 30)}
                      className="rounded-lg bg-amber-500 px-2.5 py-1 text-xs font-medium text-slate-900 hover:bg-amber-600"
                    >
                      Approve 30d
                    </button>
                    <button
                      onClick={() => decide(s.id, 'approve', 90)}
                      className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs hover:border-amber-500"
                    >
                      90d
                    </button>
                    <button
                      onClick={() => decide(s.id, 'approve', 0)}
                      className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs hover:border-amber-500"
                    >
                      Indefinite
                    </button>
                    <button
                      onClick={() => decide(s.id, 'deny', 0)}
                      className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-red-600 hover:border-red-400"
                    >
                      Deny
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
