import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attachmentFallbackNote,
  rateLimitExhaustionNote,
  type Resolution,
} from '@classroom-copier/shared'
import { MockClassroomProvider } from '../adapters/mock/mock-classroom-provider.js'
import { PermissionError, RateLimitError } from '../adapters/types.js'
import { FIXTURE_KEYS } from '../fixtures/index.js'
import { createTestDb, type TestDb } from '../../test/helpers/db.js'
import { FAST_ENGINE, runTransfer, scanAndCreateJob } from '../../test/helpers/transfer.js'
import { MAX_ATTEMPTS } from './backoff.js'
import { checkInvariant, countOutcomes } from './reconciliation.js'
import { PreflightEngine } from './preflight-engine.js'
import { TransferEngine, createTransferJob } from './transfer-engine.js'

let db: TestDb
beforeEach(async () => {
  db = await createTestDb()
})
afterEach(async () => {
  await db.dispose()
})

interface Who { accountId: string; targetCourseId: string }
const JAMIE: Who = { accountId: 'acct-jamie', targetCourseId: FIXTURE_KEYS.TARGET_JAMIE }
const DANA: Who = { accountId: 'acct-dana', targetCourseId: FIXTURE_KEYS.TARGET_DANA }

/* ================================================================= *
 * The invariant — the load-bearing artifact of the zero-silent-drop
 * guarantee. Note that totalPostsScanned is read from the PERSISTED
 * scan row, not recomputed in the test: the old gate derived both
 * sides from one in-test read and therefore could not fail.
 * ================================================================= */

describe('reconciliation invariant across every fixture', () => {
  const cases: { name: string; source: string; who: Who }[] = [
    { name: 'F1 healthy', source: FIXTURE_KEYS.F1, who: JAMIE },
    { name: 'F2 trashed/deleted', source: FIXTURE_KEYS.F2, who: JAMIE },
    { name: 'F3 permission-locked', source: FIXTURE_KEYS.F3, who: JAMIE },
    { name: 'F4 fifty posts', source: FIXTURE_KEYS.F4, who: JAMIE },
    { name: 'F5 attachment cap', source: FIXTURE_KEYS.F5, who: JAMIE },
    { name: 'F6 transient 429', source: FIXTURE_KEYS.F6, who: DANA },
    { name: 'F7 rubric licence denial', source: FIXTURE_KEYS.F7, who: DANA },
    { name: 'F13 persistent 429', source: FIXTURE_KEYS.F13, who: DANA },
    { name: 'F14 empty course', source: FIXTURE_KEYS.F14, who: DANA },
  ]

  for (const testCase of cases) {
    it(`${testCase.name}: transferred + fallback + skipped == count(items) == scan.totalPostsScanned`, async () => {
      const { jobId } = await runTransfer(db.prisma, {
        ...testCase.who,
        sourceCourseId: testCase.source,
      })
      const result = await checkInvariant(db.prisma, jobId)
      expect(result.holds, result.detail).toBe(true)
      expect(result.counts.pending).toBe(0)
    })
  }

  it('topicsCreatedOrMapped is NOT a term in the sum', async () => {
    const { jobId } = await runTransfer(db.prisma, { ...JAMIE, sourceCourseId: FIXTURE_KEYS.F1 })
    const job = await db.prisma.transferJob.findUniqueOrThrow({ where: { id: jobId } })
    const result = await checkInvariant(db.prisma, jobId)
    expect(job.topicsCreatedOrMapped).toBeGreaterThan(0)
    const sum =
      result.counts.transferred + result.counts.fallbackShell + result.counts.skippedTotal
    expect(sum).toBe(result.totalPostsScanned)
    expect(sum + job.topicsCreatedOrMapped).not.toBe(result.totalPostsScanned)
  })

  it('rubricDegraded co-occurs with an outcome without changing the sum', async () => {
    const { jobId } = await runTransfer(db.prisma, { ...DANA, sourceCourseId: FIXTURE_KEYS.F7 })
    const counts = await countOutcomes(db.prisma, jobId)
    expect(counts.rubricNotesAdded).toBeGreaterThan(0)
    expect(counts.transferred + counts.fallbackShell + counts.skippedTotal).toBe(counts.totalItems)
  })
})

