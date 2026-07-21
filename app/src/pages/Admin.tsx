import { useEffect, useState } from 'react'
import { api, type AdminOverview } from '../api'
import { CHAINS, DEFAULT_CHAIN, formatAmount } from '../chains'

export default function Admin() {
  const [data, setData] = useState<AdminOverview | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = () => api.adminOverview().then(setData).catch((e) => setError(e.message))
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [])

  if (error) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Admin</h1>
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      </div>
    )
  }
  if (!data) {
    return <p className="text-sm text-slate-500">Loading...</p>
  }

  const { stats } = data
  const watcherHealthy = stats.watcher_age_seconds !== null && stats.watcher_age_seconds < 300

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Admin</h1>

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

      <section className="space-y-2">
        <h2 className="font-medium">Users</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Watched</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Joined</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2">{u.email}</td>
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
                  <td className="px-4 py-2 text-xs text-slate-500">{u.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-2xl font-semibold">{value.toLocaleString()}</div>
    </div>
  )
}
