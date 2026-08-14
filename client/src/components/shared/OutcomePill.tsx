/**
 * The itemized log's outcome pill: text + colour, never colour alone
 * (03-ui-direction.md §6). All three filterable outcome kinds have a sanctioned
 * style — Skipped included.
 */
import type { Outcome } from '@classroom-copier/shared'

const PILL: Record<Outcome, { text: string; className: string }> = {
  pending: { text: 'In progress', className: 'outcome-skipped' },
  transferred: { text: 'Transferred', className: 'outcome-transferred' },
  fallback_shell: { text: 'Fallback', className: 'outcome-fallback' },
  skipped: { text: 'Skipped', className: 'outcome-skipped' },
}

export function OutcomePill({ outcome }: { outcome: Outcome }) {
  const { text, className } = PILL[outcome]
  return <span className={`outcome-pill ${className}`}>{text}</span>
}