/* ================================================================= *
 * D11 — the identity is definitional because there is ONE scan
 * ================================================================= */

describe('D11 — one measurement, two readers', () => {
  it('a job created from a scan has exactly scan.totalPostsScanned items EVEN IF the course changes in between', async () => {
    // This is the assertion the old tautological gate could not make: both its
    // sides came from a single in-test read of the same fixture.
    const provider = new MockClassroomProvider(db.prisma)
    const scan = await new PreflightEngine(db.prisma, provider).run({
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F1,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })

    // Mutate the source course after the scan and before the job.
    await db.prisma.mockCourseWork.create({
      data: {
        id: 'cw-f1-inserted-after-scan',
        courseId: FIXTURE_KEYS.F1,
        title: 'Snuck in after the scan',
        workType: 'ASSIGNMENT',
        state: 'PUBLISHED',
        creationTime: new Date('2025-08-06T09:00:00.000Z'),
        createdOrder: 99,
      },
    })

    const { jobId } = await createTransferJob(db.prisma, {
      accountId: 'acct-jamie',
      scanId: scan.scanId,
      resolutions: [],
    })
    const items = await db.prisma.transferJobItem.count({ where: { jobId } })
    expect(items).toBe(scan.totalPostsScanned)

    // And re-enumerating now would give a DIFFERENT number — which is exactly
    // the divergence the persisted scan removes.
    const reScan = await new PreflightEngine(db.prisma, provider).run({
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F1,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })
    expect(reScan.totalPostsScanned).toBe(scan.totalPostsScanned + 1)
  })
})

/* ================================================================= *
 * D12 — the outcome function is TOTAL
 * ================================================================= */

describe('D12 — no error type leaves an item pending', () => {
  it('a PermissionError from the provider resolves the item terminally', async () => {
    const run = await scanAndCreateJob(db.prisma, { ...JAMIE, sourceCourseId: FIXTURE_KEYS.F1 })
    vi.spyOn(run.provider, 'createCourseWork').mockRejectedValue(
      new PermissionError('nope'),
    )
    await run.engine.run(run.jobId)

    const result = await checkInvariant(db.prisma, run.jobId)
    expect(result.holds, result.detail).toBe(true)
    const skipped = await db.prisma.transferJobItem.findMany({
      where: { jobId: run.jobId, skipReason: 'provider_error' },
    })
    expect(skipped.length).toBeGreaterThan(0)
  })

  it('an arbitrary Error resolves the item terminally too', async () => {
    const run = await scanAndCreateJob(db.prisma, { ...JAMIE, sourceCourseId: FIXTURE_KEYS.F1 })
    vi.spyOn(run.provider, 'createCourseWorkMaterial').mockRejectedValue(
      new TypeError('cannot read properties of undefined'),
    )
    await run.engine.run(run.jobId)

    const result = await checkInvariant(db.prisma, run.jobId)
    expect(result.holds, result.detail).toBe(true)
  })

  it('a job whose executor throws at the TOP LEVEL lands status=failed with zero pending items', async () => {
    const run = await scanAndCreateJob(db.prisma, { ...JAMIE, sourceCourseId: FIXTURE_KEYS.F1 })
    // Blow up before the item loop, in the topic-map build.
    vi.spyOn(run.provider, 'listTopics').mockRejectedValue(new Error('boom'))
    await run.engine.run(run.jobId)

    const job = await db.prisma.transferJob.findUniqueOrThrow({ where: { id: run.jobId } })
    expect(job.status).toBe('failed')
    expect(job.activeAccountId).toBeNull()
    const counts = await countOutcomes(db.prisma, run.jobId)
    expect(counts.pending).toBe(0)
    expect(counts.transferred + counts.fallbackShell + counts.skippedTotal).toBe(counts.totalItems)
  })

  it('sweeps any straggler pending item before writing completed', async () => {
    const run = await scanAndCreateJob(db.prisma, { ...JAMIE, sourceCourseId: FIXTURE_KEYS.F1 })
    await run.engine.run(run.jobId)
    const job = await db.prisma.transferJob.findUniqueOrThrow({ where: { id: run.jobId } })
    expect(job.status).toBe('completed')
    expect((await countOutcomes(db.prisma, run.jobId)).pending).toBe(0)
  })
})

