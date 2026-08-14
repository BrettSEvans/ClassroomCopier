/**
 * The itemized log's outcome pill: text + colour, never colour alone
 * (03-ui-direction.md §6). All three filterable outcome kinds have a sanctioned
 * style — Skipped included.
 */
import type { Outcome } from '@classroom-copier/shared'

/** The exact on-screen text for each outcome — also the source the CSV
 *  export (Fix 5a) reuses, so the file matches the table exactly. */
export const OUTCOME_TEXT: Record<Outcome, string> = {
  pending: 'In progress',
  transferred: 'Transferred',
  fallback_shell: 'Fallback',
  skipped: 'Skipped',
}

const CLASS_NAME: Record<Outcome, string> = {
  pending: 'outcome-skipped',
  transferred: 'outcome-transferred',
  fallback_shell: 'outcome-fallback',
  skipped: 'outcome-skipped',
}

export function OutcomePill({ outcome }: { outcome: Outcome }) {
  return <span className={`outcome-pill ${CLASS_NAME[outcome]}`}>{OUTCOME_TEXT[outcome]}</span>
}
