import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import {
  api,
  type AdminOverview,
  type UserAction,
  type AdminUptimeSub,
  type AdminFeature,
  type Announcement,
  type PermLevel,
  ADMIN_FEATURES,
  PERM_NONE,
  PERM_READ,
  PERM_WRITE,
} from '../api'
import AnnouncementModal from '../components/AnnouncementModal'
import { CHAINS, DEFAULT_CHAIN, formatAmount } from '../chains'
import { useT } from '../i18n/I18nContext'
import ChainManager from './ChainManager'
import AlertPricingManager from './AlertPricingManager'
import StakingValidatorsManager from './StakingValidatorsManager'
import UserWatchesManager from './UserWatchesManager'
import OptionPicker from '../components/OptionPicker'
import HelpTip from '../components/HelpTip'
import ConfirmDelete from '../components/ConfirmDelete'
import { notifySettingsChanged } from '../settingsSignal'

type Tab =
  | 'overview'
  | 'users'
  | 'access'
  | 'chains'
  | 'announcements'
  | 'uptime'
  | 'pricing'
  | 'watches'
  | 'staking'

/** Label key per feature, so the access editor reads as English rather than as
 *  database identifiers. */
const FEATURE_KEY: Record<AdminFeature, string> = {
  users: 'admin.featureUsers',
  roles: 'admin.featureRoles',
  chains: 'admin.featureChains',
  announcements: 'admin.featureAnnouncements',
  uptime: 'admin.featureUptime',
  wallet_alerts: 'admin.featureWalletAlerts',
  staking: 'admin.featureStaking',
  alert_pricing: 'admin.featureAlertPricing',
  user_watches: 'admin.featureUserWatches',
  settings: 'admin.featureSettings',
}

