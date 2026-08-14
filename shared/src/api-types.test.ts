import { describe, expect, it } from 'vitest'
import {
  NON_TERMINAL_JOB_STATUSES,
  ResolutionSchema,
  SYSTEM_SKIP_REASONS,
  TERMINAL_JOB_STATUSES,
  TransferJobStatusSchema,
  TypeSpecificFieldsSchema,
  USER_SKIP_REASONS,
  isTerminalJobStatus,
  isUserSkip,
} from './api-types.js'
import { attachmentFallbackNote, rateLimitExhaustionNote, rubricDegradedNote } from './notes.js'

describe('Resolution (D15) — the discriminated union', () => {
  it('accepts each of the five Action-Sheet options', () => {
    for (const kind of [
      'create_draft_shell_with_note',
      'skip_post',
      'copy_to_my_drive',
      'link_existing_file',
      'skip_attachment_and_note_draft',
    ] as const) {
      expect(ResolutionSchema.parse({ kind, findingId: 'f1' })).toEqual({ kind, findingId: 'f1' })
    }
  })

  it('rejects an unknown kind at runtime rather than ignoring it silently', () => {
    expect(ResolutionSchema.safeParse({ kind: 'do_whatever', findingId: 'f1' }).success).toBe(false)
  })
})

describe('job status (D5) — one definition of terminal', () => {
  it('never treats a rate-limit pause as a status', () => {
    // A paused job used to escape the single-active-job index while /active
    // still returned it — the exact double-submit window D5 exists for.
    expect([...TERMINAL_JOB_STATUSES, ...NON_TERMINAL_JOB_STATUSES]).not.toContain(
      'rate_limited_pause',
    )
  })

  it('partitions every status into exactly one of terminal / non-terminal', () => {
    const all = [...TERMINAL_JOB_STATUSES, ...NON_TERMINAL_JOB_STATUSES]
    expect(new Set(all).size).toBe(all.length)
    expect(all.sort()).toEqual(
      ['queued', 'running', 'completed', 'interrupted', 'failed'].sort(),
    )
    expect(isTerminalJobStatus('failed')).toBe(true)
    expect(isTerminalJobStatus('queued')).toBe(false)
  })
})

describe('skip reasons (D14) — user vs system', () => {
  it('classifies every reason as exactly one of user or system', () => {
    const all = [...USER_SKIP_REASONS, ...SYSTEM_SKIP_REASONS]
    expect(new Set(all).size).toBe(all.length)
    expect(all).toHaveLength(5)
  })

  it('never counts server_interrupted as a skip the teacher chose', () => {
    expect(isUserSkip('server_interrupted')).toBe(false)
    expect(isUserSkip('provider_error')).toBe(false)
    expect(isUserSkip('rate_limit_exhausted')).toBe(false)
    expect(isUserSkip('user_skip_post')).toBe(true)
  })
})

describe('TransferJobStatus — the reconciliation payload', () => {
  it('carries skippedByUser and skippedBySystem as separate numbers', () => {
    const shape = TransferJobStatusSchema.shape
    expect(shape.skippedByUser).toBeDefined()
    expect(shape.skippedBySystem).toBeDefined()
    expect(shape.skippedTotal).toBeDefined()
  })
})

describe('TypeSpecificFields — per type, never one generic post shape', () => {
  it('has no representation in which a Material carries points', () => {
    expect(TypeSpecificFieldsSchema.safeParse({ kind: 'none', maxPoints: 100 }).success).toBe(true)
    // ...but the parsed value strips it: a Material row cannot render points.
    const parsed = TypeSpecificFieldsSchema.parse({ kind: 'none', maxPoints: 100 })
    expect(parsed).toEqual({ kind: 'none' })
    expect('maxPoints' in parsed).toBe(false)
  })

  it('models multiple-choice and short-answer as distinct shapes', () => {
    expect(TypeSpecificFieldsSchema.parse({ kind: 'multipleChoice', optionCount: 4 })).toEqual({
      kind: 'multipleChoice',
      optionCount: 4,
    })
    expect(TypeSpecificFieldsSchema.parse({ kind: 'shortAnswer' })).toEqual({ kind: 'shortAnswer' })
  })
})

describe('notes (D6, Δ2)', () => {
  it('renders the canonical attachment note exactly, in full', () => {
    expect(attachmentFallbackNote('Unit_1_Quiz.pdf')).toBe(
      "[Classroom Copier Note: Original attachment 'Unit_1_Quiz.pdf' could not be linked due to a permission error or deleted file.]",
    )
  })

  it('keeps the rate-limit-exhaustion note DISTINCT from the attachment note', () => {
    expect(rateLimitExhaustionNote(5)).not.toBe(attachmentFallbackNote('anything'))
    expect(rateLimitExhaustionNote(5)).not.toContain('could not be linked due to a permission error')
  })

  it('keeps the rubric note distinct from both fallback notes', () => {
    expect(rubricDegradedNote()).not.toBe(attachmentFallbackNote('x'))
    expect(rubricDegradedNote()).not.toBe(rateLimitExhaustionNote(5))
  })
})
