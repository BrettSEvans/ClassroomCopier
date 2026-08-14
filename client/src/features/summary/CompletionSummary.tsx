/**
 * Screen 6 — the Completion Summary. A full-screen report surface, not a modal
 * (02-ux-workflow.md Deltas P0 #1): at F4's 50-post volume a dialog cannot hold
 * the itemized log, and the zero-silent-drop guarantee is only a guarantee if
 * every outcome is actually reviewable.
 *
 * Two rules here are correctness, not layout:
 *
 *  - **D14.** "Skipped by you" binds to `skippedByUser` and nothing else. Any
 *    `skippedBySystem` is reported on its own line, in its own words. A post
 *    the server abandoned must never appear on screen as a choice the teacher
 *    made.
 *  - **Scenario 15.** The reconciliation line renders the server's counts. The
 *    three terms are transferred + fallbackShell + skippedTotal, and the total
 *    is `totalItems` as the server reports it — the arithmetic is not
 *    re-derived here, because a second implementation of the sum is exactly how
 *    a ledger starts disagreeing with itself. Topics and rubric notes are tiles
 *    and are never terms.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Outcome, TransferJobItemRow, TransferJobStatus, TypeSpecificFields } from '@classroom-copier/shared'
import { Button, OutcomePill } from '../../components/shared'

type OutcomeFilter = 'all' | 'transferred' | 'fallback_shell' | 'skipped'

const FILTERS: ReadonlyArray<{ value: OutcomeFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'transferred', label: 'Transferred' },
  { value: 'fallback_shell', label: 'Fallback' },
  { value: 'skipped', label: 'Skipped' },
]

export function systemSkipLine(count: number): string {
  const one = count === 1
  return `${count} post${one ? '' : 's'} ${one ? 'was' : 'were'} interrupted before we could confirm ${
    one ? 'it' : 'they'
  } copied — see the log below.`
}

/**
 * The "Type-specific fields" cell. `none` is genuinely empty — the em dash is
 * decoration, not content — so a Material never carries a due date or points
 * it does not have.
 */
function TypeSpecificCell({ fields }: { fields: TypeSpecificFields }) {
  switch (fields.kind) {
    case 'graded':
      return <td>{`Due: cleared · Max pts: ${fields.maxPoints ?? '—'}`}</td>
    case 'multipleChoice':
      return <td>{`Answer: Multiple choice (${fields.optionCount} opts)`}</td>
    case 'shortAnswer':
      return <td>Answer: Short answer</td>
    case 'none':
    default:
      return (
        <td className="type-specific-empty">
          <span aria-hidden="true">—</span>
        </td>
      )
  }
}

function StatTile({ value, label }: { value: number; label: string }) {
  return (
    <div className="stat-tile">
      <div className="stat-num">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

interface CompletionSummaryProps {
  status: TransferJobStatus
  items: TransferJobItemRow[]
  onOpenTargetCourse: () => void
  onStartAnother: () => void
}

export function CompletionSummary({
  status,
  items,
  onOpenTargetCourse,
  onStartAnother,
}: CompletionSummaryProps) {
  const [filter, setFilter] = useState<OutcomeFilter>('all')
  const headingRef = useRef<HTMLHeadingElement>(null)

  // D30 — focus moves to the heading so the page change is announced.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const visible = useMemo(
    () => (filter === 'all' ? items : items.filter((i) => i.outcome === (filter as Outcome))),
    [items, filter],
  )

  const reconciliation =
    `✓ ${status.transferred} + ${status.fallbackShell} + ${status.skippedTotal} = ` +
    `${status.totalItems} of ${status.totalPostsScanned} posts scanned — ` +
    `every post resolved to a transfer, fallback, or skip.`

  return (
    <div className="screen">
      <h2 className="screen-title" ref={headingRef} tabIndex={-1}>
        Transfer complete.
      </h2>

      <div className="stat-grid">
        <StatTile value={status.topicsCreatedOrMapped} label="Topics created/mapped" />
        <StatTile value={status.transferred} label="Drafts transferred" />
        <StatTile value={status.fallbackShell} label="Fallback shells" />
        {/* D14: skippedByUser ONLY. */}
        <StatTile value={status.skippedByUser} label="Skipped by you" />
        <StatTile value={status.rubricNotesAdded} label="Rubric notes added" />
      </div>

      {status.skippedBySystem > 0 ? (
        <p className="system-skip-line" data-testid="system-skip-line">
          <span className="glyph" aria-hidden="true">
            ⊘
          </span>
          <span>{systemSkipLine(status.skippedBySystem)}</span>
        </p>
      ) : null}

      <div className="reconcile" data-testid="reconciliation">
        {reconciliation}
      </div>

      <div className="log-filter">
        <label className="field-label" htmlFor="outcome-filter" style={{ marginBottom: 0 }}>
          Filter by outcome
        </label>
        <select
          id="outcome-filter"
          className="select-input"
          style={{ width: 'auto' }}
          value={filter}
          onChange={(e) => setFilter(e.target.value as OutcomeFilter)}
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {/* UI-Δ1: horizontal scroll with a sticky Title column. Never cards. */}
      <div className="log-scroll">
        <table className="log-table">
          <caption className="sr-only">Itemized log of every post in this transfer</caption>
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Type</th>
              <th scope="col">Topic</th>
              <th scope="col">Outcome</th>
              <th scope="col">Type-specific fields</th>
              <th scope="col">Note</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => (
              <tr key={item.id}>
                <td>{item.title}</td>
                <td>{item.typeLabel}</td>
                <td>{item.topicName ?? '(none)'}</td>
                <td>
                  <OutcomePill outcome={item.outcome} />
                </td>
                <TypeSpecificCell fields={item.typeSpecific} />
                {/* Rendered in full. Never truncated, never ellipsized. */}
                <td className="note-cell">{item.note ?? <span aria-hidden="true">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="summary-actions">
        <Button variant="secondary" onClick={onOpenTargetCourse}>
          Open target course (mock link)
        </Button>
        <Button onClick={onStartAnother}>Start another transfer</Button>
      </div>
    </div>
  )
}
