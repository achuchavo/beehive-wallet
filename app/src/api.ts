// Thin client for the PHP API. Same-origin (/api proxied in dev), so the
// PHP session cookie rides along automatically.

export type AlarmType = 'sent' | 'received' | 'both' | 'unbond'
export type AlertKind = 'sent' | 'received' | 'unbond'

export interface WatchedAddress {
  id: number
  chain_key: string
  address: string
  label: string
  alarm_enabled: number
  alarm_type: AlarmType
  created_at: string
}

export interface WalletAlert {
  id: number
  watched_address_id: number
  kind: AlertKind
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

export type UptimeStatus = 'pending' | 'approved' | 'denied'
export type UptimeAlertKind = 'down' | 'recovered'

export interface UptimeSubscription {
  id: number
  chain_key: string
  validator_address: string
  moniker: string
  status: UptimeStatus
  authorized_until: string | null
  miss_threshold: number
  frequency_minutes: number
  snooze_until: string | null
  last_missed: number
  last_down_state: number
  last_alert_at: string | null
  created_at: string
}

export interface UptimeAlert {
  id: number
  subscription_id: number
  kind: UptimeAlertKind
  missed_blocks: number
  detected_at: string
  is_read: number
  validator_address: string
  moniker: string
  chain_key: string
}

export interface AdminUptimeSub {
  id: number
  user_id: number
  email: string
  chain_key: string
  validator_address: string
  moniker: string
  status: UptimeStatus
  authorized_until: string | null
  miss_threshold: number
  frequency_minutes: number
  last_missed: number
  last_down_state: number
  created_at: string
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

// Sections are gated server-side by admin feature grant (admin_overview.php):
// an admin without the matching permission simply does not receive that key.
export interface AdminOverview {
  permissions: string[]
  stats: Partial<{
    users: number
    watched_addresses: number
    alerts_total: number
    alerts_24h: number
    failed_logins_24h: number
    watcher_last_run: string | null
    watcher_age_seconds: number | null
  }>
  users?: {
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
  recent_alerts?: {
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
      /** False for addresses linked before ownership proofs existed. */
      main_address_verified?: boolean
    }>('me.php'),
  // A wallet address is not accepted at registration: proving control of one
  // requires signing a challenge bound to an account, which does not exist yet.
  // Link it after signing in via addressChallenge + accountSetAddress.
  register: (email: string, password: string) =>
    call('register.php', { email, password }),
  login: (identifier: string, password: string, remember = false) =>
    call('login.php', { identifier, password, remember }),
  /** Step 1: ask the server for a single-use challenge to sign. */
  addressChallenge: (address: string, chain_key: string) =>
    call<{ nonce: string; expires_at: string; message: string }>('address_challenge.php', {
      address,
      chain_key,
    }),
  /**
   * Step 2: redeem the challenge with an ADR-036 signature. Pass only
   * `main_address: ''` (no proof) to clear the linked address.
   */
  accountSetAddress: (
    main_address: string,
    proof?: { nonce: string; pubkey: string; signature: string },
  ) =>
    call<{ main_address: string | null; verified: boolean }>('account_set_address.php', {
      main_address,
      ...(proof ?? {}),
    }),
  logout: () => call('logout.php', {}),
  watchedList: () => call<{ addresses: WatchedAddress[] }>('watched_list.php'),
  watchedAdd: (chain_key: string, address: string, label: string, alarm_type: AlarmType) =>
    call<{ id: number; duplicate: boolean }>('watched_add.php', {
      chain_key,
      address,
      label,
      alarm_type,
    }),
  watchedRemove: (id: number) => call('watched_remove.php', { id }),
  watchedToggle: (id: number, enabled: boolean) => call('watched_toggle.php', { id, enabled }),
  watchedSetType: (id: number, alarm_type: AlarmType) =>
    call('watched_set_type.php', { id, alarm_type }),
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
  settingsPublic: () =>
    call<{ uptime_alerts_enabled: boolean }>('settings_public.php'),
  adminAnnouncementSet: (message: string, severity: string, expires_hours: number) =>
    call('admin_announcement_set.php', { message, severity, expires_hours }),
  adminAnnouncementClear: () => call('admin_announcement_set.php', { clear: true }),
  adminChains: () =>
    call<{ chains: AdminChain[]; endpoints: AdminEndpoint[]; free_validators: AdminFreeValidator[] }>(
      'admin_chains.php',
    ),
  adminChainSave: (chain: Partial<AdminChain> & { chain_key: string }) =>
    call('admin_chain_save.php', chain),
  adminEndpointSave: (ep: Partial<AdminEndpoint> & { chain_key: string; kind: string; url: string }) =>
    call('admin_endpoint_save.php', ep),
  adminEndpointDelete: (id: number) => call('admin_endpoint_delete.php', { id }),
  adminFreeValidatorAdd: (chain_key: string, valoper: string) =>
    call('admin_free_validator_add.php', { chain_key, valoper }),
  adminFreeValidatorRemove: (id: number) => call('admin_free_validator_remove.php', { id }),
  uptimeStatus: () =>
    call<{
      enabled: boolean
      subscriptions: UptimeSubscription[]
      alerts: UptimeAlert[]
      unread: number
    }>('uptime_status.php'),
  uptimeApply: (chain_key: string, validator_address: string, moniker: string) =>
    call('uptime_apply.php', { chain_key, validator_address, moniker }),
  uptimeUpdate: (
    id: number,
    changes: { frequency_minutes?: number; miss_threshold?: number; snooze_minutes?: number },
  ) => call('uptime_update.php', { id, ...changes }),
  uptimeCancel: (id: number) => call('uptime_cancel.php', { id }),
  uptimeMarkRead: () => call('uptime_mark_read.php', {}),
  adminUptimeList: () =>
    call<{ enabled: boolean; subscriptions: AdminUptimeSub[] }>('admin_uptime_list.php'),
  adminUptimeDecide: (id: number, action: 'approve' | 'deny', days: number) =>
    call('admin_uptime_decide.php', { id, action, days }),
  adminSettingSet: (key: string, value: boolean) =>
    call<{ key: string; value: string }>('admin_setting_set.php', { key, value: value ? 1 : 0 }),
  pushConfig: () => call<{ publicKey: string }>('push_config.php'),
  pushSubscribe: (subscription: PushSubscriptionJSON) =>
    call('push_subscribe.php', subscription),
  pushUnsubscribe: (endpoint: string) => call('push_unsubscribe.php', { endpoint }),
}

export type UserAction = 'disable' | 'enable' | 'delete'

export const ADMIN_FEATURES = ['users', 'chains', 'announcements', 'uptime'] as const
export type AdminFeature = (typeof ADMIN_FEATURES)[number]

export interface AdminChain {
  chain_key: string
  chain_id: string
  chain_name: string
  bech32_prefix: string
  denom: string
  display_denom: string
  decimals: number
  coin_type: number
  gas_price: string
  explorer_tx_url: string
  explorer_validator_url: string
  beehive_validator: string
  beehive_moniker: string
  coingecko_id: string
  service_fee: string
  fee_collector: string
  is_active: number
  sort_order: number
}

export interface AdminEndpoint {
  id: number
  chain_key: string
  kind: string
  url: string
  priority: number
  is_active: number
}

export interface AdminFreeValidator {
  id: number
  chain_key: string
  valoper: string
}

export interface Announcement {
  message: string
  severity: 'info' | 'warning' | 'danger'
}
