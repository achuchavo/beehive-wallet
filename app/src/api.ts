// Thin client for the PHP API.
//
// On the web this is same-origin (/api proxied in dev), so the PHP session
// cookie rides along automatically. On native it cannot be: the WebView origin
// is never the API's origin, so calls go to an absolute origin, no cookies are
// sent, and a bearer token from the Keychain/Keystore authenticates instead.
// See platform.ts and auth/deviceToken.ts - callers here see no difference.

import type { StakingPolicy } from './chains'
import { apiRoot, isNative, nativePlatform } from './platform'
import { clearDeviceToken, loadDeviceToken, saveDeviceToken } from './auth/deviceToken'

export type AlarmType = 'sent' | 'received' | 'both' | 'unbond'
export type AlertKind = 'sent' | 'received' | 'unbond'

/** How a watch is paid for. 'free' covers both the free allowance and any
 *  watch created before a chain had a cap - a cap only gates the next add. */
export type WatchTier = 'free' | 'paid'
/** 'lapsed' = a recurring payment ran out, so the watcher has paused it. */
export type WatchPaymentState = 'active' | 'lapsed'

export interface WatchedAddress {
  id: number
  chain_key: string
  address: string
  label: string
  alarm_enabled: number
  alarm_type: AlarmType
  created_at: string
  tier: WatchTier
  /** null for free watches and for one-off purchases, which never expire. */
  paid_until: string | null
  payment_state: WatchPaymentState
}

export type WatchCadence = 'one_time' | 'weekly' | 'monthly'

/**
 * What the next watch on a chain would cost. `metered: false` means the chain
 * has no pricing configured at all - no cap, no fee.
 */
export interface WatchQuote {
  metered: boolean
  alerts_enabled: boolean
  free_cap: number
  free_used: number
  next_is_free: boolean
  /** This account is never charged for alerts (super admins own the collection
   *  address, so charging one means asking it to pay itself). Reported
   *  separately from `next_is_free` so the UI can say why it is free. */
  exempt: boolean
  /** Whether a payment can actually be taken - false means the paid tier is
   *  unavailable (misconfigured or deliberately not for sale), never free. */
  sellable: boolean
  /** Base units, as a string. Never a number: see wallet/amount.ts. */
  fee_amount: string
  fee_denom: string
  collect_address: string
  cadence: WatchCadence
  grace_days: number
}

/** A quote locked for one payment, with the code that binds it to this account. */
export interface WatchIntent {
  memo_code: string
  expires_at: string
  fee_amount: string
  fee_denom: string
  collect_address: string
  cadence: WatchCadence
  kind: 'new' | 'renew'
  watch_id: number | null
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


/**
 * A failed API call that kept its payload.
 *
 * The payment endpoints answer a refusal with structured detail - the quote to
 * show, whether it is worth retrying, how much was actually paid - and a plain
 * Error would throw all of that away, leaving the UI with only a sentence. It
 * still extends Error, so every existing `e instanceof Error ? e.message`
 * catch site keeps working unchanged.
 */
export class ApiError extends Error {
  readonly status: number
  /** Machine-readable reason, e.g. 'not_indexed', 'underpaid', 'already_used'. */
  readonly code: string
  /** True when the same request could succeed later - a node that has not
   *  indexed the transaction yet, or an endpoint that was briefly unreachable. */
  readonly retriable: boolean
  readonly payload: Record<string, unknown>

