import React, { useEffect, useState } from 'react'
import { SignInLanding } from './SignInLanding'

export const AuthFlow: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)

  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || ''

  useEffect(() => {
    // Check if the user is currently authenticated
    fetch(`${apiBaseUrl}/api/auth/me`, { credentials: 'include' })
      .then((res) => {
        if (res.ok) return res.json()
        return { authenticated: false }
      })
      .then((data) => {
        if (data && data.authenticated) {
          setAuthenticated(true)
        } else {
          setAuthenticated(false)
        }
      })
      .catch(() => {
        setAuthenticated(false)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [apiBaseUrl])

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-slate-500 font-medium">Loading Classroom Copier...</div>
      </div>
    )
  }

  if (!authenticated) {
    return <SignInLanding />
  }

  return <>{children}</>
}
