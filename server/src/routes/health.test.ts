/**
 * cold-start-health. Cold start has NO fixture in F1–F14 and this module does
 * not retroactively claim otherwise — what it provides is a deterministic,
 * env-gated harness, and these tests exist mostly to prove the harness cannot
 * leak into production behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const ORIGINAL_ENV = { ...process.env }

async function appWith(env: Record<string, string | undefined>) {
  vi.resetModules()
  process.env = { ...ORIGINAL_ENV, ...env }
  const { healthRouter } = await import('./health.js')
  const app = express()
  app.use('/api', healthRouter())
  return app
}

beforeEach(() => {
  vi.resetModules()
})
afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.resetModules()
})

describe('GET /api/health', () => {
  it('responds under 50ms with the harness flag unset', async () => {
    const app = await appWith({ COLD_START_SIMULATE_DELAY_MS: undefined, NODE_ENV: 'test' })
    const startedAt = performance.now()
    const res = await request(app).get('/api/health').expect(200)
    const elapsed = performance.now() - startedAt
    expect(res.body.status).toBe('ok')
    expect(elapsed).toBeLessThan(50)
  })

  it('honours the configured delay when the flag is set', async () => {
    const app = await appWith({ COLD_START_SIMULATE_DELAY_MS: '120', NODE_ENV: 'test' })
    const startedAt = performance.now()
    await request(app).get('/api/health').expect(200)
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(100)
  })

  it('D25 — the flag has NO effect under a production-like NODE_ENV', async () => {
    // A test/dev harness shipping in production code is only acceptable if it
    // is provably inert there.
    const app = await appWith({
      COLD_START_SIMULATE_DELAY_MS: '5000',
      NODE_ENV: 'production',
      SESSION_SECRET: 'set-for-this-test',
    })
    const startedAt = performance.now()
    await request(app).get('/api/health').expect(200)
    expect(performance.now() - startedAt).toBeLessThan(200)
  })

  it('D25 — the F12 slow-mode env var is likewise inert in production', async () => {
    vi.resetModules()
    process.env = {
      ...ORIGINAL_ENV,
      MOCK_PROVIDER_DELAY_MS: '5000',
      NODE_ENV: 'production',
      SESSION_SECRET: 'set-for-this-test',
    }
    const { config } = await import('../config.js')
    expect(config.mockProviderDelayMs).toBe(0)
    expect(config.coldStartSimulateDelayMs).toBe(0)
  })
})

describe('SESSION_SECRET fail-fast contract', () => {
  it('refuses to load config without a secret outside test', async () => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'production', SESSION_SECRET: '', VITEST: '' }
    await expect(import('../config.js')).rejects.toThrow(/SESSION_SECRET/)
  })
})
