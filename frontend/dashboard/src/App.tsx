import { Routes, Route, Navigate } from 'react-router-dom'
import { Box } from '@chakra-ui/react'
import { useAuthStore } from './stores/authStore'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import { RegisterPage, AIPage, UsersPage, TeamsPage, SettingsPage, WebhooksPage } from './pages/index'
import { useEffect } from 'react'

function App() {
  const { isAuthenticated, checkAuth } = useAuthStore()

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  if (!isAuthenticated) {
    return (
      <Box minH="100vh" bg="gray.50">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Box>
    )
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/ai" element={<AIPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/teams" element={<TeamsPage />} />
        <Route path="/webhooks" element={<WebhooksPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Layout>
  )
}

export default App