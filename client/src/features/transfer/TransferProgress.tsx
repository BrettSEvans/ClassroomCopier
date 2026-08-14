/**
 * Screen 5 — Batch Transfer Progress.
 *
 * Three things here are load-bearing rather than decorative:
 *
 *  - **F12 reconnect.** On mount the screen asks the server what is already in
 *    flight (`GET /transfer-jobs/active`) instead of assuming the job it was
 *    handed. A reloaded tab therefore lands back on live progress rather than
 *    restarting or duplicating the job.
 *  - **aria-live throttling** (02-ux-workflow.md §6). ONE polite region,
 *    announcing a periodic count — every ~5 items AND no more often than ~3s,
 *    "whichever is less frequent" — plus exactly one completion announcement.
 *    Never per item: 50 spoken outcomes is unusable screen-reader noise.
 *  - **D12.** `status === 'failed'` is a real error state, not a progress bar
 *    that stopped moving.
 *  - **P0-5.** Both dead ends on that error state are gone. A LOST POLL is now
 *    recoverable here — the poll retries with backoff first (api-client), and
 *    if it still gives up, Retry genuinely restarts the loop, because a bumped
 *    `restartToken` re-runs the effect. Before, `onRetry` was wired to
 *    `setStage('transfer')` while the stage was ALREADY `'transfer'`: a React
 *    no-op, so the button did nothing at all, and no test clicked it. A job
 *    that reached `failed` SERVER-side offers no Retry, because retrying a
 *    terminal failure cannot succeed; it routes back to Selection instead.
 *
 * There is no cancel control in v1 (02-ux-workflow.md Decisions #13).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CurrentItem, TransferJobStatus } from '@classroom-copier/shared'
import { isTerminalJobStatus } from '@classroom-copier/shared'
import {
  ErrorState,
  NarrationBanner,
  OutcomeIcon,
  RATE_LIMIT_NOTICE,
} from '../../components/shared'
import { getActiveJob, isAbortError, pollJobStatus } from '../../lib/api-client'

/** "every 5 items or every ~3 seconds, whichever is LESS frequent" — so both. */
export const ANNOUNCE_EVERY_ITEMS = 5
export const ANNOUNCE_EVERY_MS = 3000
const TICKER_LENGTH = 3

interface TransferProgressProps {
  /** The job just created, if any. The server's answer still wins. */
  jobId: string | null
  onComplete: (status: TransferJobStatus) => void
  /** Where "Start Over" goes: back to Selection. */
  onStartOver: () => void
}

