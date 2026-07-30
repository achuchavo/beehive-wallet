import { useEffect, useRef, useState } from 'react'
import { Routes, Route, NavLink, Navigate, Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  SendHorizontal,
  Coins,
  Gift,
  History as HistoryIcon,
  Bell,
  Settings as SettingsIcon,
  ShieldCheck,
  BookOpen,
  Activity,
  Info,
  TriangleAlert,
  OctagonAlert,
  LogOut,
  LogIn,
  UserCircle,
  Menu as MenuIcon,
  X,
  Plus,
  Import,
} from 'lucide-react'
import { api, type Announcement } from './api'
import { useAuth } from './auth/AuthContext'
import Dashboard from './pages/Dashboard'
import Send from './pages/Send'
import Staking from './pages/Staking'
import Rewards from './pages/Rewards'
import History from './pages/History'
import Alarms from './pages/Alarms'
import Settings from './pages/Settings'
import Docs from './pages/Docs'
import UptimeAlerts from './pages/UptimeAlerts'
import Admin from './pages/Admin'
import { useT } from './i18n/I18nContext'
import { LANGUAGES } from './i18n/i18n'
import OptionPicker from './components/OptionPicker'
import BuildBadge from './components/BuildBadge'
import { useChains } from './chainStore'
import { onSettingsChanged } from './settingsSignal'

// Grouped rather than one flat list of eight. The groups answer "what am I
// here to do" - hold, stake, monitor - instead of making the user scan.
//
// "Alarms" is now "Transaction alerts": alarm suggests something is wrong,
// when these are ordinary activity notifications.
const NAV_GROUPS: { key: string; items: { to: string; key: string; Icon: typeof LayoutDashboard }[] }[] = [
  {
    key: 'navGroup.portfolio',
    items: [
      { to: '/', key: 'nav.dashboard', Icon: LayoutDashboard },
      { to: '/send', key: 'nav.send', Icon: SendHorizontal },
      { to: '/history', key: 'nav.history', Icon: HistoryIcon },
    ],
  },
  {
    key: 'navGroup.staking',
    items: [
      { to: '/staking', key: 'nav.validators', Icon: Coins },
      { to: '/rewards', key: 'nav.rewards', Icon: Gift },
    ],
  },
  {
    key: 'navGroup.monitoring',
    items: [
      { to: '/alarms', key: 'nav.alarms', Icon: Bell },
      { to: '/uptime', key: 'nav.uptime', Icon: Activity },
    ],
  },
  {
    key: 'navGroup.account',
    items: [
      { to: '/settings', key: 'nav.settings', Icon: SettingsIcon },
      { to: '/docs', key: 'nav.docs', Icon: BookOpen },
    ],
  },
]

const NAV = NAV_GROUPS.flatMap((g) => g.items)

// Mobile bottom bar. Task-focused: the things people open the app TO DO.
// Alerts moved into the drawer - they are something you react to, not a
// destination you navigate to repeatedly.
const PRIMARY_PATHS = ['/', '/send', '/staking', '/rewards']

const DRAWER_FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

const BANNER_STYLE: Record<Announcement['severity'], string> = {
  info: 'bg-blue-50 text-blue-800 border-blue-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  danger: 'bg-red-50 text-red-800 border-red-200',
}

const BANNER_ICON: Record<Announcement['severity'], typeof Info> = {
  info: Info,
  warning: TriangleAlert,
  danger: OctagonAlert,
}

