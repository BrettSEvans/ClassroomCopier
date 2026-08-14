/**
 * UX Acceptance Scenario 1 — forced account picker (F10).
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountSummary } from '@classroom-copier/shared'
import { AuthFlow } from './AuthFlow'
import * as api from '../../lib/api-client'

vi.mock('../../lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api-client')>(
    '../../lib/api-client',
  )
  return {
    ...actual,
    listMockAccounts: vi.fn(),
    signIn: vi.fn(),
    me: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.listMockAccounts).mockResolvedValue({ accounts: [JAMIE, DANA] })
  vi.mocked(api.signIn).mockImplementation(async (accountId: string) => ({
    account: accountId === JAMIE.id ? JAMIE : DANA,
  }))
  vi.mocked(api.me).mockResolvedValue({ account: JAMIE })
})

describe('Sign-in landing', () => {
  it('carries the wordmark, tagline, CTA and mock sub-note', () => {
    const { container } = render(<AuthFlow onSignedIn={() => {}} />)
    expect(screen.getByText('Classroom Copier')).toBeInTheDocument()
    expect(container.querySelector('.wordmark .seal')).not.toBeNull()
    expect(
      screen.getByText(
        'Batch-copy your classwork into any existing course — without duplicating Drive files.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in with Google (mock)' })).toBeInTheDocument()
    const note = screen.getByText('v1 uses simulated Google accounts for demo/testing.')
    expect(note).toHaveClass('mock-note')
  })
})

describe('Mock account picker (Acceptance Scenario 1)', () => {
  it('lists both seeded accounts with initials, name and email', async () => {
    render(<AuthFlow onSignedIn={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google (mock)' }))

    const rows = await screen.findAllByRole('button', { name: /pickettusd\.mock\.edu/ })
    expect(rows).toHaveLength(2)
    expect(screen.getByText('Jamie Rivera')).toBeInTheDocument()
    expect(screen.getByText('jamie.rivera@pickettusd.mock.edu')).toBeInTheDocument()
    expect(screen.getByText('JR')).toBeInTheDocument()
    expect(screen.getByText('Dana Okafor')).toBeInTheDocument()
    expect(screen.getByText('dana.okafor@pickettusd.mock.edu')).toBeInTheDocument()
    expect(screen.getByText('DO')).toBeInTheDocument()
  })

  it('signs in with the chosen account and reports it', async () => {
    const onSignedIn = vi.fn()
    render(<AuthFlow onSignedIn={onSignedIn} />)
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google (mock)' }))
    await userEvent.click(await screen.findByRole('button', { name: /Dana Okafor/ }))

    await waitFor(() => expect(api.signIn).toHaveBeenCalledWith(DANA.id))
    expect(onSignedIn).toHaveBeenCalledWith(DANA)
  })

  it('renders unconditionally on a second sign-in, even with a session already established', async () => {
    const onSignedIn = vi.fn()
    const { unmount } = render(<AuthFlow onSignedIn={onSignedIn} />)
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google (mock)' }))
    await userEvent.click(await screen.findByRole('button', { name: /Jamie Rivera/ }))
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1))
    unmount()

    // "Switch account" re-enters the flow directly at the picker. It is never
    // skipped and never remembered.
    render(<AuthFlow onSignedIn={onSignedIn} startAt="picker" />)
    expect(await screen.findByRole('heading', { name: 'Choose an account' })).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: /Dana Okafor/ }))
    await waitFor(() => expect(api.signIn).toHaveBeenCalledTimes(2))
    expect(api.me).not.toHaveBeenCalled()
  })

  it('offers "Use another account" as present-but-disabled with an explanatory tooltip', async () => {
    render(<AuthFlow onSignedIn={() => {}} startAt="picker" />)
    const another = await screen.findByRole('button', { name: 'Use another account' })
    expect(another).toBeDisabled()
    expect(another).toHaveAttribute('title', 'not available in mock mode')
  })

  it('returns to the landing screen on Cancel', async () => {
    render(<AuthFlow onSignedIn={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google (mock)' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(
      screen.getByRole('button', { name: 'Sign in with Google (mock)' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Choose an account' })).toBeNull()
  })
})
