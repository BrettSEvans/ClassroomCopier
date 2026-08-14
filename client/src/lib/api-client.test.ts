import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiRequestError,
  ApiValidationError,
  COLD_START_THRESHOLD_MS,
  coldStartStore,
  isAbortError,
  POLL_INTERVAL_MS,
  POLL_MAX_RETRIES,
  POLL_RETRY_BASE_MS,
  createTransferJob,
  getActiveJob,
  getJobItems,
  getJobStatus,
  health,
  listCourses,
  listMockAccounts,
  me,
  pollJobStatus,
  runPreflight,
  signIn,
  signOut,
} from './api-client'
import type { TransferJobStatus } from '@classroom-copier/shared'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function emptyResponse(status: number): Response {
  return new Response(null, { status })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const STATUS: TransferJobStatus = {
  jobId: 'job-1',
  status: 'running',
  sourceCourseName: 'US History (2025)',
  targetCourseName: 'US History — Period 3',
  targetCourseId: 'c-target',
  totalItems: 42,
  totalPostsScanned: 42,
  pending: 10,
  transferred: 30,
  fallbackShell: 1,
  skippedTotal: 1,
  skippedByUser: 1,
  skippedBySystem: 0,
  topicsCreatedOrMapped: 6,
  rubricNotesAdded: 1,
  currentItem: null,
  rateLimitPause: null,
  startedAt: null,
  finishedAt: null,
}

describe('request plumbing', () => {
  it('sends credentials on every call and targets the configured base URL', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ accounts: [] }))
    await listMockAccounts()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:4000/api/auth/mock-accounts')
    expect(init.credentials).toBe('include')
  })

  it('surfaces a non-OK response as an ApiRequestError carrying the server code', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'not_found', message: 'No such course' } }, 404),
    )
    await expect(listCourses('source')).rejects.toBeInstanceOf(ApiRequestError)
  })
})

describe('auth', () => {
  it('lists the seeded mock accounts', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        accounts: [
          { id: 'a1', displayName: 'Jamie Rivera', email: 'j@x.edu', initials: 'JR' },
          { id: 'a2', displayName: 'Dana Okafor', email: 'd@x.edu', initials: 'DO' },
        ],
      }),
    )
    const res = await listMockAccounts()
    expect(res.accounts).toHaveLength(2)
  })

  it('signs in by account id', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        account: { id: 'a1', displayName: 'Jamie Rivera', email: 'j@x.edu', initials: 'JR' },
      }),
    )
    const res = await signIn('a1')
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ accountId: 'a1' })
    expect(res.account.displayName).toBe('Jamie Rivera')
  })

  it('resolves me() to null on 401 rather than throwing', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'unauthorized', message: 'no' } }, 401))
    await expect(me()).resolves.toBeNull()
  })

  it('signs out', async () => {
    fetchMock.mockResolvedValue(emptyResponse(204))
    await expect(signOut()).resolves.toBeUndefined()
  })
})

describe('courses & pre-flight', () => {
  it('passes the role through as a query parameter', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ courses: [] }))
    await listCourses('target')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:4000/api/courses?role=target')
  })

  it('posts the target id to the source course preflight path', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        scanId: 's1',
        sourceCourseId: 'c1',
        targetCourseId: 'c2',
        sourceCourseName: 'A',
        targetCourseName: 'B',
        totalPostsScanned: 0,
        scannedAt: new Date().toISOString(),
        findings: [],
      }),
    )
    const res = await runPreflight('c1', 'c2')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:4000/api/courses/c1/preflight')
    expect(res.scanId).toBe('s1')
  })
})

describe('transfer jobs', () => {
  it('creates a job', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ jobId: 'job-9' }, 202))
    const res = await createTransferJob({ scanId: 's1', resolutions: [] })
    expect(res).toEqual({ conflict: false, jobId: 'job-9' })
  })

  it('resolves a 409 double-submit to the already-running job instead of throwing (D5)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            // The code the server actually sends. The previous fixture invented
            // `job_in_flight`, which nothing emits.
            code: 'job_already_running',
            message: 'A transfer is already running',
            jobId: 'job-7',
          },
        },
        409,
      ),
    )
    await expect(createTransferJob({ scanId: 's1', resolutions: [] })).resolves.toEqual({
      conflict: true,
      jobId: 'job-7',
    })
  })

  it('does NOT attach to the job named by a scan_already_used 409 (APPLY-C)', async () => {
    // That 409 carries a jobId too — the job the scan already produced, which
    // has finished. Attaching to it would put the user on a progress screen for
    // a transfer that is over.
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'scan_already_used',
            message: 'This pre-flight scan has already been transferred.',
            jobId: 'job-old',
          },
        },
        409,
      ),
    )
    await expect(createTransferJob({ scanId: 's1', resolutions: [] })).rejects.toBeInstanceOf(
      ApiRequestError,
    )
  })

  it('resolves getActiveJob() to null on 204 (F12 reconnect discovery)', async () => {
    fetchMock.mockResolvedValue(emptyResponse(204))
    await expect(getActiveJob()).resolves.toBeNull()
  })

  it('resolves getActiveJob() to the job id on 200', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ jobId: 'job-3' }))
    await expect(getActiveJob()).resolves.toBe('job-3')
  })

  it('reads the itemized log', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ jobId: 'job-1', items: [] }))
    const res = await getJobItems('job-1')
    expect(res.items).toEqual([])
  })

  it('reads health', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'ok', uptimeMs: 12 }))
    await expect(health()).resolves.toEqual({ status: 'ok', uptimeMs: 12 })
  })
})

