import axios from 'axios'

// Create axios instance
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor
api.interceptors.request.use(
  (config) => {
    // Add any request transformations here
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response interceptor
api.interceptors.response.use(
  (response) => {
    return response
  },
  (error) => {
    if (error.response?.status === 401) {
      // Handle unauthorized access
      localStorage.removeItem('kingdom-auth')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// Auth API
export const authAPI = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  
  register: (data: any) =>
    api.post('/auth/register', data),
  
  logout: () =>
    api.post('/auth/logout'),
  
  verifyEmail: (token: string) =>
    api.post('/auth/verify-email', { token }),
  
  forgotPassword: (email: string) =>
    api.post('/auth/forgot-password', { email }),
  
  resetPassword: (token: string, password: string) =>
    api.post('/auth/reset-password', { token, password }),
}

// Users API
export const usersAPI = {
  getUsers: (params?: any) =>
    api.get('/users', { params }),
  
  getUser: (id: string) =>
    api.get(`/users/${id}`),
  
  createUser: (data: any) =>
    api.post('/users', data),
  
  updateUser: (id: string, data: any) =>
    api.put(`/users/${id}`, data),
  
  deleteUser: (id: string) =>
    api.delete(`/users/${id}`),
  
  changePassword: (id: string, data: any) =>
    api.post(`/users/${id}/change-password`, data),
  
  getUserStats: (id: string) =>
    api.get(`/users/${id}/stats`),
}

// Tenants API
export const tenantsAPI = {
  getCurrentTenant: () =>
    api.get('/tenants/current'),
  
  updateTenant: (data: any) =>
    api.put('/tenants/current', data),
  
  getTenantStats: () =>
    api.get('/tenants/stats'),
  
  getUsage: () =>
    api.get('/tenants/usage'),
  
  getTeams: (params?: any) =>
    api.get('/tenants/teams', { params }),
  
  createTeam: (data: any) =>
    api.post('/tenants/teams', data),
}

// AI API
export const aiAPI = {
  processRequest: (data: any) =>
    api.post('/ai/process', data),
  
  streamRequest: (data: any) =>
    api.post('/ai/stream', data, { responseType: 'stream' }),
  
  getJob: (jobId: string) =>
    api.get(`/ai/jobs/${jobId}`),
  
  getJobs: (params?: any) =>
    api.get('/ai/jobs', { params }),
  
  getModels: () =>
    api.get('/ai/models'),
  
  getHardware: () =>
    api.get('/ai/hardware'),
}

// Webhooks API
export const webhooksAPI = {
  getWebhooks: (params?: any) =>
    api.get('/webhooks', { params }),
  
  createWebhook: (data: any) =>
    api.post('/webhooks', data),
  
  updateWebhook: (id: string, data: any) =>
    api.put(`/webhooks/${id}`, data),
  
  deleteWebhook: (id: string) =>
    api.delete(`/webhooks/${id}`),
  
  testWebhook: (id: string) =>
    api.post(`/webhooks/${id}/test`),
}

// Files API
export const filesAPI = {
  uploadFile: (data: FormData) =>
    api.post('/files/upload', data, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }),
  
  getFiles: (params?: any) =>
    api.get('/files', { params }),
  
  deleteFile: (id: string) =>
    api.delete(`/files/${id}`),
  
  downloadFile: (id: string) =>
    api.get(`/files/${id}/download`, { responseType: 'blob' }),
}

// Payments API
export const paymentsAPI = {
  getSubscription: () =>
    api.get('/payments/subscription'),
  
  updateSubscription: (planId: string) =>
    api.post('/payments/subscription', { planId }),
  
  getBillingHistory: (params?: any) =>
    api.get('/payments/history', { params }),
  
  createPaymentMethod: (data: any) =>
    api.post('/payments/methods', data),
  
  getPaymentMethods: () =>
    api.get('/payments/methods'),
  
  deletePaymentMethod: (id: string) =>
    api.delete(`/payments/methods/${id}`),
}