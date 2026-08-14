import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  Badge,
  Button,
  COLD_START_SUBLINE,
  COLD_START_TITLE,
  ColdStartOverlay,
  DUPLICATE_RUN_NOTICE,
  ErrorState,
  NarrationBanner,
  OUTCOME_LABEL,
  OutcomeIcon,
  OutcomePill,
  RATE_LIMIT_NOTICE,
  StepIndicator,
} from './index'
import type { Outcome } from '@classroom-copier/shared'

describe('ColdStartOverlay', () => {
  it('is a polite status region carrying the pinned copy', () => {
    render(<ColdStartOverlay />)
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent(COLD_START_TITLE)
    expect(status).toHaveTextContent(COLD_START_SUBLINE)
    expect(COLD_START_TITLE).toBe('Waking up server…')
    expect(COLD_START_SUBLINE).toBe('This can take up to 50 seconds the first time.')
  })

  it('announces once — the region text does not change as time passes', () => {
    const { rerender } = render(<ColdStartOverlay />)
    const before = screen.getByRole('status').textContent
    for (let i = 0; i < 10; i += 1) rerender(<ColdStartOverlay />)
    expect(screen.getByRole('status').textContent).toBe(before)
  })

  it('renders a static equivalent under prefers-reduced-motion', () => {
    const matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    vi.stubGlobal('matchMedia', matchMedia)
    const { container } = render(<ColdStartOverlay />)
    expect(container.querySelector('.spinner-static')).not.toBeNull()
    expect(container.querySelector('.spinner')).toBeNull()
    vi.unstubAllGlobals()
  })
})

describe('NarrationBanner', () => {
  it('is an inline banner, never a modal interrupt', () => {
    render(<NarrationBanner glyph="!">{DUPLICATE_RUN_NOTICE}</NarrationBanner>)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText(DUPLICATE_RUN_NOTICE)).toBeInTheDocument()
  })

  it('carries the duplicate-run copy and the rate-limit copy as distinct strings', () => {
    expect(DUPLICATE_RUN_NOTICE).toBe(
      'Running the same copy more than once creates duplicate drafts — Classroom Copier does not check for existing copies yet.',
    )
    expect(RATE_LIMIT_NOTICE(8)).toContain('retrying automatically in 8s')
    expect(RATE_LIMIT_NOTICE(8)).not.toBe(DUPLICATE_RUN_NOTICE)
  })

  it('renders the rate-limit variant with its own styling hook', () => {
    const { container } = render(
      <NarrationBanner glyph="⏱" variant="rate-banner">
        {RATE_LIMIT_NOTICE(3)}
      </NarrationBanner>,
    )
    expect(container.querySelector('.rate-banner')).not.toBeNull()
  })
})

describe('StepIndicator', () => {
  const LABELS = ['1 Select', '2 Pre-flight', '3 Transfer', '4 Summary']

  it('renders the four steps in order', () => {
    render(<StepIndicator current={1} />)
    LABELS.forEach((label) => expect(screen.getByText(label)).toBeInTheDocument())
  })

  it('is non-interactive — no links, no buttons', () => {
    const { container } = render(<StepIndicator current={3} />)
    expect(container.querySelectorAll('a, button')).toHaveLength(0)
  })

  it('marks the current step with aria-current="step" and nothing else', () => {
    render(<StepIndicator current={3} />)
    const current = screen.getByText('3 Transfer')
    expect(current).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText('2 Pre-flight')).not.toHaveAttribute('aria-current')
    expect(screen.getByText('4 Summary')).not.toHaveAttribute('aria-current')
  })
})

describe('OutcomeIcon (D30)', () => {
  const OUTCOMES: Outcome[] = ['transferred', 'fallback_shell', 'skipped']

  it.each(OUTCOMES)('%s has a non-empty accessible name', (outcome) => {
    render(<OutcomeIcon outcome={outcome} />)
    const img = screen.getByRole('img')
    expect(img).toHaveAccessibleName(OUTCOME_LABEL[outcome])
    expect(OUTCOME_LABEL[outcome].length).toBeGreaterThan(0)
  })

  it.each(OUTCOMES)('%s renders its text label in the DOM, not the glyph alone', (outcome) => {
    const { container } = render(<OutcomeIcon outcome={outcome} />)
    expect(within(container).getByText(OUTCOME_LABEL[outcome])).toBeInTheDocument()
  })

  it('keeps the label when the label is visually hidden', () => {
    const { container } = render(<OutcomeIcon outcome="skipped" labelVisibility="sr-only" />)
    const label = within(container).getByText(OUTCOME_LABEL.skipped)
    expect(label).toHaveClass('sr-only')
    expect(screen.getByRole('img')).toHaveAccessibleName(OUTCOME_LABEL.skipped)
  })

  it('has no prop that suppresses the label — passing plausible suppressors changes nothing', () => {
    const hostile = {
      outcome: 'transferred',
      hideLabel: true,
      iconOnly: true,
      showLabel: false,
      noLabel: true,
      label: '',
      'aria-label': '',
    } as unknown as { outcome: Outcome }
    render(<OutcomeIcon {...hostile} />)
    expect(screen.getByRole('img')).toHaveAccessibleName(OUTCOME_LABEL.transferred)
    expect(screen.getByText(OUTCOME_LABEL.transferred)).toBeInTheDocument()
  })

  it('declares no icon-only mode in its source', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/shared/OutcomeIcon.tsx'),
      'utf8',
    )
    expect(source).not.toMatch(/hideLabel|iconOnly|noLabel|labelless|withoutLabel/i)
  })
})