/* ================================================================= *
 * D13 — F13's guaranteed shell is reachable because it is a
 * DIFFERENT CALL with a DIFFERENT PAYLOAD
 * ================================================================= */

describe('D13 — rate-limit exhaustion produces a REAL post, not a ledger row', () => {
  it('exhausts exactly 5 attempts, lands fallback_shell, and creates an actual target post', async () => {
    const { jobId } = await runTransfer(db.prisma, { ...DANA, sourceCourseId: FIXTURE_KEYS.F13 })
    const item = await db.prisma.transferJobItem.findFirstOrThrow({
      where: { jobId, title: 'Semester Reflection Prompt' },
    })

    expect(item.attemptCount).toBe(MAX_ATTEMPTS)
    expect(item.outcome).toBe('fallback_shell')
    // The whole point: the item CLAIMS a post, and the post EXISTS.
    expect(item.targetPostId).not.toBeNull()
    const created = await db.prisma.mockCourseWork.findUnique({
      where: { id: item.targetPostId! },
    })
    expect(created).not.toBeNull()
    expect(created!.state).toBe('DRAFT')
  })

  it('uses the rate-limit note, DISTINCT from the attachment-failure note', async () => {
    const { jobId } = await runTransfer(db.prisma, { ...DANA, sourceCourseId: FIXTURE_KEYS.F13 })
    const item = await db.prisma.transferJobItem.findFirstOrThrow({
      where: { jobId, outcome: 'fallback_shell' },
    })
    expect(item.note).toBe(rateLimitExhaustionNote(MAX_ATTEMPTS))
    expect(item.note).not.toBe(attachmentFallbackNote('Reflection prompt.docx'))
  })

  it('creates the shell with NO materials — the payload is what differs', async () => {
    const { jobId } = await runTransfer(db.prisma, { ...DANA, sourceCourseId: FIXTURE_KEYS.F13 })
    const item = await db.prisma.transferJobItem.findFirstOrThrow({
      where: { jobId, outcome: 'fallback_shell' },
    })
    const attachments = await db.prisma.mockAttachment.count({
      where: { parentId: item.targetPostId! },
    })
    expect(attachments).toBe(0)
  })

  it('resolves honestly to skipped/rate_limit_exhausted if even the bare shell fails', async () => {
    const run = await scanAndCreateJob(db.prisma, { ...DANA, sourceCourseId: FIXTURE_KEYS.F13 })
    vi.spyOn(run.provider, 'createCourseWork').mockRejectedValue(new RateLimitError('always'))
    await run.engine.run(run.jobId)

    const result = await checkInvariant(db.prisma, run.jobId)
    expect(result.holds, result.detail).toBe(true)
    const exhausted = await db.prisma.transferJobItem.findMany({
      where: { jobId: run.jobId, skipReason: 'rate_limit_exhausted' },
    })
    expect(exhausted.length).toBeGreaterThan(0)
  })
})

describe('F6 — a transient 429 recovers within the cap', () => {
  it('retries and transfers rather than falling back', async () => {
    const { jobId } = await runTransfer(db.prisma, { ...DANA, sourceCourseId: FIXTURE_KEYS.F6 })
    const item = await db.prisma.transferJobItem.findFirstOrThrow({
      where: { jobId, title: 'Chapter 2 Reading Guide' },
    })
    expect(item.outcome).toBe('transferred')
    expect(item.attemptCount).toBeGreaterThan(1)
    expect(item.attemptCount).toBeLessThan(MAX_ATTEMPTS)
  })
})

/* ================================================================= *
 * D15 — the resolution -> outcome mapping
 * ================================================================= */

