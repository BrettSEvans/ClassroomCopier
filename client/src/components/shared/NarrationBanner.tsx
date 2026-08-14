/**
 * The shared "in-the-moment narration" banner (03-ui-direction.md §3).
 *
 * One component, three uses:
 *  - the duplicate-run notice on Source & Target Selection,
 *  - the same sentence restated on Ready to Transfer (UX Acceptance #6 —
 *    identical copy, which is why it is a constant and not two literals),
 *  - the rate-limit pause banner on Batch Transfer Progress, which is a
 *    different event and carries its own distinct copy.
 *
 * It is never a modal interrupt.
 */
import type { ReactNode } from 'react'

/** Reused verbatim at its two touchpoints. Do not retype it at a call site. */
export const DUPLICATE_RUN_NOTICE =
  'Running the same copy more than once creates duplicate drafts — Classroom Copier does not check for existing copies yet.'

/** Same component, different event, its own copy. */
export function RATE_LIMIT_NOTICE(retryInSeconds: number): string {
  return `Google is rate-limiting requests — retrying automatically in ${retryInSeconds}s. Progress pauses here and resumes on its own.`
}

interface NarrationBannerProps {
  /** The leading status glyph: `!` for the notice, `⏱` for the rate-limit pause. */
  glyph: string
  variant?: 'notice' | 'rate-banner'
  children: ReactNode
}

export function NarrationBanner({ glyph, variant = 'notice', children }: NarrationBannerProps) {
  return (
    <div className={variant}>
      <span className="glyph" aria-hidden="true">
        {glyph}
      </span>
      <span>{children}</span>
    </div>
  )
}
