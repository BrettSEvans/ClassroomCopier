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

  // Middleware setup
  app.use(
    cors({
      origin: config.corsOrigins,
      credentials: true,
    })
  )
  app.use(express.json())
  app.use(cookieParser())

  // Instantiate Provider based on googleProviderMode configuration
  const provider: ClassroomProvider =
    deps.provider ??
    (config.googleProviderMode === 'google'
      ? new RealClassroomProvider()
      : new MockClassroomProvider(prisma, {
          perItemDelayMs: config.mockProviderDelayMs,
        }))

  // Health check route
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      mode: config.googleProviderMode,
      timestamp: new Date().toISOString(),
    })
  })

  // Register API routers
  app.use('/api/auth', createAuthRouter())
  app.use('/api/courses', createCoursesRouter(provider))
  app.use('/api/transfer', createTransferRouter(provider))

  return { app, prisma, provider }
}
