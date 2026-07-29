import { useCallback, useEffect, useState } from 'react'
import {
  BellRing,
  Eye,
  ArrowUpRight,
  ArrowDownLeft,
  Undo2,
  ExternalLink,
  CircleCheck,
  Plus,
  Trash2,
  X,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import { api, type WatchedAddress, type WalletAlert, type AlarmType, type AlertKind } from '../api'
import { DEFAULT_CHAIN, formatAmount, CHAINS } from '../chains'
import { useWallet } from '../wallet/WalletContext'
import { useAuth } from '../auth/AuthContext'
import { useT } from '../i18n/I18nContext'
import PasswordInput from '../components/PasswordInput'
import Modal from '../components/Modal'
import CopyAddress from '../components/CopyAddress'
import HelpTip from '../components/HelpTip'
import OptionPicker from '../components/OptionPicker'
import PageHeader from '../components/PageHeader'
import Toggle from '../components/Toggle'
import Checkbox from '../components/Checkbox'
import ConfirmDelete from '../components/ConfirmDelete'
import { maskAmount, usePrivacyMode } from '../privacyMode'

const POLL_MS = 15000

const ALARM_TYPES: AlarmType[] = ['both', 'sent', 'received', 'unbond']
const TYPE_KEY: Record<AlarmType, string> = {
  sent: 'alarms.typeSent',
  received: 'alarms.typeReceived',
  both: 'alarms.typeBoth',
  unbond: 'alarms.typeUnbond',
}

const KIND_META: Record<
  AlertKind,
  { Icon: typeof ArrowUpRight; color: string; titleKey: string; arrow: string }
> = {
  sent: { Icon: ArrowUpRight, color: 'text-red-500', titleKey: 'alarms.outgoingFrom', arrow: '→' },
  received: { Icon: ArrowDownLeft, color: 'text-green-700', titleKey: 'alarms.incomingTo', arrow: '←' },
  unbond: { Icon: Undo2, color: 'text-amber-700', titleKey: 'alarms.unbondingFrom', arrow: '' },
}

function urlB64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

type PushState = 'unsupported' | 'denied' | 'off' | 'on' | 'busy'

function PushSettings() {
  const { t } = useT()
  const [state, setState] = useState<PushState>('busy')
  const [error, setError] = useState('')
  // Default to private until the server says otherwise: if the fetch fails we
  // must not render the toggle as "off" and imply amounts are being sent.
  const [priv, setPriv] = useState(true)

  useEffect(() => {
    api
      .me()
      .then((r) => setPriv(r.push_private !== false))
      .catch(() => {})
  }, [])

  async function togglePrivacy(next: boolean) {
    setPriv(next)
    try {
      await api.pushPrivacy(next)
    } catch {
      setPriv(!next) // put the switch back rather than lie about the state
    }
  }

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
    <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200/70">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <BellRing className="h-4.5 w-4.5" strokeWidth={1.8} />
          </div>
          <div>
          <div className="text-sm font-medium">{t('alarms.push')}</div>
          <div className="text-xs text-slate-500">
            {state === 'unsupported' && t('alarms.pushUnsupported')}
            {state === 'denied' && t('alarms.pushDenied')}
            {state === 'off' && t('alarms.pushOff')}
            {state === 'on' && t('alarms.pushOn')}
            {state === 'busy' && t('alarms.pushChecking')}
          </div>
          </div>
        </div>
        {state === 'off' && (
          <button
            onClick={enable}
            className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-amber-600"
          >
            {t('alarms.enable')}
          </button>
        )}
        {state === 'on' && (
          <button
            onClick={disable}
            className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:border-amber-500"
          >
            {t('alarms.disable')}
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {/* Shown BEFORE the permission prompt, not after: consent to
          notifications should include knowing what will be on the lock screen. */}
      {state === 'off' && (
        <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {t('alarms.pushLockScreenNote')}
        </p>
      )}

      {/* The two paragraphs that used to explain this checkbox (one per state)
          are now one "?" - the current state is already visible in the box. */}
      <div className="mt-3 flex items-center gap-1.5 text-xs text-slate-600">
        <Checkbox checked={priv} onChange={togglePrivacy} label={t('alarms.pushPrivateLabel')} />
        <HelpTip text={t('help.pushPrivate')} />
      </div>

      {/* Only while push is off: it is a setup instruction, not a standing note. */}
      {state === 'off' && <p className="mt-2 text-xs text-slate-500">{t('alarms.pushIphone')}</p>}
    </div>
  )
}

export default function Alarms() {
  const auth = useAuth()
  const { t } = useT()

  if (auth.status === 'loading') {
    return <p className="text-sm text-slate-500">{t('common.loading')}</p>
  }
  if (auth.status === 'out') {
    return <AuthForm />
  }
  return <AlarmPanel email={auth.email ?? ''} onLoggedOut={auth.logout} />
}

function AuthForm() {
  const { refresh } = useAuth()
  const { t } = useT()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [identifier, setIdentifier] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Opt-in, not opt-out: a persistent session is a security tradeoff the user
  // should choose deliberately.
  const [remember, setRemember] = useState(false)
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null)

  function startRegister() {
    setMode('register')
    setError('')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (mode === 'register' && password !== confirm) {
      setError(t('alarms.passwordsNoMatch'))
      return
    }
    setBusy(true)
    setError('')
    try {
      if (mode === 'register') {
        // No address here: it can only be linked after sign-in, by signing a
        // challenge that proves you hold its key.
        await api.register(email, password)
        setRegisteredEmail(email)
      } else {
        await api.login(identifier.trim(), password, remember)
        await refresh()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  // After registering, move to the sign-in form with the email prefilled.
  function goSignIn() {
    setMode('login')
    setIdentifier(registeredEmail ?? '')
    setPassword('')
    setConfirm('')
    setError('')
    setRegisteredEmail(null)
  }

  return (
    <div className="mx-auto max-w-sm space-y-4">
      {registeredEmail && (
        <Modal title={t('alarms.accountCreated')} onClose={goSignIn}>
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-700">
              <CircleCheck className="h-6 w-6" />
            </div>
            <p className="text-sm text-slate-600">{t('alarms.accountReady', { email: registeredEmail ?? '' })}</p>
            <button
              onClick={goSignIn}
              className="mt-5 w-full rounded-lg bg-amber-500 py-2 text-sm font-medium text-slate-900 hover:bg-amber-600"
            >
              {t('account.signIn')}
            </button>
          </div>
        </Modal>
      )}
      <h1 className="text-xl font-semibold">{t('alarms.title')}</h1>
      <p className="text-sm text-slate-500">{t('alarms.signInDesc')}</p>

      {/* The account model, stated where the decision is made.
          The email is an UNVERIFIED username: nothing is ever sent to it, so
          it proves nothing and cannot be used for recovery. Saying so here
          prevents the reasonable-but-wrong assumption that signing up protects
          or backs up a wallet. */}
      <div className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <p className="flex items-start gap-1.5 font-medium text-slate-700">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
          {t('alarms.accountModelTitle')}
        </p>
        <p>{t('alarms.accountModelUsername')}</p>
        <p>{t('alarms.accountModelNoWallets')}</p>
        <p className="text-amber-800">{t('alarms.accountModelNoReset')}</p>
      </div>
      <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        {/* Persistent labels, not placeholders: a placeholder disappears the
            moment you type and is not reliably announced (audit #22). */}
        {mode === 'login' ? (
          <div>
            <label htmlFor="auth-identifier" className="mb-1 block text-xs font-medium text-slate-600">
              {t('alarms.emailOrAddress')}
            </label>
            <input
              id="auth-identifier"
              type="text"
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={t('alarms.emailOrAddress')}
              autoComplete="username"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
            />
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="auth-email" className="mb-1 block text-xs font-medium text-slate-600">
                {t('alarms.usernameLabel')}
              </label>
              <input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                autoComplete="username"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
              />
              <p className="mt-1 text-xs text-slate-500">{t('alarms.usernameHelp')}</p>
            </div>
            {/* No address field at sign-up: the server ignores an unproven
                address. It is linked after sign-in by signing a challenge. */}
            <p className="text-xs text-slate-500">{t('alarms.linkAddressAfter')}</p>
          </>
        )}
        <div>
          <label htmlFor="auth-password" className="mb-1 block text-xs font-medium text-slate-600">
            {t('alarms.password')}
          </label>
          <PasswordInput
            id="auth-password"
            required
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'register' ? t('alarms.passwordHint') : t('alarms.password')}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            aria-describedby={mode === 'register' ? 'auth-password-hint' : undefined}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
          />
          {mode === 'register' && (
            <p id="auth-password-hint" className="mt-1 text-xs text-slate-500">
              {t('alarms.passwordHint')}
            </p>
          )}
        </div>
        {mode === 'register' && (
          <div>
            <label htmlFor="auth-confirm" className="mb-1 block text-xs font-medium text-slate-600">
              {t('alarms.confirmPassword')}
            </label>
            <PasswordInput
              id="auth-confirm"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={t('alarms.confirmPassword')}
              autoComplete="new-password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
            />
          </div>
        )}
        {mode === 'login' && (
          <Checkbox checked={remember} onChange={setRemember} label={t('alarms.rememberMe')} />
        )}
        {error && (
          <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <button
          disabled={busy}
          className="w-full rounded-lg bg-amber-500 py-2 text-sm font-medium text-slate-900 hover:bg-amber-600 disabled:opacity-50"
        >
          {busy ? t('alarms.working') : mode === 'register' ? t('alarms.createAccount') : t('account.signIn')}
        </button>
      </form>
      <button
        onClick={() => (mode === 'login' ? startRegister() : setMode('login'))}
        className="text-sm text-amber-700 hover:underline"
      >
        {mode === 'login' ? t('alarms.noAccount') : t('alarms.haveAccount')}
      </button>
    </div>
  )
}

function MainAddressCard() {
  const { t } = useT()
  const { wallets, signOwnership } = useWallet()
  const [address, setAddress] = useState<string | null | undefined>(undefined)
  // Addresses linked before ownership proofs existed come back unverified and
  // must be re-proved; until then they do not work as a sign-in identifier.
  const [verified, setVerified] = useState(false)
  const [editing, setEditing] = useState(false)
  // Only a wallet held in this app can be linked - ownership has to be proved
  // by signing, so an arbitrary typed address is no longer accepted.
  const [pick, setPick] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.me().then((r) => {
      setAddress(r.main_address ?? null)
      setVerified(r.main_address_verified === true)
    })
  }, [])

  // Never let a typed password outlive the form.
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

  async function link() {
    const wallet = wallets.find((w) => w.address === pick)
    if (!wallet) {
      setError(t('alarms.pickWallet'))
      return
    }
    setBusy(true)
    setError('')
    try {
      // 1. Server issues a single-use challenge bound to this account+address.
      const c = await api.addressChallenge(wallet.address, wallet.chainKey)
      // 2. Sign it locally; the key never leaves the browser.
      const proof = await signOwnership(wallet.id, password, c.message)
      setPassword('')
      // 3. Redeem. The server re-derives the address from the public key.
      const r = await api.accountSetAddress(wallet.address, { nonce: c.nonce, ...proof })
      setAddress(r.main_address)
      setVerified(r.verified === true)
      setEditing(false)
    } catch (e) {
      setPassword('')
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  async function unlink() {
    setBusy(true)
    setError('')
    try {
      const r = await api.accountSetAddress('')
      setAddress(r.main_address)
      setVerified(false)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  if (address === undefined) return null

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        {t('alarms.mainAddress')}
        {address &&
          (verified ? (
            <span className="flex items-center gap-0.5 rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-normal text-green-700">
              <ShieldCheck className="h-3 w-3" /> {t('alarms.verified')}
            </span>
          ) : (
            <span className="flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-normal text-amber-800">
              <TriangleAlert className="h-3 w-3" /> {t('alarms.unverified')}
            </span>
          ))}
      </div>

      {address && !editing ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-mono text-xs text-slate-500">{address}</span>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => setEditing(true)}
                className="text-xs text-amber-700 hover:underline"
              >
                {verified ? t('alarms.change') : t('alarms.verifyNow')}
              </button>
              <button
                onClick={unlink}
                disabled={busy}
                className="text-xs text-slate-500 hover:text-red-600"
              >
                {t('alarms.unlink')}
              </button>
            </div>
          </div>
          {!verified && (
            <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {t('alarms.needsReverify')}
            </p>
          )}
        </div>
      ) : (
        <div className="mt-1 space-y-2">
          {wallets.length === 0 ? (
            <p className="text-xs text-slate-500">{t('alarms.needWalletToLink')}</p>
          ) : (
            <>
              <label className="block text-xs text-slate-500" htmlFor="link-wallet">
                {t('alarms.chooseWalletToVerify')}
              </label>
              <OptionPicker
                id="link-wallet"
                full
                label={t('alarms.pickWallet')}
                value={pick}
                onChange={setPick}
                className="py-2"
                layout="list"
                options={[
                  { value: '', label: t('alarms.pickWallet') },
                  ...wallets.map((w) => ({
                    value: w.address,
                    label: w.name,
                    hint: `${w.address.slice(0, 14)}...${w.address.slice(-6)}`,
                  })),
                ]}
              />
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('send.signPassword')}
                aria-label={t('send.signPassword')}
                autoComplete="current-password"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={link}
                  disabled={busy || !pick || !password}
                  className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-slate-900 hover:bg-amber-600 disabled:opacity-50"
                >
                  {busy ? t('alarms.verifying') : t('alarms.verifyAndLink')}
                </button>
                {address && (
                  <button
                    onClick={() => setEditing(false)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:border-amber-500"
                  >
                    {t('common.cancel')}
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-500">{t('alarms.ownershipNote')}</p>
            </>
          )}
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function AlarmPanel({ email, onLoggedOut }: { email: string; onLoggedOut: () => void }) {
  const { wallets } = useWallet()
  const { t } = useT()
  const hidden = usePrivacyMode()
  const [addresses, setAddresses] = useState<WatchedAddress[]>([])
  // Admin-configurable server-side; seeded with the shipped default so the
  // counter never renders "3 of 0" during the first load.
  const [watchLimit, setWatchLimit] = useState(20)
  const [alerts, setAlerts] = useState<WalletAlert[]>([])
  const [unread, setUnread] = useState(0)
  const [error, setError] = useState('')

  const [newAddress, setNewAddress] = useState('')
  // Which network this alert is filed under. Defaults to the first configured
  // chain but is always visible and changeable before submit.
  const [newChain, setNewChain] = useState(DEFAULT_CHAIN.key)
  const [newLabel, setNewLabel] = useState('')
  const [newType, setNewType] = useState<AlarmType>('both')
  const [busy, setBusy] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [w, a] = await Promise.all([api.watchedList(), api.alertsList()])
      setAddresses(w.addresses)
      if (w.limit > 0) setWatchLimit(w.limit)
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

  const selectedChain = CHAINS.find((c) => c.key === newChain) ?? DEFAULT_CHAIN
  // Client-side HRP check. The server re-validates (watched_add.php) - this is
  // for feedback, not enforcement.
  const addressMatchesChain =
    newAddress.trim() === '' || newAddress.trim().startsWith(selectedChain.bech32Prefix + '1')

  const atLimit = addresses.length >= watchLimit

  // Removing a watched address deletes its alert history with it, and there is
  // no undo on the server - so it is confirmed, with the consequence named.
  const [removingWatch, setRemovingWatch] = useState<{ id: number; label: string } | null>(null)
  const [removingBusy, setRemovingBusy] = useState(false)

  async function confirmRemoveWatch() {
    if (!removingWatch) return
    setRemovingBusy(true)
    try {
      await api.watchedRemove(removingWatch.id)
      await refresh()
      setRemovingWatch(null)
    } finally {
      setRemovingBusy(false)
    }
  }

  async function addAddress(e: React.FormEvent) {
    e.preventDefault()
    if (!addressMatchesChain) {
      setError(t('alarms.errWrongNetwork', { chain: selectedChain.chainName }))
      return
    }
    // Convenience only - watched_add.php enforces this. Catches the case where
    // the list filled up in another tab since this form was opened, and says so
    // in the user's language rather than passing through the API's English.
    if (addresses.length >= watchLimit) {
      setError(t('alarms.watchLimitReached', { limit: watchLimit }))
      return
    }
    setBusy(true)
    setError('')
    try {
      // The selected network, never a global default. This submitted
      // DEFAULT_CHAIN.key regardless of what the address actually was, so a
      // Chihuahua address was filed under Medibloc and the watcher then polled
      // a Medibloc node for an address that does not exist there - alerts the
      // user believed were armed silently never fired.
      await api.watchedAdd(newChain, newAddress.trim(), newLabel.trim(), newType)
      setNewAddress('')
      setNewLabel('')
      setNewType('both')
      setShowAddForm(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add address')
    } finally {
      setBusy(false)
    }
  }

  function logout() {
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
      {removingWatch && (
        <ConfirmDelete
          title={t('alarms.removeWatchTitle')}
          name={removingWatch.label}
          impact={t('alarms.removeWatchImpact')}
          busy={removingBusy}
          onConfirm={confirmRemoveWatch}
          onCancel={() => setRemovingWatch(null)}
        />
      )}
      <PageHeader title={t('alarms.title')} help={t('help.account')}>
        <span className="hidden text-sm text-slate-500 sm:inline">{email}</span>
        <button onClick={logout} className="text-sm text-slate-500 hover:text-amber-700">
          {t('account.signOut')}
        </button>
      </PageHeader>

      {error && (
        <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <MainAddressCard />

      <PushSettings />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 px-1 text-xs font-medium uppercase tracking-wide text-slate-500">
            <Eye className="h-3.5 w-3.5" strokeWidth={1.8} /> {t('alarms.watched')}
            {/* The cap used to be invisible until the server rejected a filled-in
                form. Stating it up front is the whole point. */}
            <span className="tabular-nums normal-case">
              {t('alarms.watchedCount', { count: addresses.length, limit: watchLimit })}
            </span>
            <HelpTip text={t('help.watchLimit', { limit: watchLimit })} />
          </h2>
          <button
            type="button"
            onClick={() => setShowAddForm((o) => !o)}
            aria-expanded={showAddForm}
            disabled={atLimit && !showAddForm}
            title={atLimit ? t('alarms.watchLimitReached', { limit: watchLimit }) : undefined}
            className="flex items-center gap-1 rounded-xl bg-white px-2.5 py-1.5 text-sm text-slate-600 ring-1 ring-slate-200 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-slate-600"
          >
            {showAddForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {showAddForm ? t('common.close') : t('alarms.watch')}
          </button>
        </div>

        {showAddForm && (
          <form onSubmit={addAddress} className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200/70">
            {/* Network first, and always visible: which chain an alert is filed
                under decides which node the watcher polls, so it must be a
                deliberate choice rather than an invisible default. */}
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                {t('dash.chainFilter')}
              </span>
              <OptionPicker
                full
                label={t('dash.chainFilter')}
                value={newChain}
                onChange={setNewChain}
                options={CHAINS.map((c) => ({
                  value: c.key,
                  label: c.chainName,
                  hint: `${c.chainId} · ${c.bech32Prefix}1…`,
                }))}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                {t('alarms.addressLabel')}
              </span>
              <input
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                placeholder={`${selectedChain.bech32Prefix}1...`}
                required
                autoComplete="off"
                aria-invalid={!addressMatchesChain}
                className="w-full rounded-xl bg-white px-3.5 py-2.5 font-mono text-sm ring-1 ring-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </label>
            {!addressMatchesChain && (
              <p className="text-xs text-red-600">
                {t('alarms.errWrongNetwork', { chain: selectedChain.chainName })}
              </p>
            )}
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                {t('alarms.labelOptional')}
              </span>
              <input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                className="w-full rounded-xl bg-white px-3.5 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              {t('alarms.alarmType')}
              <HelpTip text={t('help.alarmType')} />
              <OptionPicker
                label={t('alarms.alarmType')}
                value={newType}
                onChange={(v) => setNewType(v as AlarmType)}
                className="py-1 text-xs"
                options={ALARM_TYPES.map((ty) => ({ value: ty, label: t(TYPE_KEY[ty]) }))}
              />
            </label>
            {wallets.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-slate-500">{t('alarms.yourWallets')}</span>
                {wallets.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => {
                      // Picking a saved wallet must bring its network with it -
                      // otherwise the address and the chain disagree.
                      setNewAddress(w.address)
                      setNewChain(w.chainKey)
                      if (!newLabel) setNewLabel(w.name)
                    }}
                    className="flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs text-slate-600 ring-1 ring-slate-200 hover:text-amber-700"
                  >
                    {w.name}
                    <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-600">
                      {chainName(w.chainKey)}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <button
              disabled={busy}
              className="w-full rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-medium text-slate-900 hover:bg-amber-600 disabled:opacity-50 sm:w-auto"
            >
              {t('alarms.watch')}
            </button>
          </form>
        )}

        {/* At the cap, say so where the form would have been - a disabled
            button with no explanation reads as a bug. */}
        {atLimit && !showAddForm && (
          <p role="status" className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
            {t('alarms.watchLimitReached', { limit: watchLimit })}
          </p>
        )}

        {addresses.length === 0 ? (
          <p className="text-sm text-slate-500">{t('alarms.noWatched')}</p>
        ) : (
          <ul className="space-y-2">
            {addresses.map((w) => (
              <li key={w.id} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/70">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      {w.label || shortAddr(w.address)}
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-500">
                        {chainName(w.chain_key)}
                      </span>
                    </div>
                    <CopyAddress address={w.address} className="max-w-full text-xs text-slate-500" />
                  </div>
                  <button
                    onClick={() => setRemovingWatch({ id: w.id, label: w.label || w.address })}
                    aria-label={t('common.remove')}
                    className="shrink-0 rounded-lg p-1 text-slate-500 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 pt-3">
                  <label className="flex items-center gap-1.5 text-xs text-slate-500">
                    {t('alarms.alarmType')}
                    <OptionPicker
                      label={t('alarms.alarmType')}
                      value={w.alarm_type}
                      onChange={(v) => api.watchedSetType(w.id, v as AlarmType).then(refresh)}
                      className="py-1 text-xs"
                      options={ALARM_TYPES.map((ty) => ({ value: ty, label: t(TYPE_KEY[ty]) }))}
                    />
                  </label>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Toggle
                      checked={w.alarm_enabled === 1}
                      onChange={(v) => api.watchedToggle(w.id, v).then(refresh)}
                      label={t('alarms.alarm')}
                    />
                    {t('alarms.alarm')}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="px-1 text-xs font-medium uppercase tracking-wide text-slate-500">
            {t('alarms.alerts')}
            {unread > 0 && (
              <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold normal-case text-red-700">
                {t('alarms.new', { count: unread })}
              </span>
            )}
          </h2>
          {unread > 0 && (
            <button
              onClick={() => api.alertsMarkRead().then(refresh)}
              className="text-sm text-amber-700 hover:underline"
            >
              {t('alarms.markRead')}
            </button>
          )}
        </div>
        {alerts.length === 0 ? (
          <p className="text-sm text-slate-500">{t('alarms.noAlerts')}</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-2xl bg-white ring-1 ring-slate-200/70">
            {alerts.map((a) => {
              const chain = CHAINS.find((c) => c.key === a.chain_key) ?? DEFAULT_CHAIN
              const meta = KIND_META[a.kind] ?? KIND_META.sent
              const KindIcon = meta.Icon
              return (
                <li key={a.id} className={`px-4 py-3 ${a.is_read ? '' : 'bg-amber-50'}`}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1.5 font-medium">
                      <KindIcon className={`h-4 w-4 ${meta.color}`} />
                      {t(meta.titleKey, { label: a.label || shortAddr(a.address) })}
                    </span>
                    <span className="text-xs text-slate-500">{a.detected_at}</span>
                  </div>
                  {/* An alert states an amount, so it masks like every other. */}
                  <div className="mt-1 text-sm tabular-nums text-slate-600">
                    {a.amount
                      ? `${maskAmount(formatAmount(a.amount, chain), hidden)} ${chain.displayDenom}${
                          meta.arrow && a.recipient ? ` ${meta.arrow} ${shortAddr(a.recipient)}` : ''
                        }`
                      : t('alarms.nonTransfer')}
                  </div>
                  <a
                    href={`${chain.explorerTxUrl}${a.tx_hash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-xs text-amber-700 hover:underline"
                  >
                    {a.tx_hash.slice(0, 16)}...
                    <ExternalLink className="h-3 w-3" />
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