export function TransferProgress({ jobId, onComplete, onStartOver }: TransferProgressProps) {
  const [status, setStatus] = useState<TransferJobStatus | null>(null)
  const [ticker, setTicker] = useState<CurrentItem[]>([])
  const [announcement, setAnnouncement] = useState('')
  const [countdownMs, setCountdownMs] = useState<number | null>(null)
  /** P0-5 — the poll gave up after its bounded retries. Recoverable, locally. */
  const [pollFailed, setPollFailed] = useState(false)
  /** P0-5 — bumping this re-runs the poll effect. THIS is what Retry does. */
  const [restartToken, setRestartToken] = useState(0)

  /** The bar is monotonic: it freezes on pause and never reverses (§3). */
  const highWater = useRef(0)
  const lastAnnouncedAt = useRef(0)
  const lastAnnouncedCount = useRef(0)
  const completedOnce = useRef(false)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const handleTick = useCallback((next: TransferJobStatus) => {
    setStatus(next)

    const resolved = next.totalItems - next.pending
    if (resolved > highWater.current) highWater.current = resolved

    if (next.currentItem && next.currentItem.outcome !== 'pending') {
      const item = next.currentItem
      setTicker((prev) =>
        prev[0] && prev[0].title === item.title && prev[0].outcome === item.outcome
          ? prev
          : [item, ...prev].slice(0, TICKER_LENGTH),
      )
    }

    setCountdownMs(next.rateLimitPause ? next.rateLimitPause.retryInMs : null)

    if (isTerminalJobStatus(next.status)) {
      if (next.status !== 'failed' && !completedOnce.current) {
        completedOnce.current = true
        setAnnouncement(`Transfer complete. ${resolved} of ${next.totalItems} posts processed.`)
        onCompleteRef.current(next)
      }
      return
    }

    const now = Date.now()
    const sinceItems = resolved - lastAnnouncedCount.current
    const sinceMs = now - lastAnnouncedAt.current
    if (sinceItems >= ANNOUNCE_EVERY_ITEMS && sinceMs >= ANNOUNCE_EVERY_MS) {
      lastAnnouncedCount.current = resolved
      lastAnnouncedAt.current = now
      setAnnouncement(`${resolved} of ${next.totalItems} posts processed.`)
    }
  }, [])

  // Mount (and every explicit restart): rediscover the in-flight job, then poll
  // it. `restartToken` is the ONLY thing that re-runs this — a re-render never
  // starts a second poll loop.
  useEffect(() => {
    let cancelPoll: (() => void) | undefined
    let live = true
    // APPLY-M — the discovery request is aborted if this screen goes away.
    const controller = new AbortController()

    getActiveJob(controller.signal)
      .catch((error: unknown) => {
        // A failed discovery is not fatal: fall back to the job we were handed.
        if (!isAbortError(error)) return null
        return null
      })
      .then((active) => {
        if (!live) return
        const target = active ?? jobId
        if (!target) return
        cancelPoll = pollJobStatus(target, handleTick, () => {
          if (live) setPollFailed(true)
        })
      })

    return () => {
      live = false
      controller.abort()
      cancelPoll?.()
    }
    // Deps are deliberately just `restartToken`: restarting is an explicit user
    // action, never a consequence of a re-render. Adding `jobId`/`handleTick`
    // here would start a second poll loop.
  }, [restartToken])

  const restart = useCallback(() => {
    setPollFailed(false)
    setStatus(null)
    setTicker([])
    setRestartToken((token) => token + 1)
  }, [])

  // The rate-limit countdown ticks locally between polls.
  useEffect(() => {
    if (countdownMs === null) return undefined
    const handle = setInterval(() => {
      setCountdownMs((ms) => (ms === null ? null : Math.max(0, ms - 1000)))
    }, 1000)
    return () => clearInterval(handle)
  }, [countdownMs === null])

  // P0-5 — the job is terminally `failed` on the server. Polling it again will
  // report `failed` again, so there is no Retry to offer; Start Over routes back
  // to Selection with the failure explained.
  if (status?.status === 'failed') {
    return (
      <ErrorState
        onStartOver={onStartOver}
        detail="The transfer stopped partway. The itemized log records what had already been copied, and nothing else will be written."
      />
    )
  }

  // P0-5 — we lost contact with the server, not the job. This one IS worth
  // retrying, and Retry restarts the poll for real.
  if (pollFailed) {
    return (
      <ErrorState
        onRetry={restart}
        onStartOver={onStartOver}
        detail="We lost contact with the server while the transfer was running. The transfer itself may still be going — try again to reconnect to it."
      />
    )
  }

  const total = status?.totalItems ?? 0
  const resolved = Math.max(highWater.current, 0)
  const percent = total > 0 ? Math.round((resolved / total) * 100) : 0

  return (
    <div className="screen">
      <div className="progress-wrap">
        <div className="progress-count">{`Transferring ${resolved} of ${total} posts…`}</div>
        <div
          className="progress-track"
          role="progressbar"
          aria-valuenow={resolved}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label="Posts copied"
        >
          <div className="progress-fill" style={{ width: `${percent}%` }} />
        </div>

        <div className="ticker">
          {ticker.length === 0 ? (
            <div className="ticker-row">Starting…</div>
          ) : (
            ticker.map((item, i) => (
              <div className="ticker-row" key={`${item.title}-${i}`}>
                <OutcomeIcon outcome={item.outcome} />
                <span>“{item.title}”</span>
              </div>
            ))
          )}
        </div>

        {status?.rateLimitPause ? (
          <NarrationBanner glyph="⏱" variant="rate-banner">
            {RATE_LIMIT_NOTICE(Math.ceil((countdownMs ?? status.rateLimitPause.retryInMs) / 1000))}
          </NarrationBanner>
        ) : null}

        {/* One region. Throttled. Never per item. */}
        <div
          className="sr-only"
          role="status"
          aria-live="polite"
          data-testid="progress-live-region"
        >
          {announcement}
        </div>
      </div>
    </div>
  )
}
