/**
 * The app shell: a single linear wizard, not a dashboard
 * (02-ux-workflow.md Decisions #1).
 *
 *   sign-in -> forced picker -> Select -> Pre-flight -> Ready -> Transfer -> Summary
 *
 * Rules encoded here rather than left to each screen:
 *  - The step indicator appears on the four post-sign-in steps and is inert.
 *  - Back exists through Ready-to-Transfer and is gone once the batch write has
 *    started — a half-completed batch write is not something Back can undo.
 *  - Switching accounts restarts at Selection and DISCARDS any in-progress,
 *    unconfirmed selection; it is never carried into the new account's list.
 *  - On mount the shell asks the server what is already in flight, so a
 *    reloaded tab lands back on Progress instead of at the beginning.
 *  - The cold-start overlay is driven by the api-client's latency store (D4),
 *    and its 60s ceiling surfaces as an error state, never a spinner forever.
 */
import { useCallback, useEffect, useState } from 'react'
import type {
  AccountSummary,
  CourseSummary,
  PreflightResponse,
  Resolution,
  TransferJobItemRow,
  TransferJobStatus,
} from '@classroom-copier/shared'
import {
  ColdStartOverlay,
  ErrorBoundary,
  ErrorState,
  StepIndicator,
  Button,
} from './components/shared'
import type { StepNumber } from './components/shared'
import { AuthFlow } from './features/auth/AuthFlow'
import { SelectionScreen } from './features/selection/SelectionScreen'
import { PreflightScreen } from './features/preflight/PreflightScreen'
import { ReadyToTransfer } from './features/preflight/ReadyToTransfer'
import { TransferProgress } from './features/transfer/TransferProgress'
import { CompletionSummary } from './features/summary/CompletionSummary'
import {
  coldStartStore,
  createTransferJob,
  getActiveJob,
  getJobItems,
  isAbortError,
  me,
  signOut,
  useColdStart,
} from './lib/api-client'

type Stage = 'auth' | 'selection' | 'preflight' | 'ready' | 'transfer' | 'summary'

const STEP_FOR: Record<Exclude<Stage, 'auth'>, StepNumber> = {
  selection: 1,
  preflight: 2,
  ready: 2,
  transfer: 3,
  summary: 4,
}

/** APPLY-O — the boundary wraps the whole wizard; a render-time throw in any
 *  screen becomes an error state rather than a white page. */
export function App() {
  const [shellKey, setShellKey] = useState(0)
  return (
    <ErrorBoundary onReset={() => setShellKey((key) => key + 1)}>
      <Wizard key={shellKey} />
    </ErrorBoundary>
  )
}

