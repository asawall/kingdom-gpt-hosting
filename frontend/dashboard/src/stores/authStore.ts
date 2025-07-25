import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api } from '../services/api'

interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  permissions: string[]
  emailVerified: boolean
}

interface Tenant {
  id: string
  name: string
  domain?: string
  subscriptionPlan: string
}

interface AuthState {
  user: User | null
  tenant: Tenant | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  
  // Actions
  login: (email: string, password: string) => Promise<void>
  register: (data: any) => Promise<void>
  logout: () => void
  checkAuth: () => void
  clearError: () => void
  updateUser: (userData: Partial<User>) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      tenant: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null })
        
        try {
          const response = await api.post('/auth/login', { email, password })
          const { user, tenant, token } = response.data.data
          
          // Set authorization header for future requests
          api.defaults.headers.common['Authorization'] = `Bearer ${token}`
          
          set({
            user,
            tenant,
            token,
            isAuthenticated: true,
            isLoading: false,
            error: null
          })
        } catch (error: any) {
          set({
            isLoading: false,
            error: error.response?.data?.message || 'Login failed'
          })
          throw error
        }
      },

      register: async (data: any) => {
        set({ isLoading: true, error: null })
        
        try {
          const response = await api.post('/auth/register', data)
          const { user, tenant, token } = response.data.data
          
          // Set authorization header for future requests
          api.defaults.headers.common['Authorization'] = `Bearer ${token}`
          
          set({
            user,
            tenant,
            token,
            isAuthenticated: true,
            isLoading: false,
            error: null
          })
        } catch (error: any) {
          set({
            isLoading: false,
            error: error.response?.data?.message || 'Registration failed'
          })
          throw error
        }
      },

      logout: () => {
        // Call logout API
        api.post('/auth/logout').catch(() => {
          // Ignore errors on logout
        })
        
        // Clear authorization header
        delete api.defaults.headers.common['Authorization']
        
        set({
          user: null,
          tenant: null,
          token: null,
          isAuthenticated: false,
          error: null
        })
      },

      checkAuth: () => {
        const { token } = get()
        
        if (token) {
          // Set authorization header
          api.defaults.headers.common['Authorization'] = `Bearer ${token}`
          set({ isAuthenticated: true })
        } else {
          set({ isAuthenticated: false })
        }
      },

      clearError: () => {
        set({ error: null })
      },

      updateUser: (userData: Partial<User>) => {
        const { user } = get()
        if (user) {
          set({ user: { ...user, ...userData } })
        }
      }
    }),
    {
      name: 'kingdom-auth',
      partialize: (state) => ({
        user: state.user,
        tenant: state.tenant,
        token: state.token,
        isAuthenticated: state.isAuthenticated
      })
    }
  )
)