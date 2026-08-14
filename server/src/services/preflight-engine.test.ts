import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MockClassroomProvider } from '../adapters/mock/mock-classroom-provider.js'
import { FIXTURE_KEYS } from '../fixtures/index.js'
import { createTestDb, type TestDb } from '../../test/helpers/db.js'
import { PreflightEngine } from './preflight-engine.js'

let db: TestDb
let engine: PreflightEngine

beforeAll(async () => {
  db = await createTestDb()
  engine = new PreflightEngine(db.prisma, new MockClassroomProvider(db.prisma))
})
afterAll(async () => {
  await db.dispose()
})

const run = (sourceCourseId: string, targetCourseId = FIXTURE_KEYS.TARGET_JAMIE) =>
  engine.run({ accountId: 'acct-jamie', sourceCourseId, targetCourseId })

describe('F1 — silent auto-proceed on a healthy course', () => {
  it('produces zero findings', async () => {
    const result = await run(FIXTURE_KEYS.F1)
    expect(result.findings).toEqual([])
  })
})

describe('D11 — the scan is PERSISTED, and totalPostsScanned is count(scan items)', () => {
  it('writes a PreflightScan row whose item count equals totalPostsScanned', async () => {
    const result = await run(FIXTURE_KEYS.F1)
    const stored = await db.prisma.preflightScan.findUnique({
      where: { id: result.scanId },
      include: { items: true },
    })
    expect(stored).not.toBeNull()
    expect(stored!.totalPostsScanned).toBe(result.totalPostsScanned)
    expect(stored!.items).toHaveLength(result.totalPostsScanned)
  })

  it('stores the items in the enumerator total order, with contiguous createdOrder', async () => {
    const result = await run(FIXTURE_KEYS.F4)
    const items = await db.prisma.preflightScanItem.findMany({
      where: { scanId: result.scanId },
      orderBy: { createdOrder: 'asc' },
    })
    expect(items).toHaveLength(50)
    expect(items.map((i) => i.createdOrder)).toEqual(items.map((_, idx) => idx))
  })

  it('counts a 50-post course as 50, including its Draft posts (F4 + F8)', async () => {
    const result = await run(FIXTURE_KEYS.F4)
    expect(result.totalPostsScanned).toBe(50)
  })
})

describe('F2 — trashed/deleted findings with TYPE-AWARE skip labels', () => {
  it('labels the skip option from the flagged item\'s actual coursework type', async () => {
    const result = await run(FIXTURE_KEYS.F2)
    const materialFinding = result.findings.find((f) => f.sourceType === 'courseWorkMaterial')
    expect(materialFinding).toBeDefined()
    expect(materialFinding!.postTypeLabel).toBe('Material')
    const skip = materialFinding!.options.find((o) => o.kind === 'skip_post')
    expect(skip!.label).toBe('Skip Material')
    expect(skip!.label).not.toBe('Skip Assignment')
  })

  it('recommends Create Draft Shell with Note — never a silent skip', async () => {
    const result = await run(FIXTURE_KEYS.F2)
    const finding = result.findings[0]!
    const recommended = finding.options.filter((o) => o.recommended)
    expect(recommended).toHaveLength(1)
    expect(recommended[0]!.kind).toBe('create_draft_shell_with_note')
  })

  it('flags both a trashed and a deleted attachment', async () => {
    const result = await run(FIXTURE_KEYS.F2)
    expect(new Set(result.findings.map((f) => f.issue))).toEqual(new Set(['trashed', 'deleted']))
  })
})

describe('F3 — permission-locked findings', () => {
  it('offers exactly the three Scenario 3 options with Copy to My Drive recommended', async () => {
    const result = await run(FIXTURE_KEYS.F3)
    const finding = result.findings.find((f) => f.issue === 'permission_locked')
    expect(finding).toBeDefined()
    expect(finding!.scenario).toBe(3)
    expect(finding!.options.map((o) => o.kind)).toEqual([
      'copy_to_my_drive',
      'link_existing_file',
      'skip_attachment_and_note_draft',
    ])
    expect(finding!.options.filter((o) => o.recommended).map((o) => o.kind)).toEqual([
      'copy_to_my_drive',
    ])
  })

  it('carries a risk warning on Link Existing File and on nothing else', async () => {
    const result = await run(FIXTURE_KEYS.F3)
    const finding = result.findings.find((f) => f.issue === 'permission_locked')!
    const withWarning = finding.options.filter((o) => o.riskWarning !== null)
    expect(withWarning.map((o) => o.kind)).toEqual(['link_existing_file'])
  })
})

describe('F14 — the empty-course path (D26)', () => {
  it('produces a scan with totalPostsScanned == 0 and no findings', async () => {
    const result = await engine.run({
      accountId: 'acct-dana',
      sourceCourseId: FIXTURE_KEYS.F14,
      targetCourseId: FIXTURE_KEYS.TARGET_DANA,
    })
    expect(result.totalPostsScanned).toBe(0)
    expect(result.findings).toEqual([])
    const stored = await db.prisma.preflightScan.findUnique({ where: { id: result.scanId } })
    expect(stored!.totalPostsScanned).toBe(0)
  })
})

describe('topic names travel with the scan (F11)', () => {
  it('records the topic name for topiced posts and null for untopiced ones', async () => {
    const result = await run(FIXTURE_KEYS.F1)
    const items = await db.prisma.preflightScanItem.findMany({ where: { scanId: result.scanId } })
    expect(items.some((i) => i.topicName !== null)).toBe(true)
    expect(items.some((i) => i.topicId === null && i.topicName === null)).toBe(true)
  })
})
