import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { onSettingsChanged } from '../settingsSignal'

interface AuthState {
  status: 'loading' | 'in' | 'out'
  email: string | null
  isAdmin: boolean
  isSuper: boolean
  features: string[]
  mainAddress: string | null
}

interface AuthContextValue extends AuthState {
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const initial: AuthState = {
  status: 'loading',
  email: null,
  isAdmin: false,
  isSuper: false,
  features: [],
  mainAddress: null,
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(initial)

  /**
   * Re-read who we are.
   *
   * @param quiet When true, a FAILED request leaves the current state alone.
   *
   * The distinction matters because this is now called in the background. A
   * server that answers `logged_in: false` is real information and is acted on
   * either way - the session is genuinely gone. A request that THREW tells us
   * nothing about the session, only about the network, and treating that as a
   * sign-out would throw a working user onto the login screen because a phone
   * came back on a flaky connection. On the first load there is no state worth
   * preserving, so it still falls back to signed-out.
   */
  const runRefresh = useCallback(async (quiet: boolean) => {
    try {
      const r = await api.me()
      if (r.logged_in) {
        setState({
          status: 'in',
          email: r.email ?? null,
          isAdmin: r.is_admin === true || r.is_super_admin === true,
          isSuper: r.is_super_admin === true,
          features: r.admin_features ?? [],
          mainAddress: r.main_address ?? null,
        })
      } else {
        setState({ ...initial, status: 'out' })
      }
    } catch {
      if (!quiet) setState({ ...initial, status: 'out' })
    }
  }, [])

  const refresh = useCallback(() => runRefresh(false), [runRefresh])

  const logout = useCallback(async () => {
    await api.logout().catch(() => {})
    setState({ ...initial, status: 'out' })
  }, [])

  useEffect(() => {
    refresh()

    // Role and identity are read here once and then gate the Admin nav entry, so
    // a promotion or demotion never reached an open tab. Now: whenever the tab
    // regains focus, and on the settings signal so a role change made on the
    // admin screen lands immediately.
    //
    // Also picks up a session that ended while the tab sat idle, which is the
    // more common case by far - the UI stops claiming to be signed in.
    const quiet = () => {
      if (document.visibilityState === 'visible') void runRefresh(true)
    }
    const stopSignal = onSettingsChanged(quiet)
    window.addEventListener('focus', quiet)
    document.addEventListener('visibilitychange', quiet)
    return () => {
      stopSignal()
      window.removeEventListener('focus', quiet)
      document.removeEventListener('visibilitychange', quiet)
    }
  }, [refresh, runRefresh])

  const value = useMemo<AuthContextValue>(() => ({ ...state, refresh, logout }), [state, refresh, logout])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