describe('D15 — every Action-Sheet option maps to exactly one bucket', () => {
  async function withResolution(kind: Resolution['kind'], source: string) {
    const provider = new MockClassroomProvider(db.prisma)
    const scan = await new PreflightEngine(db.prisma, provider).run({
      accountId: 'acct-jamie',
      sourceCourseId: source,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })
    const finding = scan.findings[0]!
    const { jobId } = await createTransferJob(db.prisma, {
      accountId: 'acct-jamie',
      scanId: scan.scanId,
      resolutions: [{ kind, findingId: finding.id } as Resolution],
    })
    await new TransferEngine(db.prisma, provider, FAST_ENGINE).run(jobId)
    const item = await db.prisma.transferJobItem.findFirstOrThrow({
      where: { jobId, scanItemId: finding.scanItemId },
    })
    return { item, finding, jobId }
  }

  it('Create Draft Shell with Note -> fallback_shell, with the canonical note in the description', async () => {
    const { item, finding } = await withResolution('create_draft_shell_with_note', FIXTURE_KEYS.F2)
    expect(item.outcome).toBe('fallback_shell')
    expect(item.targetPostId).not.toBeNull()

    const created =
      item.sourceType === 'courseWork'
        ? await db.prisma.mockCourseWork.findUnique({ where: { id: item.targetPostId! } })
        : await db.prisma.mockCourseWorkMaterial.findUnique({ where: { id: item.targetPostId! } })
    // UX Acceptance Scenario 3 — the resulting post's description contains the
    // EXACT fallback-note text, rendered in full.
    expect(created!.description).toContain(attachmentFallbackNote(finding.attachmentName))
  })

  it('Skip <Type> -> skipped / user_skip_post, and nothing is written to the target', async () => {
    const { item } = await withResolution('skip_post', FIXTURE_KEYS.F2)
    expect(item.outcome).toBe('skipped')
    expect(item.skipReason).toBe('user_skip_post')
    expect(item.targetPostId).toBeNull()
  })

  it('Copy to My Drive -> transferred, linking the COPY and leaving the source alone (P0-3)', async () => {
    const source = await db.prisma.mockAttachment.findUniqueOrThrow({
      where: { id: 'att-f3-1a' },
    })
    const { item } = await withResolution('copy_to_my_drive', FIXTURE_KEYS.F3)
    expect(item.outcome).toBe('transferred')

    // The source course is never touched — the product's one promise about it.
    const sourceAfter = await db.prisma.mockAttachment.findUniqueOrThrow({
      where: { id: 'att-f3-1a' },
    })
    expect(sourceAfter.ownerAccountId).toBe(source.ownerAccountId)
    expect(sourceAfter.driveFileId).toBe(source.driveFileId)
    expect(sourceAfter.driveState).toBe('permission_locked')

    // And the created post links the COPY, not the still-locked original. The
    // engine used to discard `newDriveFileId` and re-read the source rows,
    // which only worked because the mock was secretly a move.
    const linked = await db.prisma.mockAttachment.findMany({
      where: { parentId: item.targetPostId! },
    })
    expect(linked.length).toBeGreaterThan(0)
    const copied = linked.find((a) => a.driveFileId?.includes('-copy-acct-jamie'))
    expect(copied, 'the created post does not link the copied file').toBeDefined()
    expect(copied!.driveFileId).not.toBe(source.driveFileId)
  })

  it('Link Existing File -> transferred, keeping the attachment linked as-is', async () => {
    const { item } = await withResolution('link_existing_file', FIXTURE_KEYS.F3)
    expect(item.outcome).toBe('transferred')
    const attachments = await db.prisma.mockAttachment.count({
      where: { parentId: item.targetPostId! },
    })
    expect(attachments).toBeGreaterThan(0)
  })

  it('Skip Attachment and Note Draft -> fallback_shell (the decided ambiguous row)', async () => {
    const { item } = await withResolution('skip_attachment_and_note_draft', FIXTURE_KEYS.F3)
    expect(item.outcome).toBe('fallback_shell')
    expect(item.targetPostId).not.toBeNull()
    const attachments = await db.prisma.mockAttachment.count({
      where: { parentId: item.targetPostId! },
    })
    expect(attachments).toBe(0)
  })
})

