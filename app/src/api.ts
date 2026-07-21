// Thin client for the PHP API. Same-origin (/api proxied in dev), so the
// PHP session cookie rides along automatically.

export interface WatchedAddress {
  id: number
  chain_key: string
  address: string
  label: string
  alarm_enabled: number
  created_at: string
}

export interface WalletAlert {
  id: number
  watched_address_id: number
  chain_key: string
  address: string
  label: string
  tx_hash: string
  amount: string
  denom: string
  recipient: string
  detected_at: string
  is_read: number
}

const API_BASE = `${import.meta.env.BASE_URL}api/`.replace('//', '/')

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  })
  const data = await res.json()
  if (!res.ok || data.ok === false) {
    throw new Error(data.error ?? `Request failed (${res.status})`)
  }
  return data as T
}

export interface AdminOverview {
  stats: {
    users: number
    watched_addresses: number
    alerts_total: number
    alerts_24h: number
    watcher_last_run: string | null
    watcher_age_seconds: number | null
  }
  users: {
    id: number
    email: string
    is_admin: number
    is_super_admin: number
    is_disabled: number
    main_address: string | null
    features: string | null
    created_at: string
    watched_count: number
  }[]
  recent_alerts: {
    id: number
    tx_hash: string
    amount: string
    denom: string
    detected_at: string
    chain_key: string
    address: string
    label: string
  }[]
}

export const api = {
  me: () =>
    call<{
      logged_in: boolean
      email?: string
      is_admin?: boolean
      is_super_admin?: boolean
      admin_features?: string[]
      main_address?: string | null
    }>('me.php'),
  register: (email: string, password: string, main_address: string) =>
    call('register.php', { email, password, main_address }),
  login: (identifier: string, password: string) => call('login.php', { identifier, password }),
  accountSetAddress: (main_address: string) =>
    call<{ main_address: string | null }>('account_set_address.php', { main_address }),
  logout: () => call('logout.php', {}),
  watchedList: () => call<{ addresses: WatchedAddress[] }>('watched_list.php'),
  watchedAdd: (chain_key: string, address: string, label: string) =>
    call('watched_add.php', { chain_key, address, label }),
  watchedRemove: (id: number) => call('watched_remove.php', { id }),
  watchedToggle: (id: number, enabled: boolean) => call('watched_toggle.php', { id, enabled }),
  alertsList: () => call<{ unread: number; alerts: WalletAlert[] }>('alerts_list.php'),
  alertsMarkRead: () => call('alerts_mark_read.php', {}),
  adminOverview: () => call<AdminOverview & { ok: boolean }>('admin_overview.php'),
  adminUserUpdate: (id: number, action: UserAction) =>
    call('admin_user_update.php', { id, action }),
  adminRoleUpdate: (
    id: number,
    is_admin: boolean,
    is_super_admin: boolean,
    features: string[],
  ) => call('admin_role_update.php', { id, is_admin, is_super_admin, features }),
  announcementGet: () =>
    call<{ announcement: Announcement | null }>('announcement_get.php'),
  adminAnnouncementSet: (message: string, severity: string, expires_hours: number) =>
    call('admin_announcement_set.php', { message, severity, expires_hours }),
  adminAnnouncementClear: () => call('admin_announcement_set.php', { clear: true }),
  pushConfig: () => call<{ publicKey: string }>('push_config.php'),
  pushSubscribe: (subscription: PushSubscriptionJSON) =>
    call('push_subscribe.php', subscription),
  pushUnsubscribe: (endpoint: string) => call('push_unsubscribe.php', { endpoint }),
}

export type UserAction = 'disable' | 'enable' | 'delete'

export const ADMIN_FEATURES = ['users', 'chains', 'announcements'] as const
export type AdminFeature = (typeof ADMIN_FEATURES)[number]

export interface Announcement {
  message: string
  severity: 'info' | 'warning' | 'danger'
}
