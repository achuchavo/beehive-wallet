import { useCallback, useEffect, useState } from 'react'
import {
  BellRing,
  Eye,
  ArrowUpRight,
  ArrowDownLeft,
  Undo2,
  ExternalLink,
  CircleCheck,
  ChevronRight,
  Plus,
  Trash2,
  UserCog,
  X,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import {
  api,
  ApiError,
  type WatchedAddress,
  type WalletAlert,
  type AlarmType,
  type AlertKind,
  type WatchQuote,
  type WatchIntent,
} from '../api'
import { DEFAULT_CHAIN, formatAmount, CHAINS, findChain, chainForAddress } from '../chains'
import { useWallet } from '../wallet/WalletContext'
import { useAuth } from '../auth/AuthContext'
import { useT } from '../i18n/I18nContext'
import PasswordInput from '../components/PasswordInput'
import Modal from '../components/Modal'
import BottomSheet from '../components/BottomSheet'
import Tabs, { TabPanel } from '../components/Tabs'
import CopyAddress from '../components/CopyAddress'
import HelpTip from '../components/HelpTip'
import OptionPicker from '../components/OptionPicker'
import PageHeader from '../components/PageHeader'
import Toggle from '../components/Toggle'
import Checkbox from '../components/Checkbox'
import ConfirmDelete from '../components/ConfirmDelete'
import WatchPaymentDialog from '../components/WatchPaymentDialog'
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
  // Watched list and alert feed are two jobs on one page; tabs give each its
  // own screen instead of a single long scroll past the other.
  const [tab, setTab] = useState<'watched' | 'alerts'>('watched')
  // Account linking and push setup are configuration, visited rarely - they
  // live in a modal behind one header button rather than above the content.
  const [accountOpen, setAccountOpen] = useState(false)

  // Per-chain allowance, so the page can say what the next alert costs before
  // the user fills anything in - the fee should never be a surprise raised by a
  // rejected form.
  const [quotes, setQuotes] = useState<Record<string, WatchQuote>>({})

  // A payment in progress: the locked quote plus what it is buying.
  const [paying, setPaying] = useState<{
    chainKey: string
    quote: WatchQuote
    intent: WatchIntent
    pending?: { address: string; label: string; alarmType: AlarmType }
  } | null>(null)

  const refresh = useCallback(async () => {
    try {
      // me() rides along: the suggestion list offers the account's linked
      // address, so linking or unlinking one has to show up here without a
      // remount. Same request the page already needed, one fewer round trip
      // than a separate effect.
      const [w, a, me] = await Promise.all([api.watchedList(), api.alertsList(), api.me()])
      setMainAddress(me.main_address ?? null)
      setAddresses(w.addresses)
      if (w.limit > 0) setWatchLimit(w.limit)
      setQuotes(w.quotes ?? {})
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

  // The address linked to this ACCOUNT. Offered as a suggestion alongside the
  // wallets held in this browser, because they are not the same set: an account
  // can be signed in on a device that holds none of its wallets, and the linked
  // address is usually the first thing someone wants to watch.
  const [mainAddress, setMainAddress] = useState<string | null>(null)

  const selectedChain = CHAINS.find((c) => c.key === newChain) ?? DEFAULT_CHAIN

  /**
   * Addresses worth offering, newest information first.
   *
   * Deduplicated by address (a linked wallet is usually also a stored one),
   * with the ones on the currently selected network first so the relevant
   * choices are not buried behind wallets for a chain you are not filing under.
   */
  const suggestions = (() => {
    const seen = new Set<string>()
    const out: {
      address: string
      chainKey: string
      name: string
      isMain: boolean
      watched: boolean
    }[] = []

    const push = (address: string, chainKey: string, name: string, isMain: boolean) => {
      if (!address || seen.has(address)) return
      seen.add(address)
      out.push({
        address,
        chainKey,
        name,
        isMain,
        watched: addresses.some((w) => w.address === address && w.chain_key === chainKey),
      })
    }

    if (mainAddress) {
      // Resolve the network from the address itself: the linked address carries
      // no chain key, and filing it under the wrong one would mean the watcher
      // polls a node the address does not exist on.
      const chain = chainForAddress(mainAddress)
      const wallet = wallets.find((w) => w.address === mainAddress)
      push(mainAddress, chain.key, wallet?.name ?? t('alarms.mainAddress'), true)
    }
    for (const w of wallets) push(w.address, w.chainKey, w.name, false)

    return out.sort(
      (a, b) => Number(b.chainKey === newChain) - Number(a.chainKey === newChain),
    )
  })()
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
      // 402: this one is over the chain's free allowance. Move to the payment
      // flow rather than reporting a failure - nothing has gone wrong, there is
      // simply a price. The server told us what it is.
      if (err instanceof ApiError && err.code === 'payment_required') {
        await startPayment(newChain, {
          address: newAddress.trim(),
          label: newLabel.trim(),
          alarmType: newType,
        })
        setBusy(false)
        return
      }
      setError(err instanceof Error ? err.message : 'Could not add address')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Ask for a locked quote and open the payment dialog.
   *
   * The quote (and its memo code) comes from the server, so the price shown is
   * the price that will be accepted even if an admin changes it meanwhile.
   */
  async function startPayment(
    chainKey: string,
    pending?: { address: string; label: string; alarmType: AlarmType },
    watchId?: number,
  ) {
    try {
      const r = await api.watchQuote({
        chain_key: chainKey,
        address: pending?.address,
        kind: watchId ? 'renew' : 'new',
        watch_id: watchId,
      })
      if (!r.intent) {
        // Nothing to sell. Say which of the two reasons it is, because
        // "switched off" and "sold out" call for different responses.
        setError(
          r.quote.metered && !r.quote.alerts_enabled
            ? t('pay.alertsOff', { chain: chainName(chainKey) })
            : t('pay.notSellable'),
        )
        return
      }
      setPaying({ chainKey, quote: r.quote, intent: r.intent, pending })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the payment')
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

      {paying && findChain(paying.chainKey) && (
        <WatchPaymentDialog
          chain={findChain(paying.chainKey)!}
          quote={paying.quote}
          intent={paying.intent}
          pending={paying.pending}
          onDone={() => {
            setPaying(null)
            setNewAddress('')
            setNewLabel('')
            setNewType('both')
            setShowAddForm(false)
            refresh()
          }}
          onCancel={() => setPaying(null)}
        />
      )}
      <PageHeader title={t('alarms.title')} help={t('help.account')}>
        <span className="hidden text-sm text-slate-500 sm:inline">{email}</span>
        <button
          onClick={() => setAccountOpen(true)}
          className="flex items-center gap-1.5 rounded-xl bg-white px-2.5 py-1.5 text-sm text-slate-600 ring-1 ring-slate-200 hover:text-amber-700"
        >
          <UserCog className="h-4 w-4" strokeWidth={1.8} />
          <span className="hidden sm:inline">{t('alarms.accountSettings')}</span>
        </button>
        <button onClick={logout} className="text-sm text-slate-500 hover:text-amber-700">
          {t('account.signOut')}
        </button>
      </PageHeader>

      {/* Rarely-touched configuration, out of the page's spine: link an
          address, set up push. The cards inside are unchanged. */}
      {accountOpen && (
        <Modal title={t('alarms.accountSettings')} onClose={() => setAccountOpen(false)}>
          <div className="space-y-3">
            <MainAddressCard />
            <PushSettings />
          </div>
        </Modal>
      )}

      {error && (
        <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <Tabs
        idPrefix="alarms"
        label={t('alarms.title')}
        activeId={tab}
        onChange={(id) => setTab(id as 'watched' | 'alerts')}
        items={[
          { id: 'watched', label: t('alarms.watched') },
          // The unread count rides on the tab label so it stays visible from
          // the other tab - the badge that used to sit on the section heading.
          { id: 'alerts', label: unread > 0 ? `${t('alarms.alerts')} (${unread})` : t('alarms.alerts') },
        ]}
      />

      <TabPanel id="watched" activeId={tab} idPrefix="alarms">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 px-1 text-xs text-slate-500">
            <Eye className="h-3.5 w-3.5" strokeWidth={1.8} />
            {/* The cap used to be invisible until the server rejected a filled-in
                form. Stating it up front is the whole point. */}
            <span className="tabular-nums">
              {t('alarms.watchedCount', { count: addresses.length, limit: watchLimit })}
            </span>
            <HelpTip text={t('help.watchLimit', { limit: watchLimit })} />
          </span>
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
            {/* The price of the NEXT alert on the selected network, stated
                before the form is filled in. A fee that only appears as a
                rejected submission reads as a failure rather than a price. */}
            {(() => {
              const q = quotes[newChain]
              if (!q?.metered) return null
              // An exempt account is not working through an allowance, so it is
              // not shown one ticking down towards a limit it will never reach.
              if (q.exempt) {
                return (
                  <p className="flex items-center gap-1.5 text-xs text-slate-500">
                    {t('pay.exempt')}
                    <HelpTip text={t('help.payExempt')} align="start" />
                  </p>
                )
              }
              if (q.next_is_free) {
                const left = Math.max(0, q.free_cap - q.free_used)
                return (
                  <p className="flex items-center gap-1.5 text-xs text-slate-500">
                    {t('pay.freeRemaining', { left, chain: selectedChain.chainName })}
                    <HelpTip text={t('help.freeCap')} align="start" />
                  </p>
                )
              }
              return (
                <p className="flex items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {q.sellable
                    ? t('pay.feeLine', {
                        amount: formatAmount(q.fee_amount, selectedChain),
                        denom: selectedChain.displayDenom,
                      })
                    : t('pay.notSellable')}
                  <HelpTip text={t('help.paidAlerts')} align="start" />
                </p>
              )
            })()}
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

            {/* Addresses this account already knows about, offered right under
                the field they fill in rather than below the whole form. An
                address is 45 characters of base32 that nobody should be
                retyping, and the ones already being watched are shown disabled
                instead of hidden - "why is my wallet missing?" is a worse
                question than seeing it marked as already covered. */}
            {suggestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-slate-500">{t('alarms.yourWallets')}</span>
                {suggestions.map((s) => (
                  <button
                    key={s.address}
                    type="button"
                    disabled={s.watched}
                    title={s.watched ? t('alarms.alreadyWatching') : s.address}
                    onClick={() => {
                      // Picking a saved address must bring its network with it -
                      // otherwise the address and the chain disagree.
                      setNewAddress(s.address)
                      setNewChain(s.chainKey)
                      if (!newLabel && s.name) setNewLabel(s.name)
                    }}
                    className="flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs text-slate-600 ring-1 ring-slate-200 hover:text-amber-700 disabled:cursor-not-allowed disabled:text-slate-400 disabled:line-through disabled:hover:text-slate-400"
                  >
                    {s.name}
                    {s.isMain && (
                      <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-800">
                        {t('alarms.mainAddressShort')}
                      </span>
                    )}
                    <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-600">
                      {chainName(s.chainKey)}
                    </span>
                  </button>
                ))}
              </div>
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
              <WatchedRow
                key={w.id}
                w={w}
                chainLabel={chainName(w.chain_key)}
                shortLabel={w.label || shortAddr(w.address)}
                onSetType={(v) => api.watchedSetType(w.id, v).then(refresh)}
                onToggle={(v) => api.watchedToggle(w.id, v).then(refresh)}
                onRemove={() => setRemovingWatch({ id: w.id, label: w.label || w.address })}
                onRenew={() => startPayment(w.chain_key, undefined, w.id)}
              />
            ))}
          </ul>
        )}
      </section>
      </TabPanel>

      <TabPanel id="alerts" activeId={tab} idPrefix="alarms">
      <section className="space-y-3">
        {unread > 0 && (
          <div className="flex justify-end">
            <button
              onClick={() => api.alertsMarkRead().then(refresh)}
              className="text-sm text-amber-700 hover:underline"
            >
              {t('alarms.markRead')}
            </button>
          </div>
        )}
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
      </TabPanel>
    </div>
  )
}

/**
 * One watched address: a quiet row - label, chain, ONE state chip, address -
 * with everything operable (type, on/off, renewal, removal) behind a
 * BottomSheet. The row used to carry eight controls; ten of them read as a
 * settings wall rather than a list.
 */
function WatchedRow({
  w,
  chainLabel,
  shortLabel,
  onSetType,
  onToggle,
  onRemove,
  onRenew,
}: {
  w: WatchedAddress
  chainLabel: string
  shortLabel: string
  onSetType: (v: AlarmType) => void
  onToggle: (v: boolean) => void
  onRemove: () => void
  onRenew: () => void
}) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const lapsed = w.payment_state === 'lapsed'
  const off = w.alarm_enabled !== 1

  // One chip, worst news first: lapsed beats off beats paid-and-fine. "Free
  // and on" is the normal state and says nothing.
  const chip = lapsed ? (
    <span className="flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-normal text-amber-800">
      <TriangleAlert className="h-3 w-3" /> {t('alarms.lapsed')}
    </span>
  ) : off ? (
    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-normal text-slate-500">
      {t('alarms.alarmOff')}
    </span>
  ) : w.tier === 'paid' ? (
    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-normal text-amber-800">
      {w.paid_until ? t('pay.paidUntil', { date: w.paid_until.slice(0, 10) }) : t('pay.paidForever')}
    </span>
  ) : null

  return (
    <li className="rounded-2xl bg-white ring-1 ring-slate-200/70">
      {/* The row is the button; the copyable address sits below it because a
          button cannot contain a button (same split as the wallet rows). */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={t('alarms.rowSettings', { label: shortLabel })}
        className="flex w-full items-center gap-3 px-4 pb-1 pt-3 text-left"
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-sm font-medium">
          {shortLabel}
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-500">
            {chainLabel}
          </span>
          {chip}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
      <div className="px-4 pb-3">
        <CopyAddress address={w.address} className="max-w-full text-xs text-slate-500" />
      </div>

      {open && (
        <BottomSheet
          title={shortLabel}
          subtitle={`${chainLabel} · ${w.address.slice(0, 14)}...${w.address.slice(-6)}`}
          onClose={() => setOpen(false)}
        >
          <div className="space-y-4">
            {/* A paused alert has to say so where it is managed. The address,
                its label and its history are all still here - only the
                watching stopped - so the prompt is a renewal, not a recovery. */}
            {lapsed && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <span className="flex items-center gap-1.5">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                  {t('pay.lapsedNote')}
                  <HelpTip text={t('help.payLapsed')} align="start" />
                </span>
                <button
                  onClick={() => {
                    setOpen(false)
                    onRenew()
                  }}
                  className="shrink-0 rounded-lg bg-amber-500 px-3 py-1 font-medium text-slate-900 hover:bg-amber-600"
                >
                  {t('pay.renew')}
                </button>
              </div>
            )}
            {w.tier === 'paid' && !lapsed && (
              <p className="flex items-center gap-1.5 text-xs text-slate-500">
                {w.paid_until
                  ? t('pay.paidUntil', { date: w.paid_until.slice(0, 10) })
                  : t('pay.paidForever')}
                <HelpTip text={t('help.payCadence')} align="start" />
              </p>
            )}
            <div className="flex items-center justify-between gap-2 text-sm text-slate-600">
              <span className="flex items-center gap-1.5">
                {t('alarms.alarmType')}
                <HelpTip text={t('help.alarmType')} />
              </span>
              <OptionPicker
                label={t('alarms.alarmType')}
                value={w.alarm_type}
                onChange={(v) => onSetType(v as AlarmType)}
                className="py-1.5"
                options={ALARM_TYPES.map((ty) => ({ value: ty, label: t(TYPE_KEY[ty]) }))}
              />
            </div>
            <div className="flex items-center justify-between gap-2 text-sm text-slate-600">
              <span>{t('alarms.alarm')}</span>
              <Toggle
                checked={w.alarm_enabled === 1}
                onChange={onToggle}
                label={t('alarms.alarm')}
              />
            </div>
            <button
              onClick={() => {
                setOpen(false)
                onRemove()
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-200 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" /> {t('common.remove')}
            </button>
          </div>
        </BottomSheet>
      )}
    </li>
  )
}
