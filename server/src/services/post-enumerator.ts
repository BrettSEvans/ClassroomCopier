/**
 * post-enumerator (D16) — the SINGLE owner of "all posts".
 *
 * The per-type ADR's consequence column promised this module ("named as a
 * single reviewed module rather than open-coded per call site") and the module
 * list did not contain it. The result was that `preflight-engine` and
 * `transfer-engine` — which share no dependency edge and no file target — would
 * each implement the merge independently. Two independent merge
 * implementations that must agree on ordering is precisely how the two post
 * counts diverge.
 *
 * It owns three things:
 *  1. the paginated enumeration loop over BOTH coursework surfaces, passing all
 *     three `courseWorkStates` explicitly (without which a real adapter returns
 *     PUBLISHED only and silently drops every Draft and Scheduled post);
 *  2. the merge;
 *  3. the deterministic total ordering key.
 */
import type { ClassroomProvider } from '../adapters/classroom-provider.interface.js'
import type {
  AnswerConfig,
  CourseWorkState,
  ProviderAttachment,
  SourceType,
  WorkType,
} from '../adapters/types.js'

export const ALL_COURSE_WORK_STATES: CourseWorkState[] = ['DRAFT', 'PUBLISHED', 'SCHEDULED']

/**
 * APPLY-D — the second surface's states are passed under their OWN parameter
 * name (`courseWorkMaterialStates`), because `courses.courseWorkMaterials.list`
 * is a different real endpoint. The member list happens to coincide today; the
 * constant is separate so it can diverge without a rename.
 */
export const ALL_COURSE_WORK_MATERIAL_STATES: CourseWorkState[] = [
  'DRAFT',
  'PUBLISHED',
  'SCHEDULED',
]

export interface EnumeratedPost {
  sourceType: SourceType
  sourceId: string
  title: string
  description: string | null
  /** null for Materials — a Material has no workType, not a defaulted one. */
  workType: WorkType | null
  state: CourseWorkState
  maxPoints: number | null
  answerConfig: AnswerConfig | null
  quizFormLink: string | null
  topicId: string | null
  creationTime: Date
  attachments: ProviderAttachment[]
  hasRubric: boolean
  /** Position in the total order. Assigned here, once, and carried downstream. */
  createdOrder: number
}

export interface EnumerationResult {
  posts: EnumeratedPost[]
  /** Exposed so the pagination-loop gate can assert the loop actually looped. */
  listCalls: number
}

interface Orderable {
  creationTime: Date
  sourceType: SourceType
  sourceId: string
}

/**
 * `(creationTime ASC, sourceType ASC, sourceId ASC)`.
 *
 * The tiebreak is not decoration: seeded fixtures routinely share timestamps,
 * and `creationTime` alone is not a total order across two tables. Without the
 * tiebreak "oldest-first" is only well-defined up to ties, and two callers
 * sorting the same set could legitimately produce different sequences.
 */
export function orderingKey(a: Orderable, b: Orderable): number {
  const byTime = a.creationTime.getTime() - b.creationTime.getTime()
  if (byTime !== 0) return byTime
  if (a.sourceType !== b.sourceType) return a.sourceType < b.sourceType ? -1 : 1
  if (a.sourceId !== b.sourceId) return a.sourceId < b.sourceId ? -1 : 1
  return 0
}

async function drain<T>(
  fetchPage: (pageToken: string | null) => Promise<{ items: T[]; nextPageToken: string | null }>,
  onPage?: () => Promise<void>,
): Promise<{ items: T[]; calls: number }> {
  const items: T[] = []
  let pageToken: string | null = null
  let calls = 0
  // Loop until nextPageToken is exhausted — or the scan under-counts, and a
  // post that is never scanned never gets a TransferJobItem row, so the
  // item-level invariant cannot detect the loss.
  do {
    const page = await fetchPage(pageToken)
    calls += 1
    items.push(...page.items)
    pageToken = page.nextPageToken
    if (onPage) await onPage()
  } while (pageToken != null)
  return { items, calls }
}

export interface EnumerateOptions {
  /**
   * P0-2 — called after every page. The executor uses it to heartbeat, because
   * a 50-post enumeration under a per-item provider delay used to run longer
   * than `jobStaleAfterMs` in total silence, and the reconciler cannot tell a
   * slow executor from a dead one without a signal.
   */
  onPage?: () => Promise<void>
}

export async function enumeratePosts(
  provider: ClassroomProvider,
  courseId: string,
  options: EnumerateOptions = {},
): Promise<EnumerationResult> {
  const work = await drain(
    (pageToken) =>
      provider.listCourseWork(courseId, {
        courseWorkStates: ALL_COURSE_WORK_STATES,
        pageToken,
      }),
    options.onPage,
  )
  const materials = await drain(
    (pageToken) =>
      provider.listCourseWorkMaterials(courseId, {
        courseWorkMaterialStates: ALL_COURSE_WORK_MATERIAL_STATES,
        pageToken,
      }),
    options.onPage,
  )

  const merged: Omit<EnumeratedPost, 'createdOrder'>[] = [
    ...work.items.map((w) => ({
      sourceType: 'courseWork' as const,
      sourceId: w.id,
      title: w.title,
      description: w.description,
      workType: w.workType,
      state: w.state,
      maxPoints: w.maxPoints,
      answerConfig: w.answerConfig,
      quizFormLink: w.quizFormLink,
      topicId: w.topicId,
      creationTime: w.creationTime,
      attachments: w.attachments,
      hasRubric: w.hasRubric,
    })),
    ...materials.items.map((m) => ({
      sourceType: 'courseWorkMaterial' as const,
      sourceId: m.id,
      title: m.title,
      description: m.description,
      // Structurally absent on a Material — not a nulled-out shared field.
      workType: null,
      state: m.state,
      maxPoints: null,
      answerConfig: null,
      quizFormLink: null,
      topicId: m.topicId,
      creationTime: m.creationTime,
      attachments: m.attachments,
      hasRubric: false,
    })),
  ]

  merged.sort(orderingKey)

  return {
    posts: merged.map((post, index) => ({ ...post, createdOrder: index })),
    listCalls: work.calls + materials.calls,
  }
}

/** "Material" / "Assignment" / "Quiz assignment" / "Question" — the type-aware
 *  label the Action Sheet's skip button and the itemized log both render. */
export function typeLabel(sourceType: SourceType, workType: WorkType | null): string {
  if (sourceType === 'courseWorkMaterial') return 'Material'
  switch (workType) {
    case 'ASSIGNMENT':
      return 'Assignment'
    case 'QUIZ_ASSIGNMENT':
      return 'Quiz assignment'
    case 'SHORT_ANSWER_QUESTION':
    case 'MULTIPLE_CHOICE_QUESTION':
      return 'Question'
    default:
      return 'Assignment'
  }
}