/* ================================================================= *
 * Product rules
 * ================================================================= */

describe('post transformation rules', () => {
  it('F8/F12 — every target post is a DRAFT with dates cleared, whatever the source state', async () => {
    const { jobId } = await runTransfer(db.prisma, { ...JAMIE, sourceCourseId: FIXTURE_KEYS.F1 })
    const items = await db.prisma.transferJobItem.findMany({
      where: { jobId, outcome: 'transferred', sourceType: 'courseWork' },
    })
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      const post = await db.prisma.mockCourseWork.findUniqueOrThrow({
        where: { id: item.targetPostId! },
      })
      expect(post.state).toBe('DRAFT')
      expect(post.dueDate).toBeNull()
      expect(post.scheduledTime).toBeNull()
    }
  })

  it('F9 — Questions keep their answer config and Quiz assignments keep their form link', async () => {
    const { jobId } = await runTransfer(db.prisma, { ...JAMIE, sourceCourseId: FIXTURE_KEYS.F1 })
    const mc = await db.prisma.transferJobItem.findFirstOrThrow({
      where: { jobId, title: 'Discussion: Whose frontier?' },
    })
    const post = await db.prisma.mockCourseWork.findUniqueOrThrow({
      where: { id: mc.targetPostId! },
    })
    expect(post.workType).toBe('MULTIPLE_CHOICE_QUESTION')
    expect(JSON.parse(post.answerConfig!)).toEqual({
      type: 'multipleChoice',
      choices: ['Settler', 'Indigenous', 'Federal', 'Commercial'],
    })

    const quiz = await db.prisma.transferJobItem.findFirstOrThrow({
      where: { jobId, title: 'Quiz: Chapter 2' },
    })
    const quizPost = await db.prisma.mockCourseWork.findUniqueOrThrow({
      where: { id: quiz.targetPostId! },
    })
    expect(quizPost.quizFormLink).toBe('https://forms.mock/f1-quiz-ch2')
    expect(quizPost.maxPoints).toBe(50)
  })

  it('shareMode is COPIED, never defaulted to VIEW', async () => {
    const { jobId } = await runTransfer(db.prisma, { ...JAMIE, sourceCourseId: FIXTURE_KEYS.F1 })
    const essay = await db.prisma.transferJobItem.findFirstOrThrow({
      where: { jobId, title: 'Essay 1: Founding Documents' },
    })
    const attachments = await db.prisma.mockAttachment.findMany({
      where: { parentId: essay.targetPostId! },
    })
    expect(attachments[0]!.shareMode).toBe('STUDENT_COPY')
  })

  it('F5 — attachments 1-20 link directly and 21+ become description URLs, by sortOrder', async () => {
    const { jobId } = await runTransfer(db.prisma, { ...JAMIE, sourceCourseId: FIXTURE_KEYS.F5 })
    const item = await db.prisma.transferJobItem.findFirstOrThrow({ where: { jobId } })
    const linked = await db.prisma.mockAttachment.findMany({
      where: { parentId: item.targetPostId! },
      orderBy: { sortOrder: 'asc' },
    })
    expect(linked).toHaveLength(20)
    // Deterministic: it is the FIRST twenty by sortOrder, every time.
    expect(linked.map((a) => a.title)).toEqual(
      Array.from({ length: 20 }, (_, i) => `Plate ${String(i + 1).padStart(2, '0')}.jpg`),
    )
    const post = await db.prisma.mockCourseWork.findUniqueOrThrow({
      where: { id: item.targetPostId! },
    })
    expect(post.description).toContain('Plate 21.jpg')
    expect(post.description).toContain('Plate 23.jpg')
  })

  it('F11 — topics are mapped old->new and an untopiced post stays untopiced', async () => {
    const { jobId } = await runTransfer(db.prisma, { ...JAMIE, sourceCourseId: FIXTURE_KEYS.F1 })
    const job = await db.prisma.transferJob.findUniqueOrThrow({ where: { id: jobId } })
    expect(job.topicsCreatedOrMapped).toBe(2)

    const untopiced = await db.prisma.transferJobItem.findFirstOrThrow({
      where: { jobId, title: 'Exit ticket: one takeaway' },
    })
    const post = await db.prisma.mockCourseWork.findUniqueOrThrow({
      where: { id: untopiced.targetPostId! },
    })
    // Never miscategorised into an existing topic.
    expect(post.topicId).toBeNull()

    const topiced = await db.prisma.transferJobItem.findFirstOrThrow({
      where: { jobId, title: 'Essay 1: Founding Documents' },
    })
    const topicedPost = await db.prisma.mockCourseWork.findUniqueOrThrow({
      where: { id: topiced.targetPostId! },
    })
    expect(topicedPost.topicId).not.toBeNull()
    // ...and it is a topic in the TARGET course, not the source's id.
    const topic = await db.prisma.mockTopic.findUniqueOrThrow({
      where: { id: topicedPost.topicId! },
    })
    expect(topic.courseId).toBe(FIXTURE_KEYS.TARGET_JAMIE)
    expect(topic.name).toBe('Unit 1 — Foundations')
  })

  it('F7 — a licence-blocked rubric degrades to a note; the post still counts as transferred', async () => {
    const { jobId } = await runTransfer(db.prisma, { ...DANA, sourceCourseId: FIXTURE_KEYS.F7 })
    const item = await db.prisma.transferJobItem.findFirstOrThrow({ where: { jobId } })
    expect(item.outcome).toBe('transferred')
    expect(item.rubricDegraded).toBe(true)
    const post = await db.prisma.mockCourseWork.findUniqueOrThrow({
      where: { id: item.targetPostId! },
    })
    expect(post.description).toContain('rubric')
  })

  it('D24 — a licence-permitted rubric copies with criteria and levels, rubricDegraded=false', async () => {
    const { jobId, provider } = await runTransfer(db.prisma, {
      ...JAMIE,
      sourceCourseId: FIXTURE_KEYS.F1,
    })
    const item = await db.prisma.transferJobItem.findFirstOrThrow({
      where: { jobId, title: 'Essay 1: Founding Documents' },
    })
    expect(item.rubricDegraded).toBe(false)
    const copied = await provider.getRubric(item.targetPostId!)
    const source = await provider.getRubric('cw-f1-1')
    expect(copied).toEqual(source)
  })

  it('F14 — a zero-item job completes immediately and still satisfies the invariant', async () => {
    const { jobId } = await runTransfer(db.prisma, { ...DANA, sourceCourseId: FIXTURE_KEYS.F14 })
    const job = await db.prisma.transferJob.findUniqueOrThrow({ where: { id: jobId } })
    expect(job.status).toBe('completed')
    const counts = await countOutcomes(db.prisma, jobId)
    expect(counts).toMatchObject({ totalItems: 0, transferred: 0, fallbackShell: 0, skippedTotal: 0 })
  })

  it('posts are created oldest-first', async () => {
    const { jobId } = await runTransfer(db.prisma, { ...JAMIE, sourceCourseId: FIXTURE_KEYS.F1 })
    const items = await db.prisma.transferJobItem.findMany({
      where: { jobId, outcome: 'transferred' },
      orderBy: { createdOrder: 'asc' },
    })
    const created = await Promise.all(
      items.map(async (i) =>
        i.sourceType === 'courseWork'
          ? (await db.prisma.mockCourseWork.findUniqueOrThrow({ where: { id: i.targetPostId! } }))
              .createdOrder
          : (
              await db.prisma.mockCourseWorkMaterial.findUniqueOrThrow({
                where: { id: i.targetPostId! },
              })
            ).createdOrder,
      ),
    )
    // Each surface's own creation order is monotonic in the item order.
    const cw = items
      .map((item, idx) => ({ item, order: created[idx]! }))
      .filter((x) => x.item.sourceType === 'courseWork')
      .map((x) => x.order)
    expect([...cw].sort((a, b) => a - b)).toEqual(cw)
  })
})

