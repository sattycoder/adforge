import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { authAPI } from '../services/authApi'
import { CognitoAuth } from './CognitoAuth'

const AuthContext = createContext(null)

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [loginLoading, setLoginLoading] = useState(false)
  const [ssoEnabled, setSsoEnabled] = useState(false)
  const [error, setError] = useState(null)
  const [checkingAuth, setCheckingAuth] = useState(true)

  const cognitoAuth = useMemo(() => new CognitoAuth(), [])

  const handleOAuthCallback = useCallback(async () => {
    try {
      setLoginLoading(true)
      setError(null)

      const urlParams = new URLSearchParams(window.location.search)
      const code = urlParams.get('code')
      const error_param = urlParams.get('error')

      if (error_param) {
        const error_description = urlParams.get('error_description') || 'OAuth authentication failed'
        throw new Error(`OAuth Error: ${error_param} - ${error_description}`)
      }
      if (!code) throw new Error('No authorization code received from OAuth provider')

      const userInfo = await cognitoAuth.exchangeCodeForTokens(code)
      const response = await authAPI.ssoLogin(userInfo)
      if (response.user) {
        setUser(response.user)
        window.history.replaceState({}, document.title, window.location.pathname)
        return { success: true, user: response.user }
      }
      throw new Error('Invalid response from server - no user data received')
    } catch (err) {
      setError(err.message || 'SSO authentication failed')
      window.history.replaceState({}, document.title, window.location.pathname)
      return { success: false, error: err.message }
    } finally {
      setLoginLoading(false)
    }
  }, [cognitoAuth])

  useEffect(() => {
    const initAuth = async () => {
      try {
        const ssoAvailable = await authAPI.checkSsoAvailability()
        setSsoEnabled(ssoAvailable)

        if (window.location.search.includes('code=') || window.location.search.includes('error=')) {
          await handleOAuthCallback()
          return
        }

        try {
          const userData = await authAPI.getCurrentUser()
          setUser(userData)
        } catch {}
      } catch (err) {
        setError(err.message || 'Authentication initialization failed')
      } finally {
        setCheckingAuth(false)
      }
    }
    initAuth()
  }, [handleOAuthCallback])

  const localLogin = async (email, password) => {
    try {
      setError(null)
      setLoginLoading(true)
      const response = await authAPI.login(email, password)
      if (response.user) {
        setUser(response.user)
        return { success: true, user: response.user }
      }
      throw new Error('Invalid credentials')
    } catch (err) {
      const errorMessage = err.message || 'Login failed'
      setError(errorMessage)
      return { success: false, error: errorMessage }
    } finally {
      setLoginLoading(false)
    }
  }

  const ssoLogin = async () => {
    try {
      setError(null)
      setLoginLoading(true)
      if (!ssoEnabled) throw new Error('SSO is not enabled')
      const authUrl = cognitoAuth.getAuthUrl()
      window.location.href = authUrl
      return { success: true, redirecting: true }
    } catch (err) {
      const errorMessage = err.message || 'SSO login failed'
      setError(errorMessage)
      setLoginLoading(false)
      return { success: false, error: errorMessage }
    }
  }

  const logout = async () => {
    try {
      await authAPI.logout()
      setUser(null)
      setError(null)
    } catch (err) {
      setUser(null)
      setError(null)
    }
  }

  const clearError = () => setError(null)

  const value = {
    user,
    login: localLogin,
    localLogin,
    ssoLogin,
    logout,
    loginLoading,
    ssoEnabled,
    error,
    clearError,
    checkingAuth,
    isLoading: checkingAuth,
    isAuthenticated: !!user,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}