describe('APPLY-M — a caller can abort its own in-flight request', () => {
  it('rejects with an AbortError and clears the cold-start flag with it', async () => {
    // The internal 60s ceiling used to be the ONLY thing that aborted anything.
    // Components guarded with `live` flags instead, so React was quiet while the
    // fetch ran on and the global slow-request counter stayed incremented —
    // leaving the cold-start overlay visible over a screen that was gone.
    vi.useFakeTimers()
    coldStartStore.reset()
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        }),
    )

    const controller = new AbortController()
    const inFlight = listCourses('source', controller.signal)
    let settled: unknown = null
    void inFlight.catch((error: unknown) => {
      settled = error
    })

    await vi.advanceTimersByTimeAsync(COLD_START_THRESHOLD_MS + 10)
    expect(coldStartStore.getSnapshot().coldStart).toBe(true)

    controller.abort()
    await vi.advanceTimersByTimeAsync(0)

    expect(isAbortError(settled)).toBe(true)
    expect(coldStartStore.getSnapshot().coldStart).toBe(false)
    coldStartStore.reset()
  })
})

describe('shared-zod validation (D17)', () => {
  it('surfaces a malformed status payload as an error rather than rendering it', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ jobId: 'job-1', status: 'sort-of-running' }))
    await expect(getJobStatus('job-1')).rejects.toBeInstanceOf(ApiValidationError)
  })

  it('surfaces a status payload missing the reconciliation counts as an error', async () => {
    const { skippedByUser: _drop, ...missing } = STATUS
    fetchMock.mockResolvedValue(jsonResponse(missing))
    await expect(getJobStatus('job-1')).rejects.toBeInstanceOf(ApiValidationError)
  })

  it('returns the parsed payload when it validates', async () => {
    fetchMock.mockResolvedValue(jsonResponse(STATUS))
    await expect(getJobStatus('job-1')).resolves.toEqual(STATUS)
  })
})

describe('pollJobStatus', () => {
  it('polls on a ~1500ms cadence and stops on a terminal status', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ...STATUS, status: 'running', transferred: 1 }))
      .mockResolvedValueOnce(jsonResponse({ ...STATUS, status: 'running', transferred: 2 }))
      .mockResolvedValueOnce(jsonResponse({ ...STATUS, status: 'completed', transferred: 3 }))
      .mockResolvedValue(jsonResponse({ ...STATUS, status: 'completed', transferred: 99 }))

    const ticks: TransferJobStatus[] = []
    pollJobStatus('job-1', (s) => ticks.push(s))

    await vi.advanceTimersByTimeAsync(0)
    expect(ticks).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(ticks).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(ticks).toHaveLength(3)
    expect(ticks[2]?.status).toBe('completed')

    // Terminal: no further requests, no matter how much time passes.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 10)
    expect(ticks).toHaveLength(3)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('stops when the returned cancel function is called', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(jsonResponse(STATUS))
    const ticks: TransferJobStatus[] = []
    const cancel = pollJobStatus('job-1', (s) => ticks.push(s))

    await vi.advanceTimersByTimeAsync(0)
    expect(ticks).toHaveLength(1)
    cancel()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5)
    expect(ticks).toHaveLength(1)
  })

  /* ---------------------------------------------------------------- *
   * P0-5. The test that used to live here asserted that ONE failure
   * killed the loop forever — it encoded the bug as the contract. With no
   * mid-transfer cancel in v1, that left the user on a frozen screen.
   * ---------------------------------------------------------------- */

  it('survives a transient blip instead of dying on the first one', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockRejectedValueOnce(new TypeError('network hiccup'))
      .mockResolvedValue(jsonResponse(STATUS))

    const ticks: TransferJobStatus[] = []
    const onError = vi.fn()
    pollJobStatus('job-1', (s) => ticks.push(s), onError)

    await vi.advanceTimersByTimeAsync(0)
    expect(ticks).toHaveLength(0)
    expect(onError).not.toHaveBeenCalled()

    // It comes back on its own.
    await vi.advanceTimersByTimeAsync(POLL_RETRY_BASE_MS)
    expect(ticks).toHaveLength(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('gives up only after POLL_MAX_RETRIES consecutive failures, then stops', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(jsonResponse({ nonsense: true }))
    const onError = vi.fn()
    pollJobStatus('job-1', () => {}, onError)

    await vi.advanceTimersByTimeAsync(0)
    expect(onError).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(onError).toHaveBeenCalledTimes(1)
    // One initial attempt plus the bounded retries — no more, no fewer.
    const attempts = fetchMock.mock.calls.length
    expect(attempts).toBe(POLL_MAX_RETRIES + 1)

    // And then it is genuinely stopped.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchMock.mock.calls.length).toBe(attempts)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('resets the failure budget after a successful poll', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockRejectedValueOnce(new TypeError('blip 1'))
      .mockResolvedValueOnce(jsonResponse(STATUS))
      .mockRejectedValueOnce(new TypeError('blip 2'))
      .mockResolvedValue(jsonResponse({ ...STATUS, status: 'completed', pending: 0 }))

    const ticks: TransferJobStatus[] = []
    const onError = vi.fn()
    pollJobStatus('job-1', (s) => ticks.push(s), onError)

    await vi.advanceTimersByTimeAsync(60_000)
    // A long transfer that hiccups now and then must never give up.
    expect(onError).not.toHaveBeenCalled()
    expect(ticks.length).toBeGreaterThanOrEqual(2)
    expect(ticks[ticks.length - 1]?.status).toBe('completed')
  })
})
