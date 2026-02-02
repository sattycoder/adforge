import React, { useState } from 'react'
import MainInterface from './pages/MainInterface'
import { useAuth } from './auth/AuthContext.jsx'

function LoginScreen() {
  const { localLogin, ssoLogin, ssoEnabled, loginLoading, error, clearError } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const onSubmit = async (e) => {
    e.preventDefault()
    await localLogin(email, password)
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white shadow-lg rounded-lg p-6 space-y-4">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Sign in</h2>
          <p className="text-sm text-gray-600">Use the "Sign in with Microsoft" button for SSO authentication.</p>
        </div>

        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
            {error}
            <button className="ml-2 text-xs underline" onClick={clearError}>dismiss</button>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="block text-sm text-gray-700">Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="mt-1 w-full border rounded px-3 py-2 focus:outline-none focus:ring" />
          </div>
          <div>
            <label className="block text-sm text-gray-700">Password</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" className="mt-1 w-full border rounded px-3 py-2 focus:outline-none focus:ring" />
          </div>
          <button type="submit" disabled={loginLoading} className="w-full bg-gray-900 text-white py-2 rounded hover:bg-black disabled:opacity-50">
            {loginLoading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center" aria-hidden="true">
            <div className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="bg-white px-2 text-gray-500">or</span>
          </div>
        </div>

        <button onClick={ssoLogin} disabled={!ssoEnabled || loginLoading} className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50">
          Login with Microsoft
        </button>

        {!ssoEnabled && (
          <div className="text-xs text-gray-500 text-center">SSO not configured yet.</div>
        )}
      </div>
    </div>
  )
}

function App() {
  const { isAuthenticated } = useAuth()
  if (!isAuthenticated) {
    return <div className="min-h-screen bg-gray-100"><LoginScreen /></div>
  }
  return <div className="min-h-screen bg-gray-100"><MainInterface /></div>
}

export default App
