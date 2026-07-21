import { useCallback, useEffect, useState } from 'react'
import { api, type WatchedAddress, type WalletAlert } from '../api'
import { DEFAULT_CHAIN, formatAmount, CHAINS } from '../chains'

const POLL_MS = 15000

function urlB64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

type PushState = 'unsupported' | 'denied' | 'off' | 'on' | 'busy'

function PushSettings() {
  const [state, setState] = useState<PushState>('busy')
  const [error, setError] = useState('')

  const swUrl = `${import.meta.env.BASE_URL}sw.js`

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported')
      return
    }
    navigator.serviceWorker
      .register(swUrl)
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setState(sub ? 'on' : Notification.permission === 'denied' ? 'denied' : 'off'))
      .catch(() => setState('unsupported'))
  }, [swUrl])

  async function enable() {
    setState('busy')
    setError('')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState('denied')
        return
      }
      const reg = await navigator.serviceWorker.ready
      const { publicKey } = await api.pushConfig()
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(publicKey) as BufferSource,
      })
      await api.pushSubscribe(sub.toJSON())
      setState('on')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not enable push')
      setState('off')
    }
  }

  async function disable() {
    setState('busy')
    setError('')
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await api.pushUnsubscribe(sub.endpoint).catch(() => {})
        await sub.unsubscribe()
      }
      setState('off')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not disable push')
      setState('on')
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Push notifications</div>
          <div className="text-xs text-slate-500">
            {state === 'unsupported' && 'Not supported by this browser.'}
            {state === 'denied' &&
              'Blocked by the browser. Allow notifications for this site in browser settings.'}
            {state === 'off' && 'Get alerts on this device even when the app is closed.'}
            {state === 'on' && 'Enabled on this device.'}
            {state === 'busy' && 'Checking...'}
          </div>
        </div>
        {state === 'off' && (
          <button
            onClick={enable}
            className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-600"
          >
            Enable
          </button>
        )}
        {state === 'on' && (
          <button
            onClick={disable}
            className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:border-amber-500"
          >
            Disable
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <p className="mt-1 text-xs text-slate-400">
        On iPhone: add this site to your home screen first (Share, then Add to Home Screen).
      </p>
    </div>
  )
}

export default function Alarms() {
  const [authChecked, setAuthChecked] = useState(false)
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    api.me().then((r) => {
      setEmail(r.logged_in ? (r.email ?? null) : null)
      setAuthChecked(true)
    })
  }, [])

  if (!authChecked) {
    return <p className="text-sm text-slate-500">Loading...</p>
  }
  if (!email) {
    return <AuthForm onLoggedIn={setEmail} />
  }
  return <AlarmPanel email={email} onLoggedOut={() => setEmail(null)} />
}

function AuthForm({ onLoggedIn }: { onLoggedIn: (email: string) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'register') {
        await api.register(email, password)
      } else {
        await api.login(email, password)
      }
      onLoggedIn(email)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-sm space-y-4">
      <h1 className="text-xl font-semibold">Alarms</h1>
      <p className="text-sm text-slate-500">
        Sign in to watch addresses and get an alert whenever a transaction leaves them. Your
        account only stores public addresses - never keys.
      </p>
      <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
        />
        <input
          type="password"
          required
          minLength={10}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === 'register' ? 'Password (10+ characters)' : 'Password'}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
        />
        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <button
          disabled={busy}
          className="w-full rounded-lg bg-amber-500 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
        >
          {busy ? 'Working...' : mode === 'register' ? 'Create account' : 'Sign in'}
        </button>
      </form>
      <button
        onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        className="text-sm text-amber-700 hover:underline"
      >
        {mode === 'login' ? 'No account yet? Create one' : 'Have an account? Sign in'}
      </button>
    </div>
  )
}

function AlarmPanel({ email, onLoggedOut }: { email: string; onLoggedOut: () => void }) {
  const [addresses, setAddresses] = useState<WatchedAddress[]>([])
  const [alerts, setAlerts] = useState<WalletAlert[]>([])
  const [unread, setUnread] = useState(0)
  const [error, setError] = useState('')

  const [newAddress, setNewAddress] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [w, a] = await Promise.all([api.watchedList(), api.alertsList()])
      setAddresses(w.addresses)
      setAlerts(a.alerts)
      setUnread(a.unread)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed')
    }
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  async function addAddress(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.watchedAdd(DEFAULT_CHAIN.key, newAddress.trim(), newLabel.trim())
      setNewAddress('')
      setNewLabel('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add address')
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    await api.logout()
    onLoggedOut()
  }

  function chainName(key: string) {
    return CHAINS.find((c) => c.key === key)?.chainName ?? key
  }

  function shortAddr(a: string) {
    return a.length > 20 ? `${a.slice(0, 12)}...${a.slice(-6)}` : a
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Alarms</h1>
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <span>{email}</span>
          <button onClick={logout} className="text-amber-700 hover:underline">
            Sign out
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <PushSettings />

      <section className="space-y-3">
        <h2 className="font-medium">Watched addresses</h2>
        <form onSubmit={addAddress} className="flex flex-col gap-2 sm:flex-row">
          <input
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
            placeholder={`${DEFAULT_CHAIN.bech32Prefix}1...`}
            required
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-amber-500 focus:outline-none"
          />
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Label (optional)"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none sm:w-40"
          />
          <button
            disabled={busy}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
          >
            Watch
          </button>
        </form>
        {addresses.length === 0 ? (
          <p className="text-sm text-slate-500">No watched addresses yet. Add one above.</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
            {addresses.map((w) => (
              <li key={w.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {w.label || shortAddr(w.address)}
                    <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-500">
                      {chainName(w.chain_key)}
                    </span>
                  </div>
                  <div className="truncate font-mono text-xs text-slate-400">{w.address}</div>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-slate-500">
                  <input
                    type="checkbox"
                    checked={w.alarm_enabled === 1}
                    onChange={(e) =>
                      api.watchedToggle(w.id, e.target.checked).then(refresh)
                    }
                  />
                  Alarm
                </label>
                <button
                  onClick={() => api.watchedRemove(w.id).then(refresh)}
                  className="text-xs text-red-600 hover:underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">
            Alerts
            {unread > 0 && (
              <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                {unread} new
              </span>
            )}
          </h2>
          {unread > 0 && (
            <button
              onClick={() => api.alertsMarkRead().then(refresh)}
              className="text-sm text-amber-700 hover:underline"
            >
              Mark all read
            </button>
          )}
        </div>
        {alerts.length === 0 ? (
          <p className="text-sm text-slate-500">
            No alerts yet. When a transaction leaves a watched address, it shows up here within
            about a minute.
          </p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
            {alerts.map((a) => {
              const chain = CHAINS.find((c) => c.key === a.chain_key) ?? DEFAULT_CHAIN
              return (
                <li key={a.id} className={`px-4 py-3 ${a.is_read ? '' : 'bg-amber-50'}`}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">
                      Outgoing tx from {a.label || shortAddr(a.address)}
                    </span>
                    <span className="text-xs text-slate-400">{a.detected_at}</span>
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    {a.amount
                      ? `${formatAmount(a.amount, chain)} ${chain.displayDenom} to ${shortAddr(a.recipient)}`
                      : 'Non-transfer transaction (stake, vote, ...)'}
                  </div>
                  <a
                    href={`${chain.explorerTxUrl}${a.tx_hash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-amber-700 hover:underline"
                  >
                    {a.tx_hash.slice(0, 16)}...
                  </a>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
