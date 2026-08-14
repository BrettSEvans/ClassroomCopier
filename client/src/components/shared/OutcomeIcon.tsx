/**
 * D30 — outcome-icon text alternatives, with an acceptance gate.
 *
 * The glyph is `aria-hidden` decoration; the text label is always rendered and
 * always carried on the wrapper's accessible name. `labelVisibility` chooses
 * between showing the label and visually hiding it — there is deliberately NO
 * option that removes it. Rendering this component glyph-only is not
 * expressible, which is the point: colour and shape alone never carry an
 * outcome.
 */
import type { Outcome } from '@classroom-copier/shared'

export const OUTCOME_GLYPH: Record<Outcome, string> = {
  pending: '·',
  transferred: '✓',
  fallback_shell: '◆',
  skipped: '⊘',
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  pending: 'in progress',
  transferred: 'transferred',
  fallback_shell: 'fallback shell',
  skipped: 'skipped',
}

const OUTCOME_TINT: Record<Outcome, string> = {
  pending: 'icon-skip',
  transferred: 'icon-ok',
  fallback_shell: 'icon-note',
  skipped: 'icon-skip',
}

interface OutcomeIconProps {
  outcome: Outcome
  /**
   * Whether the paired text label is shown or visually hidden. Both values
   * render the label; neither removes it.
   */
  labelVisibility?: 'visible' | 'sr-only'
}

export function OutcomeIcon({ outcome, labelVisibility = 'visible' }: OutcomeIconProps) {
  const label = OUTCOME_LABEL[outcome]
  return (
    <span className="outcome-icon" role="img" aria-label={label}>
      <span className={`ticker-icon ${OUTCOME_TINT[outcome]}`} aria-hidden="true">
        {OUTCOME_GLYPH[outcome]}
      </span>
      <span className={labelVisibility === 'sr-only' ? 'sr-only' : undefined}>{label}</span>
    </span>
  )
}
