/**
 * The composition-root acceptance gates.
 *
 * QA-1 — `04-architecture.md`'s `composition-root` module requires "a second
 * test asserts the interval reconciler resolves a job wedged in 'running'
 * WITHOUT a process restart". Every existing test called `reconcileStaleJobs()`
 * directly and synchronously, which proves the reconciliation LOGIC and says
 * nothing about the interval SCHEDULING that is half of D12's claim — and the
 * scheduling is wired at the composition root, not inside the reconciler's own
 * unit tests. So this drives the wiring `buildApp` actually produces.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { FIXTURE_KEYS } from '../src/fixtures/index.js'
import { countOutcomes } from '../src/services/reconciliation.js'
import { createTestDb, type TestDb } from './helpers/db.js'
import { scanAndCreateJob } from './helpers/transfer.js'

let db: TestDb
beforeEach(async () => {
  db = await createTestDb()
})
afterEach(async () => {
  await db.dispose()
})

async function wedgedJob(): Promise<string> {
  const run = await scanAndCreateJob(db.prisma, {
    accountId: 'acct-jamie',
    sourceCourseId: FIXTURE_KEYS.F1,
    targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
  })
  await db.prisma.transferJob.update({
    where: { id: run.jobId },
    data: {
      status: 'running',
      startedAt: new Date(Date.now() - 20 * 60_000),
      // Older than the default `jobStaleAfterMs` (60s) the composition root
      // hands the reconciler.
      lastHeartbeatAt: new Date(Date.now() - 20 * 60_000),
    },
  })
  return run.jobId
}

describe('composition-root — the interval reconciler', () => {
  it('resolves a job wedged in "running" WITHOUT a process restart (D12)', async () => {
    const jobId = await wedgedJob()
    const { reconciler } = buildApp({ prisma: db.prisma })

    // Nothing has run yet: this is the state the user was stuck in, watching a
    // counter that would never move, with no cancel control to escape it.
    expect(
      (await db.prisma.transferJob.findUniqueOrThrow({ where: { id: jobId } })).status,
    ).toBe('running')

    const stop = reconciler.start(20)
    try {
      const deadline = Date.now() + 3000
      let status = 'running'
      while (Date.now() < deadline && status === 'running') {
        await new Promise((resolve) => setTimeout(resolve, 20))
        status = (await db.prisma.transferJob.findUniqueOrThrow({ where: { id: jobId } })).status
      }
      expect(status).toBe('interrupted')
    } finally {
      stop()
    }

    const job = await db.prisma.transferJob.findUniqueOrThrow({ where: { id: jobId } })
    expect(job.activeAccountId, 'the single-active-job guard was not released').toBeNull()
    expect(job.executorId).toBeNull()
    expect((await countOutcomes(db.prisma, jobId)).pending).toBe(0)
  })

  it('stops firing once the returned disposer is called', async () => {
    const { reconciler } = buildApp({ prisma: db.prisma })
    const stop = reconciler.start(10)
    stop()

    const jobId = await wedgedJob()
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(
      (await db.prisma.transferJob.findUniqueOrThrow({ where: { id: jobId } })).status,
      'the interval kept running after shutdown',
    ).toBe('running')
  })
})
