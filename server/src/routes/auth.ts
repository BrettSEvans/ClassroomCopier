import { Router } from 'express'
import type { PrismaClient } from '@prisma/client'
import { SignInRequestSchema } from '@classroom-copier/shared'
import { requireAuth } from '../middleware/auth.js'
import {
  SESSION_COOKIE,
  clearCookieOptions,
  cookieOptions,
  createSession,
  resolveSession,
  revokeSession,
} from '../services/session.js'

/**
 * auth-module. The forced picker is a property of the SIGN-IN ROUTE — it always
 * mints a fresh session — rather than a conditional on an existing one. Written
 * as "hide the picker if a session exists" it is a conditional someone can
 * later optimise away; written this way, "never skipped, never remembered" is
 * structural.
 */
export function authRouter(prisma: PrismaClient): Router {
  const router = Router()

  router.get('/auth/mock-accounts', async (_req, res) => {
    const accounts = await prisma.mockAccount.findMany({ orderBy: { displayName: 'asc' } })
    res.json({
      accounts: accounts.map((a) => ({
        id: a.id,
        displayName: a.displayName,
        email: a.email,
        initials: a.initials,
      })),
    })
  })

  router.post('/auth/sign-in', async (req, res) => {
    const parsed = SignInRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'bad_request', message: 'accountId is required.' } })
      return
    }
    const account = await prisma.mockAccount.findUnique({ where: { id: parsed.data.accountId } })
    if (!account) {
      res.status(404).json({ error: { code: 'not_found', message: 'No such account.' } })
      return
    }

    // Revoke whatever was there. Always minting a fresh session is what makes
    // the picker unskippable and what makes "switch account" safe.
    const existing = await resolveSession(
      prisma,
      (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE],
    )
    if (existing) await revokeSession(prisma, existing.sessionId)

    const { token, expiresAt } = await createSession(prisma, account.id)
    res.cookie(SESSION_COOKIE, token, cookieOptions(expiresAt))
    res.json({
      account: {
        id: account.id,
        displayName: account.displayName,
        email: account.email,
        initials: account.initials,
      },
    })
  })

  router.post('/auth/sign-out', async (req, res) => {
    const session = await resolveSession(
      prisma,
      (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE],
    )
    if (session) await revokeSession(prisma, session.sessionId)
    res.clearCookie(SESSION_COOKIE, clearCookieOptions())
    res.status(204).end()
  })

  router.get('/auth/me', requireAuth(prisma), async (req, res) => {
    const account = await prisma.mockAccount.findUnique({ where: { id: req.auth!.accountId } })
    if (!account) {
      res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign in to continue.' } })
      return
    }
    res.json({
      account: {
        id: account.id,
        displayName: account.displayName,
        email: account.email,
        initials: account.initials,
      },
    })
  })

  return router
}
