/**
 * composition-root — the ONLY module with a runtime dependency on
 * `mock-classroom-provider`. Everything else depends on the type-only port,
 * which emits no JavaScript, so nothing can import a concrete provider by
 * accident.
 */
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import { MockClassroomProvider, type MockProviderOptions } from './adapters/mock/mock-classroom-provider.js'
import type { ClassroomProvider } from './adapters/classroom-provider.interface.js'
import {
  LicenseBlockedError,
  NotFoundError,
  PermissionError,
  RateLimitError,
} from './adapters/types.js'
import { config } from './config.js'
import { logger } from './logger.js'
import { authRouter } from './routes/auth.js'
import { coursesRouter } from './routes/courses.js'
import { healthRouter } from './routes/health.js'
import { transferJobsRouter } from './routes/transfer-jobs.js'
import { JobReconciler } from './services/job-reconciler.js'
import { createMonetizationService, type MonetizationService } from './services/monetization.js'
import { TransferEngine, type TransferEngineOptions } from './services/transfer-engine.js'

export interface AppDeps {
  prisma: PrismaClient
  provider?: ClassroomProvider
  providerOptions?: MockProviderOptions
  engineOptions?: Omit<TransferEngineOptions, 'onJobComplete'>
  monetization?: MonetizationService
}

export interface BuiltApp {
  app: Express
  provider: ClassroomProvider
  engine: TransferEngine
  reconciler: JobReconciler
  monetization: MonetizationService
}

export function buildApp(deps: AppDeps): BuiltApp {
  const { prisma } = deps

  // GOOGLE_PROVIDER_MODE selects the concrete adapter. 'mock' is the only mode
  // implemented in v1, and this is the one place that knows it.
  const provider =
    deps.provider ??
    new MockClassroomProvider(prisma, {
      perItemDelayMs: config.mockProviderDelayMs,
      ...deps.providerOptions,
    })

  const monetization = deps.monetization ?? createMonetizationService(prisma)

  // D28 — the monetization completion hook, injected as a callback so the
  // dependency edge still points from monetization toward the engine's caller
  // rather than the other way around.
  const engine = new TransferEngine(prisma, provider, {
    ...deps.engineOptions,
    onJobComplete: (summary) => monetization.onJobComplete(summary),
  })

  const reconciler = new JobReconciler(prisma, provider, {
    staleAfterMs: config.jobStaleAfterMs,
  })

  const app = express()
  app.use(
    cors({
      // Never `*` with credentials — a pinned allowlist, because the frontend
      // and API are split-origin Render services.
      origin: config.corsOrigins,
      credentials: true,
    }),
  )
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())

  // Mount order matters: health and auth are never behind the monetization
  // gate, and the status endpoint must never be gated by a credit check.
  app.use('/api', healthRouter())
  app.use('/api', authRouter(prisma))
  app.use('/api', coursesRouter(prisma, provider))
  app.use('/api', transferJobsRouter(prisma, engine, monetization))

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: `No route for ${req.path}` } })
  })

  // One error-handling middleware normalises provider errors into consistent
  // HTTP responses.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof RateLimitError) {
      res.status(429).json({ error: { code: 'rate_limited', message: error.message } })
      return
    }
    if (error instanceof PermissionError) {
      res.status(403).json({ error: { code: 'permission_denied', message: error.message } })
      return
    }
    if (error instanceof NotFoundError) {
      res.status(404).json({ error: { code: 'not_found', message: error.message } })
      return
    }
    if (error instanceof LicenseBlockedError) {
      res.status(409).json({ error: { code: 'license_blocked', message: error.message } })
      return
    }
    logger.error('unhandled request error', {
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    })
    res.status(500).json({ error: { code: 'internal', message: 'Something went wrong.' } })
  })

  return { app, provider, engine, reconciler, monetization }
}
