import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { config } from './config.js'
import { createAuthRouter } from './routes/auth.js'
import { createCoursesRouter } from './routes/courses.js'
import { createTransferRouter } from './routes/transfer.js'
import { MockClassroomProvider } from './adapters/google/mock-classroom-provider.js'
import { RealClassroomProvider } from './adapters/google/real-classroom-provider.js'
import type { ClassroomProvider } from './adapters/google/classroom-provider.interface.js'
import { PrismaClient } from '@prisma/client'

export interface AppDependencies {
  prisma?: PrismaClient
  provider?: ClassroomProvider
}

export function createApp(deps: AppDependencies = {}) {
  const app = express()
  const prisma = deps.prisma ?? new PrismaClient()

  app.use(
    cors({
      origin: config.corsOrigins,
      credentials: true,
    })
  )
  app.use(express.json())
  app.use(cookieParser())

  const provider: ClassroomProvider =
    deps.provider ??
    (config.googleProviderMode === 'google'
      ? new RealClassroomProvider()
      : new MockClassroomProvider(prisma, {
          perItemDelayMs: config.mockProviderDelayMs,
        }))

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      mode: config.googleProviderMode,
      timestamp: new Date().toISOString(),
    })
  })

  // Mount routes under both /api and root level to eliminate URL mismatch errors
  const authRouter = createAuthRouter()
  const coursesRouter = createCoursesRouter(provider)
  const transferRouter = createTransferRouter(provider)

  app.use('/api/auth', authRouter)
  app.use('/auth', authRouter)

  app.use('/api/courses', coursesRouter)
  app.use('/courses', coursesRouter)

  app.use('/api/transfer', transferRouter)
  app.use('/transfer', transferRouter)

  return { app, prisma, provider }
}
