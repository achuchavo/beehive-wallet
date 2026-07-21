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

export const api = {
  me: () => call<{ logged_in: boolean; email?: string }>('me.php'),
  register: (email: string, password: string) => call('register.php', { email, password }),
  login: (email: string, password: string) => call('login.php', { email, password }),
  logout: () => call('logout.php', {}),
  watchedList: () => call<{ addresses: WatchedAddress[] }>('watched_list.php'),
  watchedAdd: (chain_key: string, address: string, label: string) =>
    call('watched_add.php', { chain_key, address, label }),
  watchedRemove: (id: number) => call('watched_remove.php', { id }),
  watchedToggle: (id: number, enabled: boolean) => call('watched_toggle.php', { id, enabled }),
  alertsList: () => call<{ unread: number; alerts: WalletAlert[] }>('alerts_list.php'),
  alertsMarkRead: () => call('alerts_mark_read.php', {}),
}