function App() {
  const auth = useAuth()
  const { t, lang, setLang } = useT()
  const location = useLocation()
  const isAdmin = auth.status === 'in' && auth.isAdmin
  // Reactive chain registry: re-renders when the DB config lands, and lets us
  // warn (and block signing) if it could not be loaded.
  const { status: chainStatus } = useChains()
  const [banner, setBanner] = useState<Announcement | null>(null)
  const [uptimeEnabled, setUptimeEnabled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const drawerRef = useRef<HTMLElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const loadBanner = () =>
      api
        .announcementGet()
        .then((r) => setBanner(r.announcement))
        .catch(() => {})
    loadBanner()
    const id = setInterval(loadBanner, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  // Global feature flags. This used to run once on mount with no way to change
  // its mind, so an admin turning uptime alerts on or off never reached an
  // already-open tab - the nav entry stayed as it was until a hard reload.
  //
  // Three triggers, cheapest first: the admin screen signals immediately after
  // writing the switch, coming back to the tab re-reads it (covering a change
  // made by another admin or in another tab), and a slow poll is the backstop
  // for a tab left open and focused.
  useEffect(() => {
    const loadSettings = () =>
      api
        .settingsPublic()
        .then((r) => setUptimeEnabled(r.uptime_alerts_enabled))
        .catch(() => {})
    loadSettings()

    const onVisible = () => {
      if (document.visibilityState === 'visible') loadSettings()
    }
    const stopSignal = onSettingsChanged(loadSettings)
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    const id = setInterval(loadSettings, 5 * 60 * 1000)
    return () => {
      stopSignal()
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(id)
    }
  }, [])

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setMenuOpen(false), [location.pathname])

  // Drawer focus management: move focus in on open, trap Tab inside, close on
  // Escape, and hand focus back to the button that opened it.
  useEffect(() => {
    if (!menuOpen) return
    const panel = drawerRef.current
    // Captured now, not read in cleanup: the button is stable, and reading a
    // ref during cleanup is a footgun the linter is right to flag.
    const opener = menuButtonRef.current
    const focusables = () =>
      panel ? Array.from(panel.querySelectorAll<HTMLElement>(DRAWER_FOCUSABLE)) : []
    ;(focusables()[0] ?? panel)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false)
        return
      }
      if (e.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      opener?.focus()
    }
  }, [menuOpen])

  // Uptime is a server-gated feature; admin is role-gated. Filter within the
  // groups rather than appending, so both keep their place in the structure.
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.to !== '/uptime' || uptimeEnabled),
  }))
    .concat(
      isAdmin
        ? [{ key: 'navGroup.admin', items: [{ to: '/admin', key: 'nav.admin', Icon: ShieldCheck }] }]
        : [],
    )
    .filter((g) => g.items.length > 0)

  // Data-heavy routes get a wider desktop column; simple forms stay focused.
  const WIDE_ROUTES = ['/admin', '/staking', '/history', '/rewards', '/uptime']
  const wide = WIDE_ROUTES.includes(location.pathname)
  const primary = NAV.filter((n) => PRIMARY_PATHS.includes(n.to))
  const BannerIcon = banner ? BANNER_ICON[banner.severity] : Info

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors ${
      isActive ? 'bg-amber-50 font-medium text-amber-700' : 'text-slate-600 hover:bg-slate-100'
    }`

  const account = (
    <>
      {auth.status === 'in' ? (
        <div className="px-3">
          <div className="flex items-center gap-2 text-sm">
            <UserCircle className="h-5 w-5 shrink-0 text-slate-500" strokeWidth={1.8} />
            <span className="truncate text-slate-700" title={auth.email ?? ''}>
              {auth.email}
            </span>
          </div>
          <button
            onClick={() => auth.logout()}
            className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500 hover:text-amber-700"
          >
            <LogOut className="h-3.5 w-3.5" /> {t('account.signOut')}
          </button>
        </div>
      ) : auth.status === 'out' ? (
        <Link
          to="/alarms"
          className="mx-3 flex items-center gap-1.5 text-sm text-amber-700 hover:underline"
        >
          <LogIn className="h-4 w-4" /> {t('account.signIn')}
        </Link>
      ) : null}
    </>
  )

  // Quick actions, kept OUT of the NAV array: every nav entry is a page, and
  // these are deep links into a form on one. Rendered as a separate block so
  // the navigation's meaning stays "places you can be".
  const quickActions = (
    <div className="px-3 pt-4">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {t('dash.manage')}
      </div>
      <div className="space-y-0.5">
        <Link
          to="/settings?action=create"
          className="flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
        >
          <Plus className="h-4 w-4" strokeWidth={1.8} /> {t('dash.createWallet')}
        </Link>
        <Link
          to="/settings?action=import"
          className="flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
        >
          <Import className="h-4 w-4" strokeWidth={1.8} /> {t('dash.importWallet')}
        </Link>
      </div>
    </div>
  )

  const langSwitcher = (
    <OptionPicker
      full
      label={t('common.language')}
      value={lang}
      onChange={(v) => setLang(v as typeof lang)}
      className="text-xs"
      options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
    />
  )

  return (
    <div className="min-h-screen md:flex">
      {/* Desktop sidebar */}
      <nav className="hidden md:flex md:w-56 md:shrink-0 md:flex-col md:border-r md:border-slate-200/70 md:px-3 md:py-6">
        <div className="flex items-center gap-2 px-3 pb-4 font-semibold text-amber-700">
          <img src={`${import.meta.env.BASE_URL}beehive.ico`} alt="" className="h-6 w-6" />
          Beehive Wallet
        </div>
        <div className="mb-4 border-b border-slate-200 pb-4">{account}</div>
        <div className="space-y-3">
          {groups.map((g) => (
            <div key={g.key} className="space-y-0.5">
              <div className="px-3 pb-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                {t(g.key)}
              </div>
              {g.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.to === '/'} className={navLinkClass}>
                  <item.Icon className="h-4 w-4" strokeWidth={1.8} />
                  {t(item.key)}
                </NavLink>
              ))}
            </div>
          ))}
        </div>
        {quickActions}
        <div className="mt-auto pt-4">
          <div className="px-3">{langSwitcher}</div>
          <BuildBadge />
        </div>
      </nav>

      {/* Mobile slide-in drawer */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden ${
          menuOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={() => setMenuOpen(false)}
        aria-hidden="true"
      />
      {/* A slide-in navigation panel that covers the page is a dialog, not a
          decorated <aside>. Without these it is reachable by Tab while
          invisible, Escape does nothing, and focus stays behind it. */}
      <aside
        ref={drawerRef}
        id="mobile-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={t('nav.menu')}
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[80%] transform flex-col overflow-y-auto bg-white shadow-xl transition-transform md:hidden ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        // inert keeps the offscreen drawer out of the tab order entirely -
        // aria-hidden alone does not stop focus reaching it.
        inert={!menuOpen}
      >
        <div className="flex items-center justify-between px-4 py-4">
          <span className="flex items-center gap-2 font-semibold text-amber-700">
            <img src={`${import.meta.env.BASE_URL}beehive.ico`} alt="" className="h-6 w-6" />
            Beehive Wallet
          </span>
          <button
            onClick={() => setMenuOpen(false)}
            aria-label={t('common.close')}
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mb-3 border-y border-slate-200 py-3">{account}</div>
        <div className="space-y-3 px-2">
          {groups.map((g) => (
            <div key={g.key} className="space-y-0.5">
              <div className="px-3 pb-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                {t(g.key)}
              </div>
              {g.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  onClick={() => setMenuOpen(false)}
                  className={navLinkClass}
                >
                  <item.Icon className="h-4 w-4" strokeWidth={1.8} />
                  {t(item.key)}
                </NavLink>
              ))}
            </div>
          ))}
        </div>
        {/* Same quick actions in the drawer; closing it on tap matches the
            behaviour of every other link in here. */}
        <div className="px-2" onClick={() => setMenuOpen(false)}>
          {quickActions}
        </div>
        <div className="mt-auto py-4">
          <div className="px-4">{langSwitcher}</div>
          <BuildBadge />
        </div>
      </aside>

      {/* Mobile bottom bar: primary items (labelled) + Menu */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] pt-1 md:hidden">
        {primary.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1 text-[11px] ${
                isActive ? 'font-medium text-amber-700' : 'text-slate-500 hover:text-amber-700'
              }`
            }
          >
            <item.Icon className="h-5 w-5" strokeWidth={1.8} />
            {t(item.key)}
          </NavLink>
        ))}
        <button
          ref={menuButtonRef}
          onClick={() => setMenuOpen(true)}
          aria-expanded={menuOpen}
          aria-controls="mobile-drawer"
          aria-haspopup="dialog"
          // Active when the current page lives inside the drawer rather than on
          // the bottom bar - otherwise nothing looks selected on those pages.
          className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1 text-[11px] hover:text-amber-700 ${
            PRIMARY_PATHS.includes(location.pathname) ? 'text-slate-500' : 'font-medium text-amber-700'
          }`}
        >
          <MenuIcon className="h-5 w-5" strokeWidth={1.8} />
          {t('nav.menu')}
        </button>
      </nav>

      {/* More room than before, and more of it on desktop: the pages below are
          card stacks now, and they need air around them to read as calm. */}
      <main
        className={`mx-auto w-full flex-1 px-4 pb-24 pt-8 md:px-8 md:pb-10 ${wide ? 'max-w-5xl' : 'max-w-3xl'}`}
      >
        {banner && (
          <div
            className={`mb-5 flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm ${BANNER_STYLE[banner.severity]}`}
          >
            <BannerIcon className="h-4 w-4 shrink-0" />
            {banner.message}
          </div>
        )}
        {/* Signing is blocked while this is showing (see wallet/tx.ts), so say
            so rather than letting a transaction fail with a cryptic error. */}
        {chainStatus !== 'ready' && (
          <div
            role="status"
            className={`mb-5 flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm ${
              chainStatus === 'error'
                ? 'border-red-200 bg-red-50 text-red-800'
                : 'border-slate-200 bg-slate-50 text-slate-600'
            }`}
          >
            <TriangleAlert className="h-4 w-4 shrink-0" />
            {chainStatus === 'error' ? t('chains.loadError') : t('chains.loading')}
          </div>
        )}
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/send" element={<Send />} />
          <Route path="/staking" element={<Staking />} />
          <Route path="/rewards" element={<Rewards />} />
          <Route path="/history" element={<History />} />
          <Route path="/alarms" element={<Alarms />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/uptime" element={<UptimeAlerts />} />
          <Route
            path="/admin"
            element={
              auth.status === 'loading' ? (
                <p className="text-sm text-slate-500">{t('common.loading')}</p>
              ) : isAdmin ? (
                <Admin />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
        </Routes>
      </main>
    </div>
  )
}

export default App