/* ================================================================= *
 * D5 — the single-active-job guard
 * ================================================================= */

describe('D5 — one active job per account', () => {
  it('a second creation while one is queued raises the conflict carrying the FIRST jobId', async () => {
    const first = await scanAndCreateJob(db.prisma, { ...JAMIE, sourceCourseId: FIXTURE_KEYS.F1 })
    const provider = new MockClassroomProvider(db.prisma)
    const secondScan = await new PreflightEngine(db.prisma, provider).run({
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F2,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })
    await expect(
      createTransferJob(db.prisma, {
        accountId: 'acct-jamie',
        scanId: secondScan.scanId,
        resolutions: [],
      }),
    ).rejects.toMatchObject({ name: 'ActiveJobConflictError', existingJobId: first.jobId })
  })

  it('a job that is rate-limit PAUSED is still guarded — pause is a field, not a status', async () => {
    const first = await scanAndCreateJob(db.prisma, { ...JAMIE, sourceCourseId: FIXTURE_KEYS.F1 })
    await db.prisma.transferJob.update({
      where: { id: first.jobId },
      data: {
        status: 'running',
        rateLimitPause: JSON.stringify({ retryInMs: 8000, attempt: 2, itemTitle: 'x' }),
      },
    })
    const provider = new MockClassroomProvider(db.prisma)
    const secondScan = await new PreflightEngine(db.prisma, provider).run({
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F2,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })
    await expect(
      createTransferJob(db.prisma, {
        accountId: 'acct-jamie',
        scanId: secondScan.scanId,
        resolutions: [],
      }),
    ).rejects.toMatchObject({ name: 'ActiveJobConflictError' })
  })

  it('releases the guard once the job completes, so another transfer can start', async () => {
    const run = await runTransfer(db.prisma, { ...JAMIE, sourceCourseId: FIXTURE_KEYS.F1 })
    const job = await db.prisma.transferJob.findUniqueOrThrow({ where: { id: run.jobId } })
    expect(job.activeAccountId).toBeNull()
    await expect(
      scanAndCreateJob(db.prisma, { ...JAMIE, sourceCourseId: FIXTURE_KEYS.F2 }),
    ).resolves.toBeDefined()
  })
})

