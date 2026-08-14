/**
 * The wizard end to end, against a stubbed api-client: sign-in -> forced
 * picker -> selection -> pre-flight -> ready -> transfer -> summary, checking
 * the step indicator and Back availability at every step.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AccountSummary,
  CourseSummary,
  TransferJobItemRow,
  TransferJobStatus,
} from '@classroom-copier/shared'
import { App } from './App'
import * as api from './lib/api-client'

vi.mock('./lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('./lib/api-client')>('./lib/api-client')
  return {
    ...actual,
    me: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    listMockAccounts: vi.fn(),
    listCourses: vi.fn(),
    runPreflight: vi.fn(),
    createTransferJob: vi.fn(),
    getActiveJob: vi.fn(),
    getJobItems: vi.fn(),
    pollJobStatus: vi.fn(),
  }
})

const JAMIE: AccountSummary = {
  id: 'acct-jamie',
  displayName: 'Jamie Rivera',
  email: 'jamie.rivera@pickettusd.mock.edu',
  initials: 'JR',
}
const DANA: AccountSummary = {
  id: 'acct-dana',
  displayName: 'Dana Okafor',
  email: 'dana.okafor@pickettusd.mock.edu',
  initials: 'DO',
}

const SOURCE: CourseSummary = {
  id: 'c-source',
  name: 'US History (2025)',
  section: 'Period 3',
  state: 'ACTIVE',
  isSisShell: false,
  postCount: 42,
}
const TARGET: CourseSummary = {
  id: 'c-target',
  name: 'US History — Period 3',
  section: null,
  state: 'ACTIVE',
  isSisShell: true,
  postCount: 0,
}

const COMPLETED: TransferJobStatus = {
  jobId: 'job-1',
  status: 'completed',
  sourceCourseName: SOURCE.name,
  targetCourseName: TARGET.name,
  targetCourseId: TARGET.id,
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
  cancelRequested: false,
  cancelledAt: null,
  startedAt: null,
  finishedAt: null,
}

const ITEM: TransferJobItemRow = {
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

let emit: (s: TransferJobStatus) => void
let polledJobIds: string[]

beforeEach(() => {
  vi.clearAllMocks()
  polledJobIds = []
  emit = () => {}
  vi.mocked(api.me).mockResolvedValue(null)
  vi.mocked(api.signIn).mockImplementation(async (id) => ({
    account: id === JAMIE.id ? JAMIE : DANA,
  }))
  vi.mocked(api.signOut).mockResolvedValue(undefined)
  vi.mocked(api.listMockAccounts).mockResolvedValue({ accounts: [JAMIE, DANA] })
  vi.mocked(api.listCourses).mockImplementation(async (role) =>
    role === 'source' ? { courses: [SOURCE] } : { courses: [TARGET] },
  )
  vi.mocked(api.runPreflight).mockResolvedValue({
    scanId: 'scan-1',
    sourceCourseId: SOURCE.id,
    targetCourseId: TARGET.id,
    sourceCourseName: SOURCE.name,
    targetCourseName: TARGET.name,
    totalPostsScanned: 42,
    scannedAt: new Date().toISOString(),
    findings: [],
  })
  vi.mocked(api.createTransferJob).mockResolvedValue({ conflict: false, jobId: 'job-1' })
  vi.mocked(api.getActiveJob).mockResolvedValue(null)
  vi.mocked(api.getJobItems).mockResolvedValue({ jobId: 'job-1', items: [ITEM] })
  vi.mocked(api.pollJobStatus).mockImplementation((jobId, onTick) => {
    polledJobIds.push(jobId)
    emit = onTick
    return () => {}
  })
})

function currentStep(): string | null {
  const el = document.querySelector('[aria-current="step"]')
  return el?.textContent ?? null
}

function backButton(): HTMLElement | null {
  return screen.queryByRole('button', { name: /←\s*Back/ })
}

/**
 * The course lists arrive asynchronously, so the `<select>` exists before its
 * `<option>`s do. Waiting on the label alone raced the fetch and failed
 * intermittently with "Value \"c-source\" not found in options" — a flaky test
 * is a gate nobody trusts.
 */
