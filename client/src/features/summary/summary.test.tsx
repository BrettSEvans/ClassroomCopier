/**
 * UX Acceptance Scenarios 10 (overflow note), 11 (rubric degradation as its own
 * count), 13 (per-type fields) and 15 (reconciliation). Plus D14 (system skips
 * are never attributed to the teacher) and D30 (focus lands on the heading).
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { TransferJobItemRow, TransferJobStatus } from '@classroom-copier/shared'
import { attachmentFallbackNote, attachmentOverflowNote } from '@classroom-copier/shared'
import { CompletionSummary, buildLogCsv, logCsvFilename } from './CompletionSummary'

function status(overrides: Partial<TransferJobStatus> = {}): TransferJobStatus {
  return {
    jobId: 'job-1',
    status: 'completed',
    sourceCourseName: 'US History (2025)',
    targetCourseName: 'US History — Period 3',
    targetCourseId: 'c-target',
    totalItems: 42,
    totalPostsScanned: 42,
    pending: 0,
    transferred: 39,
    fallbackShell: 2,
    skippedTotal: 1,
    skippedByUser: 1,
    skippedBySystem: 0,
    topicsCreatedOrMapped: 6,
    rubricNotesAdded: 1,
    currentItem: null,
    rateLimitPause: null,
    startedAt: '2026-08-14T18:00:00.000Z',
    finishedAt: '2026-08-14T18:02:00.000Z',
    ...overrides,
  }
}

const MATERIAL: TransferJobItemRow = {
  id: 'i1',
  title: 'Week 1 Reading',
  sourceType: 'courseWorkMaterial',
  workType: null,
  typeLabel: 'Material',
  topicName: 'Unit 1',
  outcome: 'transferred',
  skipReason: null,
  skippedBy: null,
  typeSpecific: { kind: 'none' },
  note: null,
  rubricDegraded: false,
  attemptCount: 1,
  targetPostId: 'tp-1',
}

const ASSIGNMENT: TransferJobItemRow = {
  id: 'i2',
  title: 'Essay 1',
  sourceType: 'courseWork',
  workType: 'ASSIGNMENT',
  typeLabel: 'Assignment',
  topicName: 'Unit 2',
  outcome: 'fallback_shell',
  skipReason: null,
  skippedBy: null,
  typeSpecific: { kind: 'graded', maxPoints: 100 },
  note: attachmentFallbackNote('Unit_1_Quiz.pdf'),
  rubricDegraded: false,
  attemptCount: 1,
  targetPostId: 'tp-2',
}

const QUESTION_MC: TransferJobItemRow = {
  id: 'i3',
  title: 'Discussion Q1',
  sourceType: 'courseWork',
  workType: 'MULTIPLE_CHOICE_QUESTION',
  typeLabel: 'Question',
  topicName: null,
  outcome: 'transferred',
  skipReason: null,
  skippedBy: null,
  typeSpecific: { kind: 'multipleChoice', optionCount: 4 },
  note: null,
  rubricDegraded: false,
  attemptCount: 1,
  targetPostId: 'tp-3',
}

const QUESTION_SA: TransferJobItemRow = {
  id: 'i4',
  title: 'Exit Ticket',
  sourceType: 'courseWork',
  workType: 'SHORT_ANSWER_QUESTION',
  typeLabel: 'Question',
  topicName: 'Unit 2',
  outcome: 'transferred',
  skipReason: null,
  skippedBy: null,
  typeSpecific: { kind: 'shortAnswer' },
  note: null,
  rubricDegraded: false,
  attemptCount: 1,
  targetPostId: 'tp-4',
}

const SKIPPED_BY_USER: TransferJobItemRow = {
  id: 'i5',
  title: 'Bonus Worksheet',
  sourceType: 'courseWorkMaterial',
  workType: null,
  typeLabel: 'Material',
  topicName: 'Unit 3',
  outcome: 'skipped',
  skipReason: 'user_skip_post',
  skippedBy: 'user',
  typeSpecific: { kind: 'none' },
  note: 'Skipped by you — chose “Skip Material” after the attachment could not be linked.',
  rubricDegraded: false,
  attemptCount: 0,
  targetPostId: null,
}

const ITEMS = [MATERIAL, ASSIGNMENT, QUESTION_MC, QUESTION_SA, SKIPPED_BY_USER]

function renderSummary(overrides: Partial<TransferJobStatus> = {}, items = ITEMS) {
  return render(
    <CompletionSummary
      status={status(overrides)}
      items={items}
      onOpenTargetCourse={vi.fn()}
      onStartAnother={vi.fn()}
    />,
  )
}

function rowFor(title: string): HTMLElement {
  return screen.getByRole('cell', { name: title }).closest('tr') as HTMLElement
}

function typeSpecificCell(title: string): HTMLElement {
  return within(rowFor(title)).getAllByRole('cell')[4] as HTMLElement
}

describe('Completion Summary', () => {
  it('is a full-screen report, not a modal, and moves focus to its heading (D30)', async () => {
    renderSummary()
    expect(screen.queryByRole('dialog')).toBeNull()
    const heading = screen.getByRole('heading', { name: 'Transfer complete.' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })

  it('renders the five stat tiles', () => {
    renderSummary()
    const tile = (label: string) =>
      screen.getByText(label).closest('.stat-tile') as HTMLElement

    expect(within(tile('Topics created/mapped')).getByText('6')).toBeInTheDocument()
    expect(within(tile('Drafts transferred')).getByText('39')).toBeInTheDocument()
    expect(within(tile('Fallback shells')).getByText('2')).toBeInTheDocument()
    expect(within(tile('Skipped by you')).getByText('1')).toBeInTheDocument()
    expect(within(tile('Rubric notes added')).getByText('1')).toBeInTheDocument()
  })
})

describe('D14 — a post the server abandoned is never attributed to the teacher', () => {
  it('binds "Skipped by you" to skippedByUser alone and names the system skip separately', () => {
    renderSummary({ skippedTotal: 1, skippedByUser: 0, skippedBySystem: 1 })

    const tile = screen.getByText('Skipped by you').closest('.stat-tile') as HTMLElement
    expect(within(tile).getByText('0')).toBeInTheDocument()

    const systemLine = screen.getByTestId('system-skip-line')
    expect(systemLine).toHaveTextContent(
      '1 post was interrupted before we could confirm it copied — see the log below.',
    )
  })

  it('pluralizes the system-skip line', () => {
    renderSummary({ skippedTotal: 3, skippedByUser: 1, skippedBySystem: 2 })
    expect(screen.getByTestId('system-skip-line')).toHaveTextContent(
      '2 posts were interrupted before we could confirm they copied — see the log below.',
    )
  })

  it('omits the system-skip line entirely when nothing was abandoned', () => {
    renderSummary()
    expect(screen.queryByTestId('system-skip-line')).toBeNull()
  })
})

describe('the reconciliation line (Scenario 15)', () => {
  it('renders the three-term sum from the server counts, topics and rubric notes excluded', () => {
    renderSummary()
    expect(screen.getByTestId('reconciliation')).toHaveTextContent(
      '✓ 39 + 2 + 1 = 42 of 42 posts scanned — every post resolved to a transfer, fallback, or skip.',
    )
  })

  it('uses skippedTotal — system and user together — as the third term', () => {
    renderSummary({ transferred: 38, fallbackShell: 2, skippedTotal: 2, skippedByUser: 1, skippedBySystem: 1 })
    expect(screen.getByTestId('reconciliation')).toHaveTextContent('✓ 38 + 2 + 2 = 42 of 42 posts scanned')
  })

  it('reads the total from the server rather than recomputing it client-side', () => {
    // A deliberately inconsistent payload: a client-side sum would print 42.
    renderSummary({ totalItems: 99, totalPostsScanned: 99 })
    expect(screen.getByTestId('reconciliation')).toHaveTextContent('= 99 of 99 posts scanned')
  })
})

describe('the itemized log', () => {
  it('has the six specified columns in order', () => {
    renderSummary()
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual([
      'Title',
      'Type',
      'Topic',
      'Outcome',
      'Type-specific fields',
      'Note',
    ])
  })

  it('leaves a Material row genuinely empty of type-specific content (Scenario 13)', () => {
    renderSummary()
    const cell = typeSpecificCell('Week 1 Reading')
    expect(cell.textContent).not.toMatch(/pts|Due|Answer/)
  })

  it('renders due/points for Assignments and answer config for Questions (Scenario 13)', () => {
    renderSummary()
    expect(typeSpecificCell('Essay 1')).toHaveTextContent('Due: cleared · Max pts: 100')
    expect(typeSpecificCell('Discussion Q1')).toHaveTextContent('Answer: Multiple choice (4 opts)')
    expect(typeSpecificCell('Exit Ticket')).toHaveTextContent('Answer: Short answer')
  })

  it('never renders a uniform placeholder across types', () => {
    renderSummary()
    const material = typeSpecificCell('Week 1 Reading').textContent
    const assignment = typeSpecificCell('Essay 1').textContent
    expect(material).not.toBe(assignment)
  })

  it('renders the canonical fallback note in full, never truncated or ellipsized', () => {
    renderSummary()
    const canonical = attachmentFallbackNote('Unit_1_Quiz.pdf')
    const noteCell = within(rowFor('Essay 1')).getAllByRole('cell')[5] as HTMLElement
    expect(noteCell.textContent).toBe(canonical)
    expect(noteCell.textContent).not.toContain('…')
    expect(noteCell.textContent).not.toContain('...')
  })

  it('renders the attachment-overflow note on that post row (Scenario 10)', () => {
    const overflow: TransferJobItemRow = { ...MATERIAL, id: 'i9', title: 'Photo Gallery', note: attachmentOverflowNote(5) }
    renderSummary({}, [overflow])
    expect(screen.getByText(attachmentOverflowNote(5))).toBeInTheDocument()
  })

  it('shows each outcome as a coloured pill with text', () => {
    renderSummary()
    expect(within(rowFor('Week 1 Reading')).getByText('Transferred')).toHaveClass('outcome-transferred')
    expect(within(rowFor('Essay 1')).getByText('Fallback')).toHaveClass('outcome-fallback')
    expect(within(rowFor('Bonus Worksheet')).getByText('Skipped')).toHaveClass('outcome-skipped')
  })

  it('shows "(none)" for an untopiced post rather than an empty cell', () => {
    renderSummary()
    expect(within(rowFor('Discussion Q1')).getByText('(none)')).toBeInTheDocument()
  })

  it('filters by outcome', async () => {
    renderSummary()
    const filter = screen.getByLabelText('Filter by outcome')

    await userEvent.selectOptions(filter, 'fallback_shell')
    expect(screen.getByRole('cell', { name: 'Essay 1' })).toBeInTheDocument()
    expect(screen.queryByRole('cell', { name: 'Week 1 Reading' })).toBeNull()

    await userEvent.selectOptions(filter, 'skipped')
    expect(screen.getByRole('cell', { name: 'Bonus Worksheet' })).toBeInTheDocument()
    expect(screen.queryByRole('cell', { name: 'Essay 1' })).toBeNull()

    await userEvent.selectOptions(filter, 'all')
    expect(screen.getByRole('cell', { name: 'Week 1 Reading' })).toBeInTheDocument()
  })

  it('horizontal-scrolls rather than collapsing to cards (UI-Δ1)', () => {
    const { container } = renderSummary()
    expect(container.querySelector('.log-scroll')).not.toBeNull()
    expect(container.querySelector('table.log-table')).not.toBeNull()
  })
})

describe('CSV export of the itemized log (5a)', () => {
  const NOTE_WITH_COMMAS_AND_QUOTES: TransferJobItemRow = {
    id: 'i6',
    title: 'Field Trip Permission, Signed',
    sourceType: 'courseWorkMaterial',
    workType: null,
    typeLabel: 'Material',
    topicName: null,
    outcome: 'skipped',
    skipReason: 'user_skip_post',
    skippedBy: 'user',
    typeSpecific: { kind: 'none' },
    note: 'Skipped by you — chose "Skip Material," see notes.',
    rubricDegraded: false,
    attemptCount: 0,
    targetPostId: null,
  }

  const MIXED_ITEMS = [...ITEMS, NOTE_WITH_COMMAS_AND_QUOTES]

  it('offers an "Export log (CSV)" action on the Completion Summary', () => {
    renderSummary()
    expect(screen.getByRole('button', { name: 'Export log (CSV)' })).toBeInTheDocument()
  })

  it('names the file classroom-copier-log-<jobId>.csv', () => {
    expect(logCsvFilename('job-42')).toBe('classroom-copier-log-job-42.csv')
  })

  it('builds a CSV mirroring the on-screen six columns, for a mixed-outcome job', () => {
    const csv = buildLogCsv(MIXED_ITEMS)
    const lines = csv.split('\r\n')

    expect(lines[0]).toBe('Title,Type,Topic,Outcome,Type-specific fields,Note')
    expect(lines[1]).toBe('Week 1 Reading,Material,Unit 1,Transferred,,')
    expect(lines[2]).toBe(
      `Essay 1,Assignment,Unit 2,Fallback,Due: cleared · Max pts: 100,${attachmentFallbackNote('Unit_1_Quiz.pdf')}`,
    )
    expect(lines[3]).toBe('Discussion Q1,Question,(none),Transferred,Answer: Multiple choice (4 opts),')
    expect(lines[4]).toBe('Exit Ticket,Question,Unit 2,Transferred,Answer: Short answer,')
    expect(lines[5]).toBe(
      'Bonus Worksheet,Material,Unit 3,Skipped,,Skipped by you — chose “Skip Material” after the attachment could not be linked.',
    )
  })

  it('quotes and escapes a field containing commas and double quotes (RFC 4180)', () => {
    const csv = buildLogCsv([NOTE_WITH_COMMAS_AND_QUOTES])
    const lines = csv.split('\r\n')

    expect(lines[0]).toBe('Title,Type,Topic,Outcome,Type-specific fields,Note')
    expect(lines[1]).toBe(
      '"Field Trip Permission, Signed",Material,(none),Skipped,,"Skipped by you — chose ""Skip Material,"" see notes."',
    )
  })
})

describe('summary actions', () => {
  it('offers the mock target-course link and a way to start another transfer', async () => {
    const onOpenTargetCourse = vi.fn()
    const onStartAnother = vi.fn()
    render(
      <CompletionSummary
        status={status()}
        items={ITEMS}
        onOpenTargetCourse={onOpenTargetCourse}
        onStartAnother={onStartAnother}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Open target course (mock link)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Start another transfer' }))
    expect(onOpenTargetCourse).toHaveBeenCalledTimes(1)
    expect(onStartAnother).toHaveBeenCalledTimes(1)
  })
})
