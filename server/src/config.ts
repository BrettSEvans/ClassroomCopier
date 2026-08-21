/**
 * Environment configuration, resolved once and validated at boot.
 *
 * SESSION_SECRET has a fail-fast contract: the process refuses to boot without
 * one outside test.
 */

function required(name: string): string {
  const value = process.env[name]
  if (value == null || value.trim() === '') {
    throw new Error(
      `[config] ${name} is required and is not set. Refusing to boot.`,
    )
  }
  return value
}

function optional(name: string, fallback: string = ''): string {
  return process.env[name] ?? fallback
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw == null || raw.trim() === '') return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const nodeEnv = process.env.NODE_ENV ?? 'development'
const isProductionLike = nodeEnv === 'production'
const isTest = nodeEnv === 'test' || process.env.VITEST === 'true'

function harnessDelay(name: string): number {
  if (isProductionLike) return 0
  return intFromEnv(name, 0)
}

export const config = {
  nodeEnv,
  isProductionLike,
  isTest,
  port: intFromEnv('PORT', 4000),
  sessionSecret: isTest ? (process.env.SESSION_SECRET ?? 'test-secret') : required('SESSION_SECRET'),
  sessionTtlMs: intFromEnv('SESSION_TTL_MS', 24 * 60 * 60 * 1000),
  featureMonetizationEnabled: process.env.FEATURE_MONETIZATION_ENABLED === 'true',
  
  // Google Provider Config
  googleProviderMode: (process.env.GOOGLE_PROVIDER_MODE ?? 'mock') as 'mock' | 'google',
  googleClientId: optional('GOOGLE_CLIENT_ID'),
  googleClientSecret: optional('GOOGLE_CLIENT_SECRET'),
  googleRedirectUri: optional('GOOGLE_REDIRECT_URI', 'http://localhost:4000/api/auth/callback'),
  
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  
  coldStartSimulateDelayMs: harnessDelay('COLD_START_SIMULATE_DELAY_MS'),
  mockProviderDelayMs: harnessDelay('MOCK_PROVIDER_DELAY_MS'),
  reconcilerIntervalMs: intFromEnv('RECONCILER_INTERVAL_MS', 30_000),
  jobStaleAfterMs: intFromEnv('JOB_STALE_AFTER_MS', 60_000),
  scanTtlMs: intFromEnv('SCAN_TTL_MS', 10 * 60 * 1000),
  
  seedOnBoot: isProductionLike
    ? process.env.SEED_ON_BOOT === 'true'
    : process.env.SEED_ON_BOOT !== 'false',
  pruneGeneratedOnBoot: isProductionLike
    ? process.env.PRUNE_GENERATED_ON_BOOT === 'true'
    : process.env.PRUNE_GENERATED_ON_BOOT !== 'false',
} as const

export type AppConfig = typeof config
