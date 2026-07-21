import { useCallback, useEffect, useState } from 'react'
import { api, type AdminOverview, type UserAction } from '../api'
import { CHAINS, DEFAULT_CHAIN, formatAmount } from '../chains'

export default function Admin() {
  const [data, setData] = useState<AdminOverview | null>(null)
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
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])

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
  const watcherHealthy = stats.watcher_age_seconds !== null && stats.watcher_age_seconds < 300

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Admin</h1>

      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Users" value={stats.users} />
        <StatCard label="Watched addresses" value={stats.watched_addresses} />
        <StatCard label="Alerts (24h)" value={stats.alerts_24h} />
        <StatCard label="Alerts (total)" value={stats.alerts_total} />
      </div>

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

      <AnnouncementEditor onChanged={load} />

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
              {data.users.map((u) => (
                <tr key={u.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2">
                    {u.email}
                    {u.main_address && (
                      <div className="font-mono text-xs text-slate-400">
                        {u.main_address.slice(0, 12)}...{u.main_address.slice(-6)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2">{u.watched_count}</td>
                  <td className="px-4 py-2">
                    {u.is_admin === 1 ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                        admin
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">user</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {u.is_disabled === 1 ? (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">
                        disabled
                      </span>
                    ) : (
                      <span className="text-xs text-green-600">active</span>
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
                        onClick={() =>
                          userAction(u.id, u.is_admin === 1 ? 'demote' : 'promote')
                        }
                        className="text-slate-600 hover:underline"
                      >
                        {u.is_admin === 1 ? 'Demote' : 'Promote'}
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
        <p className="text-xs text-slate-400">
          Actions on your own account are blocked server-side.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Recent alerts (all users)</h2>
        {data.recent_alerts.length === 0 ? (
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
                  <span className="ml-2 shrink-0 text-xs text-slate-400">{a.detected_at}</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
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
          required
          maxLength={300}
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
        />
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
        >
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="danger">Danger</option>
        </select>
        <select
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
        >
          <option value="0">No expiry</option>
          <option value="6">6 hours</option>
          <option value="24">24 hours</option>
          <option value="72">3 days</option>
        </select>
        <button
          disabled={busy}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
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
