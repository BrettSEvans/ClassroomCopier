/**
 * Screen 4c — the confirmation checkpoint before the batch write commits.
 *
 * D26: a scan with `totalPostsScanned === 0` says so out loud. Start Transfer
 * stays as an explicit confirmation (the server creates a zero-item job that
 * completes immediately and still satisfies the reconciliation invariant),
 * rather than the screen quietly reporting success for a copy that never had
 * anything to copy.
 */
import type { PreflightResponse } from '@classroom-copier/shared'
import { Button, DUPLICATE_RUN_NOTICE, NarrationBanner } from '../../components/shared'

export const REASSURANCE =
  'Everything will land as Drafts with dates cleared — nothing is visible to students until you publish it.'

/**
 * APPLY-I — the scan is a snapshot, and this line says when it was taken. A post
 * added to the source after the scan is correctly excluded from the job, and the
 * Completion Summary then reports "N of N" about an N measured earlier; in a
 * product whose thesis is that it never lies about what happened, saying nothing
 * about that was the gap. (`POST /transfer-jobs` also refuses a scan older than
 * the TTL, so the silence is not the only guard.)
 */
export function scannedAtLabel(scannedAt: string): string {
  const at = new Date(scannedAt)
  if (Number.isNaN(at.getTime())) return 'Scanned just now.'
  const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return `Scanned at ${time}. If the source course has changed since, go back and scan again.`
}

interface ReadyToTransferProps {
  scan: PreflightResponse
  onBack: () => void
  onStart: () => void
  backDisabled?: boolean
}

export function ReadyToTransfer({ scan, onBack, onStart, backDisabled = false }: ReadyToTransferProps) {
  const empty = scan.totalPostsScanned === 0

  return (
    <div className="screen">
      <div className="ready-card">
        {empty ? (
          <p>
            <b>0 posts to copy</b> — “{scan.sourceCourseName}” has no classwork to move into “
            {scan.targetCourseName}.”
          </p>
        ) : (
          <p>
            Ready to copy <b>{scan.totalPostsScanned} posts</b> from “{scan.sourceCourseName}” into “
            {scan.targetCourseName}.”
          </p>
        )}
        <p className="reassure">{REASSURANCE}</p>
        <p className="mock-note" data-testid="scan-freshness">
          {scannedAtLabel(scan.scannedAt)}
        </p>
        <NarrationBanner glyph="!">{DUPLICATE_RUN_NOTICE}</NarrationBanner>
        <div className="ready-actions">
          <Button variant="secondary" onClick={onBack} disabled={backDisabled}>
            ← Back
          </Button>
          <Button onClick={onStart}>Start Transfer</Button>
        </div>
      </div>
    </div>
  )
}