async function loadedSelect(label: string): Promise<HTMLSelectElement> {
  const select = (await screen.findByLabelText(label)) as HTMLSelectElement
  await waitFor(() => expect(select.options.length).toBeGreaterThan(1))
  return select
}

describe('the linear wizard', () => {
  it('walks sign-in -> summary, tracking the step indicator and Back availability', async () => {
    render(<App />)

    // --- Sign-in landing: no step indicator yet.
    await screen.findByRole('button', { name: 'Sign in with Google (mock)' })
    expect(currentStep()).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google (mock)' }))

    // --- Forced picker.
    await screen.findByRole('heading', { name: 'Choose an account' })
    expect(currentStep()).toBeNull()
    await userEvent.click(await screen.findByRole('button', { name: /Jamie Rivera/ }))

    // --- Step 1: Selection. No Back — this is the first step.
    const source = await loadedSelect('Copy from (source)')
    const target = await loadedSelect('Copy to (target)')
    expect(currentStep()).toBe('1 Select')
    expect(backButton()).toBeNull()

    await userEvent.selectOptions(source, SOURCE.id)
    await userEvent.selectOptions(target, TARGET.id)
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }))

    // --- Step 2: Pre-flight, then Ready to Transfer with Back enabled.
    await waitFor(() => expect(currentStep()).toBe('2 Pre-flight'))
    await screen.findByText(/Ready to copy/, undefined, { timeout: 4000 })
    expect(currentStep()).toBe('2 Pre-flight')
    expect(backButton()).toBeEnabled()

    await userEvent.click(screen.getByRole('button', { name: 'Start Transfer' }))

    // --- Step 3: Transfer. Back is gone once the batch write has started,
    // but Cancel transfer (the mid-transfer partial-completion control) is
    // there instead — a half-completed batch write is not something Back can
    // undo, but it IS something the teacher can stop from here on out.
    await waitFor(() => expect(currentStep()).toBe('3 Transfer'))
    await waitFor(() => expect(polledJobIds).toContain('job-1'))
    expect(backButton()).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel transfer' })).toBeInTheDocument()

    // --- Step 4: Summary.
    act(() => emit(COMPLETED))
    await screen.findByRole('heading', { name: 'Transfer complete.' })
    expect(currentStep()).toBe('4 Summary')
    expect(backButton()).toBeNull()
    expect(screen.getByTestId('reconciliation')).toHaveTextContent('39 + 2 + 1 = 42 of 42')
  })

  it('shows the persistent account header once signed in', async () => {
    vi.mocked(api.me).mockResolvedValue({ account: JAMIE })
    render(<App />)

    const header = await screen.findByTestId('account-header')
    expect(within(header).getByText('JR')).toBeInTheDocument()
    expect(within(header).getByText(/Jamie Rivera/)).toBeInTheDocument()
    expect(within(header).getByText(/jamie\.rivera@pickettusd\.mock\.edu/)).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: 'Switch account' })).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('re-triggers the forced picker on "Switch account" and discards the in-progress selection', async () => {
    vi.mocked(api.me).mockResolvedValue({ account: JAMIE })
    render(<App />)

    const sourceSelect = await loadedSelect('Copy from (source)')
    await userEvent.selectOptions(sourceSelect, SOURCE.id)
    expect(sourceSelect.value).toBe(SOURCE.id)

    await userEvent.click(screen.getByRole('button', { name: 'Switch account' }))
    expect(await screen.findByRole('heading', { name: 'Choose an account' })).toBeInTheDocument()

    await userEvent.click(await screen.findByRole('button', { name: /Dana Okafor/ }))

    const reloaded = await loadedSelect('Copy from (source)')
    expect(currentStep()).toBe('1 Select')
    expect(reloaded.value).toBe('')
  })

  it('signs out back to the landing screen', async () => {
    vi.mocked(api.me).mockResolvedValue({ account: JAMIE })
    render(<App />)
    await screen.findByLabelText('Copy from (source)')
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(api.signOut).toHaveBeenCalledTimes(1))
    expect(
      await screen.findByRole('button', { name: 'Sign in with Google (mock)' }),
    ).toBeInTheDocument()
  })

  it('lands a reloaded tab back on Progress when a job is already in flight (F12)', async () => {
    vi.mocked(api.me).mockResolvedValue({ account: JAMIE })
    vi.mocked(api.getActiveJob).mockResolvedValue('job-77')
    render(<App />)

    await waitFor(() => expect(currentStep()).toBe('3 Transfer'))
    await waitFor(() => expect(polledJobIds).toContain('job-77'))
    expect(screen.queryByLabelText('Copy from (source)')).toBeNull()
  })

  /* ---------------------------------------------------------------- *
   * APPLY-N — a broken server is not "you are signed out"
   * ---------------------------------------------------------------- */

  it('surfaces a non-401 session failure instead of silently showing the sign-in screen', async () => {
    // `me()` resolves to null ONLY on 401. Every other rejection used to be
    // swallowed by a bare `.catch(() => {})`, parking the user on the landing
    // screen after a 5xx with no explanation at all.
    vi.mocked(api.me).mockRejectedValue(
      new api.ApiRequestError(500, 'internal', 'Something went wrong.'),
    )
    render(<App />)
    expect(await screen.findByTestId('error-state')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign in with Google (mock)' })).toBeNull()
  })

  it('surfaces a failed active-job lookup rather than dropping the user on Selection (F12)', async () => {
    // Treating any `getActiveJob()` failure as "no active job" sent the user to
    // Selection while a transfer was still running server-side — silently
    // defeating the reconnect guarantee that call exists to deliver.
    vi.mocked(api.me).mockResolvedValue({ account: JAMIE })
    vi.mocked(api.getActiveJob).mockRejectedValue(
      new api.ApiRequestError(503, 'unavailable', 'Service unavailable.'),
    )
    render(<App />)
    expect(await screen.findByTestId('error-state')).toBeInTheDocument()
  })

  /* ---------------------------------------------------------------- *
   * APPLY-O — a render-time throw is not a white page
   * ---------------------------------------------------------------- */

  it('catches a render-time throw in a screen and offers a way out', async () => {
    // Every other error path in this client is a `.catch()` into state, which
    // covers asynchronous failure and nothing else. A synchronous throw during
    // render unmounted the whole tree, mid-batch-write, with no cancel control.
    vi.mocked(api.me).mockResolvedValue({ account: JAMIE })
    vi.mocked(api.listCourses).mockImplementation(() => {
      throw new Error('render-time explosion')
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render(<App />)
      expect(await screen.findByTestId('error-state')).toBeInTheDocument()
      // The boundary's own copy, so this cannot pass via the async error path.
      expect(
        screen.getByText(/The screen could not be displayed/),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Start Over' })).toBeInTheDocument()
    } finally {
      consoleError.mockRestore()
    }
  })

  it('returns to Selection from the summary via "Start another transfer"', async () => {
    vi.mocked(api.me).mockResolvedValue({ account: JAMIE })
    vi.mocked(api.getActiveJob).mockResolvedValue('job-1')
    render(<App />)
    await waitFor(() => expect(polledJobIds).toContain('job-1'))

    act(() => emit(COMPLETED))
    await screen.findByRole('heading', { name: 'Transfer complete.' })

    await userEvent.click(screen.getByRole('button', { name: 'Start another transfer' }))
    await screen.findByLabelText('Copy from (source)')
    expect(currentStep()).toBe('1 Select')
  })
})