  constructor(message: string, status: number, payload: Record<string, unknown>) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = typeof payload.code === 'string' ? payload.code : ''
    this.retriable = payload.retriable === true
    this.payload = payload
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const native = isNative()
  if (native) {
    // Sent on EVERY native request, not just sign-in. It is how the API tells
    // the app apart from a hostile page when no token has been issued yet (see
    // api/common.php is_native_client), and sending it uniformly means a
    // signed-out request to a protected endpoint answers "not logged in"
    // instead of the misleading "cross-origin request blocked".
    //
    // The cost is a CORS preflight on requests that would otherwise be simple.
    // That is only the unauthenticated reads - anything carrying Authorization
    // is preflighted regardless - and the result is cached per endpoint, so it
    // amounts to a handful of extra round trips every ten minutes.
    headers['X-Beehive-Client'] = 'native'
    const token = await loadDeviceToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  const res = await fetch(`${apiRoot()}/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
    // Native sends no cookies at all. The API deliberately never returns
    // Access-Control-Allow-Credentials for the WebView origins, so a
    // credentialed cross-origin request could not complete its preflight -
    // 'omit' states that intent instead of relying on it failing.
    credentials: native ? 'omit' : 'same-origin',
  })
  const data = await res.json()
  if (!res.ok || data.ok === false) {
    throw new ApiError(
      data.error ?? `Request failed (${res.status})`,
      res.status,
      typeof data === 'object' && data !== null ? data : {},
    )
  }
  return data as T
}

// Sections are gated server-side by admin feature grant (admin_overview.php):
// an admin without the matching permission simply does not receive that key.
export interface AdminOverview {
  permissions: string[]
  /** Per-feature access level. Presentation only - every endpoint enforces its
   *  own level server-side, so this can never be the thing that protects data. */
  levels: Partial<Record<AdminFeature, PermLevel>>
  is_super_admin: boolean
  stats: Partial<{
    users: number
    watched_addresses: number
    alerts_total: number
    alerts_24h: number
    failed_logins_24h: number
    watcher_last_run: string | null
    watcher_age_seconds: number | null
    /** How many addresses the watcher is responsible for, so "healthy but
     *  idle" is distinguishable from "healthy and working". */
    watcher_watched: number
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
      /** The caller's own user id, so admin screens can identify their own row. */
      id?: number
      email?: string
      is_admin?: boolean
      is_super_admin?: boolean
      admin_features?: string[]
      /** Per-feature access level. Presentation only; the server enforces. */
      admin_levels?: Partial<Record<AdminFeature, PermLevel>>
      main_address?: string | null
      /** False for addresses linked before ownership proofs existed. */
      main_address_verified?: boolean
      /** True = push bodies omit wallet names and amounts (audit #13). */
      push_private?: boolean
    }>('me.php'),
  // A wallet address is not accepted at registration: proving control of one
  // requires signing a challenge bound to an account, which does not exist yet.
  // Link it after signing in via addressChallenge + accountSetAddress.
  register: (email: string, password: string) => call('register.php', { email, password }),
  /**
   * Sign in.
   *
   * On native there is no usable cookie, so the server answers with a bearer
   * token which is stored in the Keychain/Keystore here - callers do not have to
   * know which platform they are on, or that a token exists at all.
   *
   * `remember` is ignored by the server for a native sign-in: the device token
   * IS the durable credential.
   */
  login: async (identifier: string, password: string, remember = false) => {
    const platform = nativePlatform()
    if (!platform) {
      return call('login.php', { identifier, password, remember })
    }
    const res = await call<{ token: string; expires_at: string }>('login.php', {
      identifier,
      password,
      remember,
      platform,
      // Which build this device is running, for a future "Devices" screen.
      app_version: __BUILD_COMMIT__.slice(0, 12),
    })
    await saveDeviceToken(res.token)
    return res
  },
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
  /**
   * Sign out, revoking the server-side credential.
   *
   * The local token is dropped even if the request fails: a device that cannot
   * reach the server must still end up signed out locally, and a token the
   * server keeps is bounded by its own expiry. Leaving it in the Keychain
   * because the network was down would be the worse failure.
   */
  logout: async () => {
    try {
      return await call('logout.php', {})
    } finally {
      await clearDeviceToken()
    }
  },
  watchedList: () =>
    call<{
      addresses: WatchedAddress[]
      limit: number
      /** Per-chain allowance, keyed by chain key. */
      quotes: Record<string, WatchQuote>
    }>('watched_list.php'),
  /**
   * Add a FREE watch. When the user is over the chain's free allowance this
   * fails with HTTP 402 and an ApiError carrying `quote` - the caller shows the
   * fee and moves to the payment flow. This endpoint never creates a paid
   * watch; only a verified payment can do that.
   */
  watchedAdd: (chain_key: string, address: string, label: string, alarm_type: AlarmType) =>
    call<{ id: number; duplicate: boolean }>('watched_add.php', {
      chain_key,
      address,
      label,
      alarm_type,
    }),
  /**
   * Ask what the next watch (or a renewal) would cost, and get a payment code.
   * Charges nothing and creates nothing.
   */
  watchQuote: (args: {
    chain_key: string
    address?: string
    kind?: 'new' | 'renew'
    watch_id?: number
  }) =>
    call<{ quote: WatchQuote; needs_payment: boolean; intent: WatchIntent | null }>(
      'watch_quote.php',
      args,
    ),
  /**
   * Submit an on-chain payment for verification. The server checks the
   * transaction against the chain and only then enables the watch - the hash is
   * the only thing here taken at face value, and only as something to look up.
   */
  watchPaymentSubmit: (args: {
    chain_key: string
    memo_code: string
    tx_hash: string
    address?: string
    label?: string
    alarm_type?: AlarmType
  }) =>
    call<{
      id: number
      tier: WatchTier
      paid_until: string | null
      cadence: WatchCadence
      amount: string
      denom: string
    }>('watch_payment_submit.php', args),
  watchedRemove: (id: number) => call('watched_remove.php', { id }),
  watchedToggle: (id: number, enabled: boolean) => call('watched_toggle.php', { id, enabled }),
  watchedSetType: (id: number, alarm_type: AlarmType) =>
    call('watched_set_type.php', { id, alarm_type }),
  alertsList: () => call<{ unread: number; alerts: WalletAlert[] }>('alerts_list.php'),
  alertsMarkRead: () => call('alerts_mark_read.php', {}),
  adminOverview: () => call<AdminOverview & { ok: boolean }>('admin_overview.php'),
  adminUserUpdate: (id: number, action: UserAction) =>
    call('admin_user_update.php', { id, action }),
  /**
   * `features` is a feature => level map. The server refuses any grant above
   * the caller's own level, refuses `roles` unless the caller is a super admin,
   * and refuses self-edits - none of which the UI can be trusted to enforce.
   */
  adminRoleUpdate: (
    id: number,
    is_admin: boolean,
    is_super_admin: boolean,
    features: Partial<Record<AdminFeature, PermLevel>>,
  ) => call('admin_role_update.php', { id, is_admin, is_super_admin, features }),
  adminAlertPricing: () =>
    call<{
      chains: AdminChainPricing[]
      cadences: WatchCadence[]
      free_cap_max: number
      grace_days_max: number
    }>('admin_alert_pricing.php'),
  /** `fee_amount` is BASE UNITS as a string - never a float. */
  adminAlertPricingSave: (pricing: {
    chain_key: string
    alerts_enabled: boolean
    free_cap: number
    fee_amount: string
    fee_denom: string
    collect_address: string
    cadence: WatchCadence
    grace_days: number
  }) => call('admin_alert_pricing_save.php', pricing),
  /** Return a chain to unmetered: no cap, no fee. Existing watches are kept. */
  adminAlertPricingClear: (chain_key: string) =>
    call('admin_alert_pricing_save.php', { chain_key, clear: true }),
  /**
   * Watched addresses grouped under the account that owns them.
   *
   * Paged by ACCOUNT, not by address, so expanding someone always shows all of
   * their matching addresses rather than whichever ones fell on this page.
   */
  adminUserWatches: (params: { q?: string; chain_key?: string; tier?: string; page?: number }) => {
    const qs = new URLSearchParams()
    if (params.q) qs.set('q', params.q)
    if (params.chain_key) qs.set('chain_key', params.chain_key)
    if (params.tier) qs.set('tier', params.tier)
    if (params.page && params.page > 1) qs.set('page', String(params.page))
    const suffix = qs.toString() ? `?${qs}` : ''
    return call<{
      accounts: AdminWatchAccount[]
      page: number
      per_page: number
      total_accounts: number
      /** Deployment-wide, independent of the filter or page. */
      totals: { total: number; paid: number; free: number; lapsed: number }
    }>(`admin_user_watches.php${suffix}`)
  },
  announcementGet: () =>
    call<{ announcement: Announcement | null }>('announcement_get.php'),
  settingsPublic: () =>
    call<{ uptime_alerts_enabled: boolean; watch_limit: number }>('settings_public.php'),
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
  adminStaking: () =>
    call<{ chains: AdminStakingChain[]; policies: StakingPolicy[] }>('admin_staking.php'),
  /** `service_fee` is BASE UNITS as a string - never a float. */
  adminStakingSave: (args: {
    chain_key: string
    staking_policy: StakingPolicy
    service_fee: string
    fee_collector: string
  }) => call('admin_staking_save.php', args),
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
  // Booleans go over the wire as 1/0; numeric settings (watch_limit) are sent
  // as-is and validated server-side against that key's own range.
  adminSettingSet: (key: string, value: boolean | number) =>
    call<{ key: string; value: string }>('admin_setting_set.php', {
      key,
      value: typeof value === 'boolean' ? (value ? 1 : 0) : value,
    }),
  pushConfig: () => call<{ publicKey: string }>('push_config.php'),
  pushSubscribe: (subscription: PushSubscriptionJSON) =>
    call('push_subscribe.php', subscription),
  pushUnsubscribe: (endpoint: string) => call('push_unsubscribe.php', { endpoint }),
  pushPrivacy: (pushPrivate: boolean) =>
    call<{ push_private: boolean }>('push_privacy.php', { push_private: pushPrivate }),
}

export type UserAction = 'disable' | 'enable' | 'delete'

/**
 * Access levels, mirroring PERM_* in api/security_lib.php. Ordered, so a check
 * is `held >= needed` rather than a set of cases.
 */
export const PERM_NONE = 0
export const PERM_READ = 1
export const PERM_WRITE = 2
export type PermLevel = 0 | 1 | 2

/**
 * Must stay in step with ADMIN_FEATURES in api/security_lib.php. A feature
 * missing here is simply not offered by the admin UI; a feature missing THERE
 * is refused by the server, which is the direction that matters.
 */
export const ADMIN_FEATURES = [
  'users',
  'roles',
  'chains',
  'announcements',
  'uptime',
  'wallet_alerts',
  'staking',
  'alert_pricing',
  'user_watches',
  'settings',
] as const
export type AdminFeature = (typeof ADMIN_FEATURES)[number]

export interface AdminStakingChain {
  chain_key: string
  chain_name: string
  denom: string
  display_denom: string
  decimals: number
  bech32_prefix: string
  chain_is_active: boolean
  beehive_validator: string
  beehive_moniker: string
  staking_policy: StakingPolicy
  /** Base units, as a string. Never a number. */
  service_fee: string
  fee_collector: string
  /** Whether a fee could actually be collected (positive fee + valid address). */
  fee_ready: boolean
  allowed_validators: { id: number; valoper: string }[]
}

export interface AdminChainPricing {
  chain_key: string
  chain_name: string
  denom: string
  display_denom: string
  decimals: number
  bech32_prefix: string
  chain_is_active: boolean
  /** null = unmetered: no cap and no fee on this chain. */
  pricing: {
    alerts_enabled: boolean
    free_cap: number
    fee_amount: string
    fee_denom: string
    collect_address: string
    cadence: WatchCadence
    grace_days: number
    sellable: boolean
    updated_at: string | null
  } | null
  watch_counts: { free: number; paid: number; lapsed: number; total: number }
}

/** One account and everything it is watching that matched the filter. */
export interface AdminWatchAccount {
  user_id: number
  email: string
  watches: AdminUserWatch[]
  counts: { total: number; paid: number; free: number; lapsed: number }
}

export interface AdminUserWatch {
  id: number
  user_id: number
  email: string
  chain_key: string
  address: string
  label: string
  alarm_enabled: number
  alarm_type: AlarmType
  created_at: string
  tier: WatchTier
  paid_until: string | null
  payment_state: WatchPaymentState
  payment_count: number
  last_tx_hash: string | null
  last_amount: string | null
  last_denom: string | null
  last_cadence: WatchCadence | null
  last_paid_at: string | null
}

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
