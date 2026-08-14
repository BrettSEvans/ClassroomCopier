/**
 * Environment configuration, resolved once and validated at boot.
 *
 * SESSION_SECRET has a fail-fast contract: the process refuses to boot without
 * one outside test. A dev default that ships is the classic form of this bug.
 */

function required(name: string): string {
  const value = process.env[name]
  if (value == null || value.trim() === '') {
    throw new Error(
      `[config] ${name} is required and is not set. Refusing to boot — a dev default that ships is how this becomes a production incident.`,
    )
  }
  return value
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

/**
 * D25 — the two test/dev harness affordances ship in production code and are
 * inert by default AND inert under a production-like NODE_ENV. `cold-start-health`
 * has an acceptance test for exactly that, because a harness that leaks into
 * production is a harness that eventually causes an outage.
 */
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
  googleProviderMode: (process.env.GOOGLE_PROVIDER_MODE ?? 'mock') as 'mock',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  /** Test harness, not a fixture — cold start has no fixture in the manifest. */
  coldStartSimulateDelayMs: harnessDelay('COLD_START_SIMULATE_DELAY_MS'),
  /** F12's slow mode is normally a run-scoped provider option; this env var is
   *  only for driving the deployed app by hand. Never fixture data. */
  mockProviderDelayMs: harnessDelay('MOCK_PROVIDER_DELAY_MS'),
  /** D12 — the stale-heartbeat sweep runs on an interval, not only at boot. */
  reconcilerIntervalMs: intFromEnv('RECONCILER_INTERVAL_MS', 30_000),
  /**
   * D12/P0-2 — how long without a heartbeat before a job is presumed dead.
   * The executor now holds a LEASE and heartbeats through topic creation and
   * the hydration enumeration, so this is a genuine liveness signal rather than
   * a guess about how long a slow-but-alive run can be silent.
   */
  jobStaleAfterMs: intFromEnv('JOB_STALE_AFTER_MS', 60_000),
  /** APPLY-I — a pre-flight scan older than this is refused at POST
   *  /transfer-jobs rather than transferred as a stale picture. */
  scanTtlMs: intFromEnv('SCAN_TTL_MS', 10 * 60 * 1000),
  /**
   * Seeding is idempotent and safe on every boot (D3).
   *
   * APPLY-L — but it defaults to FALSE under a production-like NODE_ENV. It is
   * idempotent for the fixture rows and has no opinion at all about the posts a
   * transfer creates in a target course, so a production instance that reseeded
   * on every boot accumulated them forever — which is the accumulation that
   * used to make the reconciler's title match report un-copied posts as copied.
   */
  seedOnBoot: isProductionLike
    ? process.env.SEED_ON_BOOT === 'true'
    : process.env.SEED_ON_BOOT !== 'false',
  /**
   * APPLY-L — the explicit reset path for rows a TRANSFER created. Seeding
   * restores the fixture world; only this removes what runs added to it. On by
   * default wherever seeding is (i.e. dev/demo), never in production.
   */
  pruneGeneratedOnBoot: isProductionLike
    ? process.env.PRUNE_GENERATED_ON_BOOT === 'true'
    : process.env.PRUNE_GENERATED_ON_BOOT !== 'false',
} as const

export type AppConfig = typeof config
