/**
 * preflight-engine — the health-check scan, PERSISTED (D11).
 *
 * The scan is not a transient computation whose number is handed to the client
 * and then thrown away. It is written down: one `PreflightScan` row plus one
 * `PreflightScanItem` per enumerated post. `totalPostsScanned` is
 * `count(PreflightScanItem)`, and `POST /transfer-jobs` inserts its items from
 * those same stored rows.
 *
 * That is the whole point. The previous design produced `totalPostsScanned`
 * here and `count(items)` from a *separate re-enumeration* inside the job
 * request, then called their equality true "by definition". It was true by
 * convention — the convention being "we ran the same query twice and expected
 * the same answer" — and falsifiable by any pagination inconsistency between
 * the two calls.
 */
import crypto from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import type {
  AttachmentIssue,
  PreflightFinding,
  PreflightOption,
  PreflightResponse,
} from '@classroom-copier/shared'
import type { ClassroomProvider } from '../adapters/classroom-provider.interface.js'
import type { AttachmentRef, HealthState } from '../adapters/types.js'
import { enumeratePosts, typeLabel, type EnumeratedPost } from './post-enumerator.js'

function issueFor(health: HealthState): AttachmentIssue | null {
  if (health === 'trashed') return 'trashed'
  if (health === 'deleted') return 'deleted'
  if (health === 'permission_locked') return 'permission_locked'
  return null
}

/**
 * Scenario 2 (trashed/deleted): Create Draft Shell with Note (recommended —
 * never silently skips) or Skip <Type>. The skip label is TYPE-AWARE: it is
 * built from the flagged item's actual coursework type, never hardcoded to
 * "Skip Assignment".
 */
function scenario2Options(postTypeLabel: string): PreflightOption[] {
  return [
    {
      kind: 'create_draft_shell_with_note',
      label: 'Create Draft Shell with Note',
      recommended: true,
      riskWarning: null,
    },
    {
      kind: 'skip_post',
      label: `Skip ${postTypeLabel}`,
      recommended: false,
      riskWarning: null,
    },
  ]
}

/** Scenario 3 (permission-locked): Copy to My Drive (recommended — a permanent
 *  fix applied only to the flagged file), Link Existing File (leaves standing
 *  risk), or Skip Attachment and Note Draft. */
function scenario3Options(): PreflightOption[] {
  return [
    {
      kind: 'copy_to_my_drive',
      label: 'Copy to My Drive (Become Owner)',
      recommended: true,
      riskWarning: null,
    },
    {
      kind: 'link_existing_file',
      label: 'Link Existing File (Risk Warning)',
      recommended: false,
      riskWarning:
        'The file stays owned by someone else. Students may lose access if that person moves or removes it.',
    },
    {
      kind: 'skip_attachment_and_note_draft',
      label: 'Skip Attachment and Note Draft',
      recommended: false,
      riskWarning: null,
    },
  ]
}

export interface PreflightInput {
  accountId: string
  sourceCourseId: string
  targetCourseId: string
}

export class PreflightEngine {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: ClassroomProvider,
  ) {}

  async run(input: PreflightInput): Promise<PreflightResponse> {
    // APPLY-B — through the PORT. This used to be two `prisma.mockCourse`
    // queries: the module reached around the type-only seam into tables that
    // disappear the day a real adapter ships.
    const [sourceCourse, targetCourse] = await Promise.all([
      this.provider.getCourse(input.sourceCourseId),
      this.provider.getCourse(input.targetCourseId),
    ])
    if (!sourceCourse) throw new Error(`Source course ${input.sourceCourseId} not found`)
    if (!targetCourse) throw new Error(`Target course ${input.targetCourseId} not found`)

    const { posts } = await enumeratePosts(this.provider, input.sourceCourseId)

    // One batched health call for every attachment on the course (D20) rather
    // than an N+1 that would become a 429 storm during pre-flight against a
    // real Drive.
    const refs: AttachmentRef[] = posts.flatMap((post) =>
      post.attachments.map((a) => ({
        id: a.id,
        parentType: post.sourceType,
        parentId: post.sourceId,
      })),
    )
    const health = await this.provider.getAttachmentHealth(refs)

    const topicNames = new Map<string, string>()
    for (const topic of (await this.provider.listTopics(input.sourceCourseId)).items) {
      topicNames.set(topic.id, topic.name)
    }

    const scanId = `scan-${crypto.randomUUID()}`
    const findings: PreflightFinding[] = []
    const scanItems = posts.map((post) => ({
      id: `${scanId}-i${post.createdOrder}`,
      scanId,
      sourceType: post.sourceType,
      sourceId: post.sourceId,
      title: post.title,
      workType: post.workType,
      // APPLY-E — the per-type fields are recorded HERE, at scan time. The
      // itemized log used to re-read them from live source rows, so a post
      // deleted after the transfer lost its workType and a Question was
      // relabelled "Assignment" in the completion log.
      maxPoints: post.maxPoints,
      answerConfig: post.answerConfig ? JSON.stringify(post.answerConfig) : null,
      topicId: post.topicId,
      topicName: post.topicId ? (topicNames.get(post.topicId) ?? null) : null,
      createdOrder: post.createdOrder,
    }))

    for (const post of posts) {
      const scanItem = scanItems[post.createdOrder]!
      for (const attachment of post.attachments) {
        const issue = issueFor(health.get(attachment.id) ?? 'healthy')
        if (!issue) continue
        const label = typeLabel(post.sourceType, post.workType)
        const scenario: 2 | 3 = issue === 'permission_locked' ? 3 : 2
        findings.push({
          id: `${scanItem.id}-${attachment.id}`,
          scanItemId: scanItem.id,
          sourceType: post.sourceType,
          sourceId: post.sourceId,
          postTitle: post.title,
          postTypeLabel: label,
          attachmentId: attachment.id,
          attachmentName: attachment.title,
          issue,
          scenario,
          options: scenario === 3 ? scenario3Options() : scenario2Options(label),
        })
      }
    }

    const created = await this.prisma.preflightScan.create({
      data: {
        id: scanId,
        accountId: input.accountId,
        sourceCourseId: input.sourceCourseId,
        targetCourseId: input.targetCourseId,
        sourceCourseName: sourceCourse.name,
        targetCourseName: targetCourse.name,
        // Written ONCE, here. Every later reader derives from this row.
        totalPostsScanned: scanItems.length,
        findingsJson: JSON.stringify(findings),
        items: { create: scanItems.map(({ scanId: _scanId, ...rest }) => rest) },
      },
    })

    return {
      scanId,
      sourceCourseId: input.sourceCourseId,
      targetCourseId: input.targetCourseId,
      sourceCourseName: sourceCourse.name,
      targetCourseName: targetCourse.name,
      totalPostsScanned: scanItems.length,
      // APPLY-I — the scan is a snapshot and the client now says so out loud.
      scannedAt: created.scannedAt.toISOString(),
      findings,
    }
  }
}

export type { EnumeratedPost }