export default function Admin() {
  const { t } = useT()
  const [data, setData] = useState<AdminOverview | null>(null)
  const [levels, setLevels] = useState<Partial<Record<AdminFeature, PermLevel>>>({})
  const [isSuper, setIsSuper] = useState(false)
  // Who we are. Every self-edit is refused server-side, so the access screen
  // needs this to mark its own row instead of offering a control that 403s.
  const [meId, setMeId] = useState<number | null>(null)
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

  // Own identity and per-feature levels. Folded into the SAME poll as the
  // overview: read once, the screen kept offering controls a super admin had
  // just revoked (harmless - every endpoint re-checks - but it looked like the
  // change had not taken) and kept hiding ones just granted.
  const loadMe = useCallback(
    () =>
      api
        .me()
        .then((r) => {
          setLevels(r.admin_levels ?? {})
          setIsSuper(r.is_super_admin === true)
          setMeId(r.id ?? null)
        })
        .catch(() => {}),
    [],
  )

  useEffect(() => {
    loadMe()
    load()
    const t = setInterval(() => {
      void loadMe()
      void load()
    }, 30000)
    return () => clearInterval(t)
  }, [load, loadMe])

  /**
   * What this admin holds for a feature. Presentation only - every endpoint
   * enforces its own level, so this can hide a control but never protect data.
   */
  const levelOf = (feature: AdminFeature): PermLevel => levels[feature] ?? PERM_NONE
  const can = (feature: AdminFeature) => levelOf(feature) >= PERM_READ
  const canWrite = (feature: AdminFeature) => levelOf(feature) >= PERM_WRITE

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
    // Visible with roles at read or better - a read-only holder can see who has
    // what without being able to change it. The server refuses the write.
    { id: 'access', label: 'Access', show: can('roles') },
    { id: 'chains', label: 'Chains', show: can('chains') },
    { id: 'announcements', label: 'Announcements', show: can('announcements') },
    { id: 'uptime', label: 'Uptime', show: can('uptime') },
    { id: 'staking', label: t('admin.tabStaking'), show: can('staking') },
    { id: 'pricing', label: t('admin.tabPricing'), show: can('alert_pricing') },
    { id: 'watches', label: t('admin.tabWatches'), show: can('user_watches') },
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
                {/* Healthy with nothing to poll is a normal state for a new
                    deployment, and saying only "healthy" invites the question
                    "then why are there no alerts?". */}
                {watcherHealthy && stats.watcher_watched === 0 && ' · idle, no addresses watched'}
              </span>
              <span>
                Last beat:{' '}
                {stats.watcher_last_run
                  ? `${stats.watcher_last_run} (${stats.watcher_age_seconds}s ago)`
                  : 'never'}
              </span>
            </div>
          )}

          {/* Matches admin_setting_set.php's own guard, which is now the
              'settings' feature at write rather than super-admin only. */}
          {canWrite('settings') && <WatchLimitEditor onError={setError} />}

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
        <UptimeManager canToggle={canWrite('settings')} onError={setError} />
      )}

      {activeTab === 'staking' && can('staking') && (
        <StakingValidatorsManager level={levelOf('staking')} onError={setError} />
      )}

      {activeTab === 'pricing' && can('alert_pricing') && (
        <AlertPricingManager level={levelOf('alert_pricing')} onError={setError} />
      )}

      {activeTab === 'watches' && can('user_watches') && <UserWatchesManager onError={setError} />}

      {activeTab === 'access' && can('roles') && (
        <RoleManager
          users={data.users ?? []}
          meId={meId}
          actorLevels={levels}
          actorIsSuper={isSuper}
          canWrite={canWrite('roles')}
          onChanged={load}
          onError={setError}
        />
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

/**
 * Grant and revoke admin access, per feature, at no / view / view-and-change.
 *
 * Every rule this screen appears to enforce is ALSO enforced server-side in
 * admin_role_update.php with the rows locked - no self-edit, super admin only
 * for super status and for granting `roles`, and never granting above your own
 * level. What happens here is only to avoid offering a control that will be
 * refused; it is not, and must not become, the enforcement.
 */
function RoleManager({
  users,
  meId,
  actorLevels,
  actorIsSuper,
  canWrite,
  onChanged,
  onError,
}: {
  users: NonNullable<AdminOverview['users']>
  /** The signed-in admin's own id, or null while it is still loading. */
  meId: number | null
  actorLevels: Partial<Record<AdminFeature, PermLevel>>
  actorIsSuper: boolean
  canWrite: boolean
  onChanged: () => void
  onError: (msg: string) => void
}) {
  const { t } = useT()
  const [editing, setEditing] = useState<number | null>(null)
  const [isSuper, setIsSuper] = useState(false)
  const [feats, setFeats] = useState<Partial<Record<AdminFeature, PermLevel>>>({})
  const [busy, setBusy] = useState(false)

  // Being an admin is a CONSEQUENCE of holding at least one grant, not a
  // separate box to tick. "Admin with no features" was a state you could
  // previously create: it let someone into the admin area to see nothing at
  // all. The server derives the same way, so the two cannot disagree.
  const grantedCount = Object.keys(feats).length

  /** Grants come back as "chains:2,uptime:1". */
  function parseFeatures(raw: string | null): Partial<Record<AdminFeature, PermLevel>> {
    const out: Partial<Record<AdminFeature, PermLevel>> = {}
    for (const part of (raw ?? '').split(',')) {
      const [name, lvl] = part.split(':')
      const feature = ADMIN_FEATURES.find((f) => f === name)
      if (!feature) continue
      // A grant written before levels existed carries no suffix and has always
      // meant full access, so that is what it stays.
      out[feature] = lvl === '1' ? PERM_READ : PERM_WRITE
    }
    return out
  }

  /** The highest level the signed-in admin may hand out for this feature. */
  function ceilingFor(feature: AdminFeature): PermLevel {
    if (actorIsSuper) return PERM_WRITE
    if (feature === 'roles') return PERM_NONE // super admins only
    return actorLevels[feature] ?? PERM_NONE
  }

  function startEdit(u: NonNullable<AdminOverview['users']>[number]) {
    setEditing(u.id)
    setIsSuper(u.is_super_admin === 1)
    setFeats(parseFeatures(u.features))
  }

  async function save(id: number) {
    setBusy(true)
    onError('')
    try {
      // is_admin is derived, never asked for: any grant makes an admin, and a
      // super admin implies one. The server derives it the same way.
      await api.adminRoleUpdate(id, isSuper || grantedCount > 0, isSuper, feats)
      setEditing(null)
      onChanged()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  function setLevel(f: AdminFeature, level: PermLevel) {
    setFeats((prev) => {
      const next = { ...prev }
      if (level === PERM_NONE) delete next[f]
      else next[f] = level
      return next
    })
  }

  /** Every feature the actor can actually hand out, at their own ceiling. */
  function grantAll() {
    const next: Partial<Record<AdminFeature, PermLevel>> = {}
    for (const f of ADMIN_FEATURES) {
      const ceiling = ceilingFor(f)
      if (ceiling > PERM_NONE) next[f] = ceiling
    }
    setFeats(next)
  }

  function clearAll() {
    setFeats({})
  }

  /**
   * Why this row cannot be edited, or '' if it can.
   *
   * Each case mirrors a rule admin_role_update.php enforces with the rows
   * locked. Duplicating them here does NOT make the UI the enforcement - the
   * server refuses regardless - it stops the screen offering a control that can
   * only ever end in a 403, which is what made this tab feel broken.
   */
  function blockedReason(u: NonNullable<AdminOverview['users']>[number]): string {
    if (!canWrite) return t('admin.readOnlyBadge')
    if (meId !== null && u.id === meId) return t('admin.ownRoleNote')
    // Only a super admin may act on another admin or super admin.
    if (!actorIsSuper && (u.is_admin === 1 || u.is_super_admin === 1)) {
      return t('admin.cannotEditAdmin')
    }
    return ''
  }

  // The last active super admin cannot be demoted, so the checkbox that would
  // do it is held. Counted from the same list the screen renders; the server
  // counts again inside the transaction, which is what actually guarantees it.
  const activeSupers = users.filter((u) => u.is_super_admin === 1 && u.is_disabled !== 1)
  const isLastSuper = (u: NonNullable<AdminOverview['users']>[number]) =>
    u.is_super_admin === 1 && activeSupers.length <= 1

  function summarise(u: NonNullable<AdminOverview['users']>[number]): string {
    if (u.is_super_admin === 1) return t('admin.roleSuper')
    if (u.is_admin !== 1) return t('admin.roleUser')
    const parsed = parseFeatures(u.features)
    const names = (Object.keys(parsed) as AdminFeature[]).map(
      (f) => `${t(FEATURE_KEY[f])} (${parsed[f] === PERM_READ ? t('admin.levelRead') : t('admin.levelWrite')})`,
    )
    return `${t('admin.roleAdmin')} · ${names.length ? names.join(', ') : '—'}`
  }

  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 font-medium">
        <ShieldCheck className="h-4 w-4 text-purple-500" /> {t('admin.accessTitle')}
        <HelpTip text={t('help.adminLevels')} />
      </h2>
      <p className="text-sm text-slate-500">{t('admin.accessIntro')}</p>
      {!canWrite && (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {t('admin.readOnlyNote')}
        </p>
      )}
      <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
        {users.length === 0 && (
          <p className="px-4 py-3 text-sm text-slate-500">{t('admin.noUsers')}</p>
        )}
        {users.map((u) => {
        const blocked = blockedReason(u)
        return (
          <div key={u.id} className="px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 truncate text-sm font-medium">
                  {u.email}
                  {meId !== null && u.id === meId && (
                    <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-normal text-slate-600">
                      {t('admin.you')}
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500">{summarise(u)}</div>
              </div>
              {blocked ? (
                // Say why, rather than showing a control that does nothing.
                <span className="shrink-0 text-xs text-slate-400">{blocked}</span>
              ) : (
                <button
                  onClick={() => (editing === u.id ? setEditing(null) : startEdit(u))}
                  className="shrink-0 text-xs text-amber-700 hover:underline"
                >
                  {editing === u.id ? t('common.cancel') : t('admin.editAccess')}
                </button>
              )}
            </div>
            {editing === u.id && (
              <div className="mt-3 space-y-3 rounded-lg bg-slate-50 p-3">
                {/* THE per-feature matrix, always visible.
                    It used to render only when the target was already a
                    non-super admin, which meant the main control of this screen
                    was unreachable for a plain user (until you ticked "Admin")
                    and for a super admin (at all). Being an admin is now simply
                    a CONSEQUENCE of holding at least one grant, so there is no
                    role checkbox to find first. */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                      {t('admin.featureAccess')}
                      <HelpTip text={t('help.adminLevels')} align="start" />
                    </span>
                    {!isSuper && (
                      <div className="flex gap-2 text-xs">
                        <button type="button" onClick={grantAll} className="text-amber-700 hover:underline">
                          {t('admin.grantAll')}
                        </button>
                        <button type="button" onClick={clearAll} className="text-slate-500 hover:underline">
                          {t('admin.clearAll')}
                        </button>
                      </div>
                    )}
                  </div>

                  {ADMIN_FEATURES.map((f) => {
                    const ceiling = ceilingFor(f)
                    // A super admin holds everything implicitly, including any
                    // feature added in future. Shown as such, and locked, so it
                    // is obvious WHY there is nothing to choose here.
                    const current = isSuper ? PERM_WRITE : (feats[f] ?? PERM_NONE)
                    const options = [
                      { value: String(PERM_NONE), label: t('admin.levelNone') },
                      ...(ceiling >= PERM_READ
                        ? [{ value: String(PERM_READ), label: t('admin.levelRead') }]
                        : []),
                      ...(ceiling >= PERM_WRITE
                        ? [{ value: String(PERM_WRITE), label: t('admin.levelWrite') }]
                        : []),
                    ]
                    return (
                      <div key={f} className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-sm">
                          {t(FEATURE_KEY[f])}
                          {f === 'roles' && <HelpTip text={t('help.adminRoles')} align="start" />}
                          {f === 'settings' && (
                            <HelpTip text={t('help.adminSettings')} align="start" />
                          )}
                          {f === 'user_watches' && (
                            <HelpTip text={t('help.adminUserWatches')} align="start" />
                          )}
                          {f === 'alert_pricing' && (
                            <HelpTip text={t('help.adminAlertPricingFeature')} align="start" />
                          )}
                        </span>
                        {isSuper ? (
                          <span className="text-xs font-medium text-purple-700">
                            {t('admin.levelWrite')}
                          </span>
                        ) : ceiling === PERM_NONE ? (
                          // You cannot grant what you do not hold, and only a
                          // super admin can grant `roles`.
                          <span className="text-xs text-slate-400">
                            {f === 'roles' ? t('admin.rolesSuperOnly') : t('admin.cannotGrantAbove')}
                          </span>
                        ) : (
                          <OptionPicker
                            label={t(FEATURE_KEY[f])}
                            value={String(current)}
                            onChange={(v) => setLevel(f, Number(v) as PermLevel)}
                            className="py-1 text-xs"
                            options={options}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Super admin is deliberately NOT "has every box ticked" - see
                    the note beside it. Kept last, because it is the exception
                    rather than the way access is normally given. */}
                <div className="border-t border-slate-200 pt-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={isSuper}
                      // Only a super admin may create or remove one, and the
                      // last active one is held so the deployment is never left
                      // without anybody able to administer it.
                      disabled={!actorIsSuper || isLastSuper(u)}
                      onChange={(e) => setIsSuper(e.target.checked)}
                    />
                    {t('admin.roleSuper')}
                    <HelpTip text={t('help.adminSuperVsAll')} />
                  </label>
                  {isLastSuper(u) && (
                    <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      {t('admin.lastSuperNote')}
                    </p>
                  )}
                </div>

                {/* What this will actually do, in a sentence. */}
                <p className="text-xs text-slate-500">
                  {isSuper
                    ? t('admin.willBeSuper')
                    : grantedCount === 0
                      ? t('admin.willBeUser')
                      : t('admin.willBeAdmin', { count: grantedCount })}
                </p>

                <button
                  onClick={() => save(u.id)}
                  disabled={busy}
                  className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-amber-600 disabled:opacity-50"
                >
                  {busy ? t('alarms.working') : t('admin.saveAccess')}
                </button>
              </div>
            )}
          </div>
        )
        })}
      </div>
    </section>
  )
}

const ANNOUNCE_FIELD =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none'

function AnnouncementEditor({ onChanged }: { onChanged: () => void }) {
  const [current, setCurrent] = useState<Announcement | null>(null)
  const [message, setMessage] = useState('')
  const [body, setBody] = useState('')
  const [ctaLabel, setCtaLabel] = useState('')
  const [ctaPath, setCtaPath] = useState('')
  const [severity, setSeverity] = useState('info')
  const [hours, setHours] = useState('24')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [previewing, setPreviewing] = useState(false)

  const refresh = useCallback(
    () => api.announcementGet().then((r) => setCurrent(r.announcement)).catch(() => {}),
    [],
  )

  useEffect(() => {
    refresh()
  }, [refresh])

  // The exact object the users' modal will receive, so Preview cannot drift
  // from reality. id 0 is never a stored announcement.
  const draft: Announcement = {
    id: 0,
    message: message.trim() || '(untitled)',
    body: body.trim(),
    cta_label: ctaLabel.trim(),
    cta_path: ctaPath.trim(),
    severity: severity as Announcement['severity'],
  }

  async function publish(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.adminAnnouncementSet({
        message: message.trim(),
        body: body.trim(),
        cta_label: ctaLabel.trim(),
        cta_path: ctaPath.trim(),
        severity,
        expires_hours: Number(hours) || 0,
      })
      setMessage('')
      setBody('')
      setCtaLabel('')
      setCtaPath('')
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
    <section className="space-y-3">
      <h2 className="font-medium">Announcement</h2>
      <p className="text-sm text-slate-500">
        Info and warning announcements open as a popup users can dismiss or snooze for a day;
        danger stays as a permanent inline banner (no popup, no snooze).
      </p>
      {current ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
          <span className="min-w-0">
            <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
              {current.severity}
            </span>
            {current.message}
            {current.cta_label !== '' && (
              <span className="ml-2 text-xs text-slate-500">
                [{current.cta_label} → {current.cta_path}]
              </span>
            )}
          </span>
          <button
            onClick={clear}
            disabled={busy}
            className="shrink-0 text-xs text-red-600 hover:underline disabled:opacity-50"
          >
            Take down
          </button>
        </div>
      ) : (
        <p className="text-sm text-slate-500">No active announcement.</p>
      )}
      <form onSubmit={publish} className="space-y-2">
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Title (shown as the popup heading, or the banner text for danger)"
          aria-label="Announcement title"
          required
          maxLength={300}
          className={ANNOUNCE_FIELD}
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={'Body (optional). Supports ## heading, **bold**, - lists, [label](/path) or [label](https://…). Blank line = new paragraph.'}
          aria-label="Announcement body"
          rows={6}
          maxLength={4000}
          className={`${ANNOUNCE_FIELD} font-mono text-xs leading-relaxed`}
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={ctaLabel}
            onChange={(e) => setCtaLabel(e.target.value)}
            placeholder="CTA button label (optional)"
            aria-label="CTA button label"
            maxLength={80}
            className={ANNOUNCE_FIELD}
          />
          <input
            value={ctaPath}
            onChange={(e) => setCtaPath(e.target.value)}
            placeholder="CTA path, e.g. /alarms"
            aria-label="CTA path"
            maxLength={200}
            className={`${ANNOUNCE_FIELD} font-mono`}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OptionPicker
            label="Severity"
            value={severity}
            onChange={setSeverity}
            className="py-2"
            options={[
              { value: 'info', label: 'Info' },
              { value: 'warning', label: 'Warning' },
              { value: 'danger', label: 'Danger (inline banner)' },
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
              { value: '168', label: '7 days' },
            ]}
          />
          <button
            type="button"
            onClick={() => setPreviewing(true)}
            disabled={severity === 'danger'}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:border-amber-500 disabled:opacity-50"
          >
            Preview
          </button>
          <button
            disabled={busy}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-amber-600 disabled:opacity-50"
          >
            Publish
          </button>
        </div>
      </form>
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {previewing && (
        <AnnouncementModal
          announcement={draft}
          onDismiss={() => setPreviewing(false)}
          onSnooze={() => setPreviewing(false)}
          onCta={() => setPreviewing(false)}
        />
      )}
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
      notifySettingsChanged()
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

/** `canToggle` mirrors admin_setting_set.php's guard: the global on/off switch
 *  lives in app_settings, so it needs the 'settings' feature at write. */
function UptimeManager({
  canToggle,
  onError,
}: {
  canToggle: boolean
  onError: (m: string) => void
}) {
  const { t } = useT()
  const [enabled, setEnabled] = useState(false)
  const [subs, setSubs] = useState<AdminUptimeSub[]>([])
  // Withdrawing a live authorisation is confirmed; approving is not. The
  // asymmetry is deliberate - one starts a service, the other stops one someone
  // is already depending on, silently.
  const [revoking, setRevoking] = useState<{ id: number; name: string; email: string } | null>(null)
  const [revokeBusy, setRevokeBusy] = useState(false)

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
      // The nav entry that shows/hides this feature lives in App.tsx, which has
      // no shared ancestor with this screen to pass state through.
      notifySettingsChanged()
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

  async function confirmRevoke() {
    if (!revoking) return
    setRevokeBusy(true)
    try {
      await api.adminUptimeDecide(revoking.id, 'deny', 0)
      setRevoking(null)
      load()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setRevokeBusy(false)
    }
  }

  const statusCls: Record<string, string> = {
    pending: 'bg-slate-100 text-slate-600',
    approved: 'bg-green-100 text-green-700',
    denied: 'bg-red-100 text-red-700',
  }

  return (
    <div className="space-y-4">
      {revoking && (
        <ConfirmDelete
          title={t('admin.uptimeRevokeTitle')}
          name={`${revoking.name} · ${revoking.email}`}
          impact={t('admin.uptimeRevokeImpact')}
          confirmLabel={t('admin.uptimeRevoke')}
          busy={revokeBusy}
          onConfirm={confirmRevoke}
          onCancel={() => setRevoking(null)}
        />
      )}
      {canToggle ? (
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
          Feature is currently {enabled ? 'on' : 'off'} (changing it needs the Settings permission).
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
                {/* Actions for EVERY status, not just pending. A decision made
                    once was previously permanent from this screen: an approved
                    subscription had no control at all, so withdrawing it meant
                    editing the database by hand. */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={() => decide(s.id, 'approve', 30)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                      s.status === 'approved'
                        ? 'border border-slate-300 hover:border-amber-500'
                        : 'bg-amber-500 text-slate-900 hover:bg-amber-600'
                    }`}
                  >
                    {/* On an approved one this renews the clock rather than
                        granting anything, so it says so. */}
                    {s.status === 'approved' ? t('admin.uptimeExtend30') : t('admin.uptimeApprove30')}
                  </button>
                  <button
                    onClick={() => decide(s.id, 'approve', 90)}
                    className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs hover:border-amber-500"
                  >
                    {t('admin.uptime90')}
                  </button>
                  <button
                    onClick={() => decide(s.id, 'approve', 0)}
                    className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs hover:border-amber-500"
                  >
                    {t('admin.uptimeIndefinite')}
                  </button>

                  {s.status === 'approved' ? (
                    // Confirmed, because this stops monitoring someone is
                    // relying on and there is no notification telling them.
                    <button
                      onClick={() =>
                        setRevoking({ id: s.id, name: s.moniker || s.validator_address, email: s.email })
                      }
                      className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-red-600 hover:border-red-400"
                    >
                      {t('admin.uptimeRevoke')}
                    </button>
                  ) : (
                    s.status !== 'denied' && (
                      <button
                        onClick={() => decide(s.id, 'deny', 0)}
                        className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-red-600 hover:border-red-400"
                      >
                        {t('admin.uptimeDeny')}
                      </button>
                    )
                  )}
                  {s.status === 'denied' && (
                    <span className="text-xs text-slate-400">{t('admin.uptimeDeniedNote')}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