function Wizard() {
  const [account, setAccount] = useState<AccountSummary | null>(null)
  const [authStart, setAuthStart] = useState<'landing' | 'picker'>('landing')
  const [stage, setStage] = useState<Stage>('auth')

  const [source, setSource] = useState<CourseSummary | null>(null)
  const [target, setTarget] = useState<CourseSummary | null>(null)
  const [scan, setScan] = useState<PreflightResponse | null>(null)
  const [resolutions, setResolutions] = useState<Resolution[]>([])
  const [jobId, setJobId] = useState<string | null>(null)
  const [summary, setSummary] = useState<{
    status: TransferJobStatus
    items: TransferJobItemRow[]
  } | null>(null)
  const [error, setError] = useState<unknown>(null)

  const cold = useColdStart()

  /** Everything that must not survive an account switch or a fresh run. */
  const clearRun = useCallback(() => {
    setSource(null)
    setTarget(null)
    setScan(null)
    setResolutions([])
    setJobId(null)
    setSummary(null)
    setError(null)
  }, [])

  // Mount: restore the session, then rediscover any in-flight job (F12).
  //
  // APPLY-N — `me()` resolves to `null` ONLY on 401, and that is the only case
  // that means "no session". Every other rejection is surfaced. Catching them
  // all as "signed out" parked the user on the landing screen with no
  // explanation after a 5xx, and treating a failed `getActiveJob()` as "no
  // active job" dropped them on Selection while a transfer was still running —
  // silently defeating the F12 reconnect guarantee this effect exists for.
  useEffect(() => {
    let live = true
    const controller = new AbortController() // APPLY-M
    me(controller.signal)
      .then(async (session) => {
        if (!live || !session) return
        setAccount(session.account)
        setStage('selection')
        const active = await getActiveJob(controller.signal)
        if (!live || !active) return
        setJobId(active)
        setStage('transfer')
      })
      .catch((error: unknown) => {
        if (!live || isAbortError(error)) return
        setError(error)
      })
    return () => {
      live = false
      controller.abort()
    }
  }, [])

  const handleSignedIn = (next: AccountSummary) => {
    clearRun()
    setAccount(next)
    setStage('selection')
  }

  const switchAccount = () => {
    clearRun()
    setAccount(null)
    setAuthStart('picker')
    setStage('auth')
  }

  const handleSignOut = () => {
    void signOut().catch(() => {})
    clearRun()
    setAccount(null)
    setAuthStart('landing')
    setStage('auth')
  }

  const startTransfer = () => {
    if (!scan) return
    createTransferJob({ scanId: scan.scanId, resolutions })
      .then((result) => {
        // A 409 is not a failure: attach to the job already running (D5).
        setJobId(result.jobId)
        setStage('transfer')
      })
      .catch(setError)
  }

  const handleJobComplete = (status: TransferJobStatus) => {
    getJobItems(status.jobId)
      .then((res) => {
        setSummary({ status, items: res.items })
        setStage('summary')
      })
      .catch(setError)
  }

  const startAnother = () => {
    clearRun()
    setStage('selection')
  }

  /* ---- Error surfaces ------------------------------------------------ */

  if (cold.timedOut) {
    return (
      <div className="frame">
        <ErrorState
          detail="The server did not respond in time."
          onRetry={() => {
            coldStartStore.clearTimeout()
            setError(null)
          }}
          onStartOver={() => {
            coldStartStore.clearTimeout()
            startAnother()
          }}
        />
      </div>
    )
  }

  if (error) {
    return (
      <div className="frame">
        <ErrorState onRetry={() => setError(null)} onStartOver={startAnother} />
      </div>
    )
  }

  /* ---- The wizard ---------------------------------------------------- */

  return (
    <div className="frame">
      {account && stage !== 'auth' ? (
        <div className="header-bar" data-testid="account-header">
          <div className="header-account">
            <span className="avatar" aria-hidden="true">
              {account.initials}
            </span>
            <span>
              {account.displayName} &lt;{account.email}&gt;
            </span>
          </div>
          <div>
            <Button variant="link" onClick={switchAccount}>
              Switch account
            </Button>
            <Button variant="link" onClick={handleSignOut}>
              Sign out
            </Button>
          </div>
        </div>
      ) : null}

      {stage !== 'auth' ? <StepIndicator current={STEP_FOR[stage]} /> : null}

      {cold.coldStart ? <ColdStartOverlay /> : null}

      {stage === 'auth' ? (
        <AuthFlow onSignedIn={handleSignedIn} startAt={authStart} onError={setError} />
      ) : null}

      {stage === 'selection' ? (
        <SelectionScreen
          onContinue={(nextSource, nextTarget) => {
            setSource(nextSource)
            setTarget(nextTarget)
            setStage('preflight')
          }}
        />
      ) : null}

      {stage === 'preflight' && source && target ? (
        <PreflightScreen
          sourceId={source.id}
          targetId={target.id}
          onReady={(result, chosen) => {
            setScan(result)
            setResolutions(chosen)
            setStage('ready')
          }}
          onCancel={() => setStage('selection')}
          onError={setError}
        />
      ) : null}

      {stage === 'ready' && scan ? (
        <ReadyToTransfer
          scan={scan}
          // Back re-validates by returning to Selection rather than trusting a
          // scan that may no longer describe the courses (02-ux-workflow.md §2).
          onBack={() => setStage('selection')}
          onStart={startTransfer}
        />
      ) : null}

      {stage === 'transfer' ? (
        <TransferProgress jobId={jobId} onComplete={handleJobComplete} onStartOver={startAnother} />
      ) : null}

      {stage === 'summary' && summary ? (
        <CompletionSummary
          status={summary.status}
          items={summary.items}
          onOpenTargetCourse={() => {
            window.open(`/mock/courses/${summary.status.targetCourseId}`, '_blank', 'noopener')
          }}
          onStartAnother={startAnother}
        />
      ) : null}
    </div>
  )
}
