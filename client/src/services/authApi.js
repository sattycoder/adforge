import axios from 'axios'

const client = axios.create({
  baseURL: '/api/auth',
  timeout: 30000,
  withCredentials: true,
})

export const authAPI = {
  // Dev-only local login: validates against provided static credentials
  login: async (email, password) => {
    // For now, do not call server. Emulate success against known credentials.
    const allowedUsers = [
      { email: 's.rai@ad-tool.com', password: 'Saty79777##', full_name: 'Satyam Rai' },
      { email: 'testUser01@ad-tool.com', password: 'test-user001', full_name: 'Test User 01' },
      { email: 'testUser02@ad-tool.com', password: 'test-user002', full_name: 'Test User 02' },
      { email: 'testUser03@ad-tool.com', password: 'test-user003', full_name: 'Test User 03' },
      { email: 'testUser04@ad-tool.com', password: 'test-user004', full_name: 'Test User 04' },
      { email: 'testUser05@ad-tool.com', password: 'test-user005', full_name: 'Test User 05' },
      { email: 'testUser06@ad-tool.com', password: 'test-user006', full_name: 'Test User 06' },
    ]

    await new Promise((res) => setTimeout(res, 600))

    const matchedUser = allowedUsers.find(u => u.email === email && u.password === password)
    if (matchedUser) {
      const user = { email, full_name: matchedUser.full_name, sso_provider: null }
      // Persist to sessionStorage as a simple placeholder session
      sessionStorage.setItem('auth_user', JSON.stringify(user))
      return { user }
    }
    const err = new Error('Invalid credentials')
    err.status = 401
    throw err
  },

  logout: async () => {
    sessionStorage.removeItem('auth_user')
    await new Promise((res) => setTimeout(res, 200))
    return { success: true }
  },

  getCurrentUser: async () => {
    await new Promise((res) => setTimeout(res, 200))
    const raw = sessionStorage.getItem('auth_user')
    if (!raw) throw new Error('No session')
    return JSON.parse(raw)
  },

  // SSO placeholder endpoints
  checkSsoAvailability: async () => {
    // Expose SSO button only if minimal config present
    const domain = import.meta.env.VITE_COGNITO_DOMAIN
    const clientId = import.meta.env.VITE_COGNITO_APP_CLIENT_ID
    return Boolean(domain && clientId)
  },

  ssoLogin: async (userInfo) => {
    // Placeholder: In future, send userInfo to server to create a session
    // For now, just store it locally to simulate a logged-in user
    const user = {
      email: userInfo?.email,
      full_name: userInfo?.full_name || userInfo?.email?.split('@')[0],
      sso_provider: 'cognito',
    }
    sessionStorage.setItem('auth_user', JSON.stringify(user))
    return { user }
  },
}