/* ================================================================= *
 * D28 — the monetization completion hook has a real code path
 * ================================================================= */

describe('D28 — the monetization completion hook is actually called', () => {
  it('fires onJobComplete with cleanTransfer=true for a healthy course', async () => {
    const onJobComplete = vi.fn()
    const run = await scanAndCreateJob(db.prisma, {
      ...JAMIE,
      sourceCourseId: FIXTURE_KEYS.F1,
      engineOptions: { ...FAST_ENGINE, onJobComplete },
    })
    await run.engine.run(run.jobId)
    expect(onJobComplete).toHaveBeenCalledTimes(1)
    expect(onJobComplete.mock.calls[0]![0]).toMatchObject({ cleanTransfer: true })
  })

  it('reports cleanTransfer=false when any fallback was injected', async () => {
    const onJobComplete = vi.fn()
    const provider = new MockClassroomProvider(db.prisma)
    const scan = await new PreflightEngine(db.prisma, provider).run({
      accountId: 'acct-jamie',
      sourceCourseId: FIXTURE_KEYS.F2,
      targetCourseId: FIXTURE_KEYS.TARGET_JAMIE,
    })
    const { jobId } = await createTransferJob(db.prisma, {
      accountId: 'acct-jamie',
      scanId: scan.scanId,
      resolutions: scan.findings.map((f) => ({
        kind: 'create_draft_shell_with_note' as const,
        findingId: f.id,
      })),
    })
    await new TransferEngine(db.prisma, provider, { ...FAST_ENGINE, onJobComplete }).run(jobId)
    expect(onJobComplete.mock.calls[0]![0]).toMatchObject({ cleanTransfer: false })
  })
})
