import { Router } from 'express'
import { google } from 'googleapis'
import { config } from '../config.js'
import { sessionStore } from '../services/session.js'

export function createAuthRouter() {
  const router = Router()

  const getOAuth2Client = () => {
    return new google.auth.OAuth2(
      config.googleClientId,
      config.googleClientSecret,
      config.googleRedirectUri
    )
  }

  // GET /api/auth/sign-in - Redirects user to Google OAuth login screen
  router.get('/sign-in', (req, res) => {
    if (config.googleProviderMode === 'mock') {
      // Return a message if server is still in mock mode
      return res.status(400).json({
        error: 'Server is currently running in mock mode. Set GOOGLE_PROVIDER_MODE=google in environment variables.',
      })
    }

    const oauth2Client = getOAuth2Client()
    const scopes = [
      'https://www.googleapis.com/auth/classroom.courses.readonly',
      'https://www.googleapis.com/auth/classroom.coursework.students',
      'https://www.googleapis.com/auth/classroom.topics',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
    ]

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'select_account', // Prevents multi-account collisions as specified in PRD
      scope: scopes,
    })

    return res.redirect(url)
  })

  // GET /api/auth/callback - Handles Google OAuth redirect response
  router.get('/callback', async (req, res) => {
    const code = req.query.code as string
    if (!code) {
      return res.status(400).send('Authorization code missing from Google callback.')
    }

    try {
      const oauth2Client = getOAuth2Client()
      const { tokens } = await oauth2Client.getToken(code)
      oauth2Client.setCredentials(tokens)

      // Get user profile info
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
      const userInfo = await oauth2.userinfo.get()

      const email = userInfo.data.email ?? 'unknown@school.edu'
      const name = userInfo.data.name ?? 'Teacher'
      const avatarUrl = userInfo.data.picture ?? undefined

      // Store credentials in active session
      const session = sessionStore.createSession({
        userId: userInfo.data.id ?? email,
        email,
        name,
        avatarUrl,
        accessToken: tokens.access_token ?? '',
        refreshToken: tokens.refresh_token ?? undefined,
      })

      res.cookie('session_id', session.id, {
        httpOnly: true,
        secure: config.isProductionLike,
        sameSite: 'lax',
      })

      // Redirect back to frontend application dashboard
      const frontendUrl = process.env.FRONTEND_URL ?? config.corsOrigins[0] ?? 'http://localhost:5173'
      return res.redirect(frontendUrl)
    } catch (err) {
      console.error('[auth/callback] Token exchange failed:', err)
      return res.status(500).send('Failed to authenticate with Google.')
    }
  })

  // GET /api/auth/me - Check current user session
  router.get('/me', (req, res) => {
    const sessionId = req.cookies?.session_id
    if (!sessionId) {
      return res.json({ authenticated: false })
    }

    const session = sessionStore.getSession(sessionId)
    if (!session) {
      return res.json({ authenticated: false })
    }

    return res.json({
      authenticated: true,
      user: {
        id: session.userId,
        name: session.name,
        email: session.email,
        avatarUrl: session.avatarUrl,
      },
    })
  })

  // POST /api/auth/sign-out - Clear user session
  router.post('/sign-out', (req, res) => {
    const sessionId = req.cookies?.session_id
    if (sessionId) {
      sessionStore.destroySession(sessionId)
    }
    res.clearCookie('session_id')
    return res.json({ success: true })
  })

  return router
}
