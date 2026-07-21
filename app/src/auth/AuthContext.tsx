import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from '../api'

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

  const refresh = useCallback(async () => {
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
      setState({ ...initial, status: 'out' })
    }
  }, [])

  const logout = useCallback(async () => {
    await api.logout().catch(() => {})
    setState({ ...initial, status: 'out' })
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const value = useMemo<AuthContextValue>(() => ({ ...state, refresh, logout }), [state, refresh, logout])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
