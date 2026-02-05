import { create } from 'zustand'
import * as authApi from '../api/auth'

interface AuthState {
  token: string | null
  user: authApi.User | null
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, displayName: string) => Promise<void>
  logout: () => void
  hydrate: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  isAuthenticated: false,

  login: async (email, password) => {
    const result = await authApi.login(email, password)
    localStorage.setItem('token', result.token)
    localStorage.setItem('user', JSON.stringify(result.user))
    set({ token: result.token, user: result.user, isAuthenticated: true })
  },

  register: async (email, password, displayName) => {
    const result = await authApi.register(email, password, displayName)
    localStorage.setItem('token', result.token)
    localStorage.setItem('user', JSON.stringify(result.user))
    set({ token: result.token, user: result.user, isAuthenticated: true })
  },

  logout: () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    set({ token: null, user: null, isAuthenticated: false })
  },

  hydrate: () => {
    const token = localStorage.getItem('token')
    const userStr = localStorage.getItem('user')
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr) as authApi.User
        set({ token, user, isAuthenticated: true })
      } catch {
        localStorage.removeItem('token')
        localStorage.removeItem('user')
      }
    }
  },
}))