describe('OutcomePill', () => {
  it.each([
    ['transferred', 'Transferred', 'outcome-transferred'],
    ['fallback_shell', 'Fallback', 'outcome-fallback'],
    ['skipped', 'Skipped', 'outcome-skipped'],
  ] as const)('%s renders text plus a colour class, never colour alone', (outcome, text, cls) => {
    render(<OutcomePill outcome={outcome} />)
    const pill = screen.getByText(text)
    expect(pill).toHaveClass('outcome-pill')
    expect(pill).toHaveClass(cls)
  })
})

describe('Button', () => {
  it('renders a primary button that calls its handler', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Continue →</Button>)
    const button = screen.getByRole('button', { name: 'Continue →' })
    expect(button).toHaveClass('btn-primary')
    await userEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not fire when disabled', async () => {
    const onClick = vi.fn()
    render(
      <Button onClick={onClick} disabled>
        Continue →
      </Button>,
    )
    await userEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders secondary and link variants', () => {
    const { container } = render(
      <>
        <Button variant="secondary">Back</Button>
        <Button variant="link">Sign out</Button>
      </>,
    )
    expect(container.querySelector('.btn-secondary')).not.toBeNull()
    expect(container.querySelector('.link-btn')).not.toBeNull()
  })
})

describe('Badge', () => {
  it.each([
    ['active', 'Active', 'badge-active'],
    ['archived', 'Archived', 'badge-archived'],
    ['sis', 'SIS Roster Shell', 'badge-sis'],
  ] as const)('%s renders as a stamped tag', (kind, text, cls) => {
    render(<Badge kind={kind} />)
    const badge = screen.getByText(text)
    expect(badge).toHaveClass('badge')
    expect(badge).toHaveClass(cls)
  })
})

describe('ErrorState', () => {
  it('says what happened without blaming the user, and offers Retry / Start Over', async () => {
    const onRetry = vi.fn()
    const onStartOver = vi.fn()
    render(<ErrorState onRetry={onRetry} onStartOver={onStartOver} />)

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    const body = screen.getByTestId('error-state').textContent ?? ''
    expect(body).not.toMatch(/\byou(r)?\s+(mistake|error|fault)\b/i)
    expect(body).not.toContain('!')

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await userEvent.click(screen.getByRole('button', { name: 'Start Over' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onStartOver).toHaveBeenCalledTimes(1)
  })

  it('shows an optional detail line', () => {
    render(<ErrorState onRetry={() => {}} onStartOver={() => {}} detail="The server did not respond in time." />)
    expect(screen.getByText('The server did not respond in time.')).toBeInTheDocument()
  })

  /**
   * Fix 2 — this is the app-wide catch-all (App.tsx's bare `if (error)`
   * branch renders it with no `detail` at all), yet the body copy hard-coded
   * "the transfer" and "the itemized log" — wrong for a session-load failure,
   * an active-job lookup failure, or a render-time crash on Selection, none
   * of which involve a transfer or a log. The default body must stay generic.
   */
  it('keeps the default body generic rather than assuming a transfer/log context that is not always true', () => {
    const { rerender } = render(<ErrorState onRetry={() => {}} onStartOver={() => {}} />)
    let body = screen.getByTestId('error-state').textContent ?? ''
    expect(body).not.toMatch(/the transfer/i)
    expect(body).not.toMatch(/itemized log/i)

    rerender(<ErrorState onStartOver={() => {}} />)
    body = screen.getByTestId('error-state').textContent ?? ''
    expect(body).not.toMatch(/the transfer/i)
    expect(body).not.toMatch(/itemized log/i)
  })
})
