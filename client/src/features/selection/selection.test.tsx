/**
 * UX Acceptance Scenarios 3 (list contents), 6 (duplicate-run warning),
 * 16 (source !== target validation) and 17 (list scoping).
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CourseSummary } from '@classroom-copier/shared'
import { SelectionScreen } from './SelectionScreen'
import { DUPLICATE_RUN_NOTICE } from '../../components/shared'
import * as api from '../../lib/api-client'

vi.mock('../../lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api-client')>(
    '../../lib/api-client',
  )
  return { ...actual, listCourses: vi.fn() }
})

const ACTIVE: CourseSummary = {
  id: 'c-active',
  name: 'US History (2025)',
  section: 'Period 3',
  state: 'ACTIVE',
  isSisShell: false,
  postCount: 42,
}
const ARCHIVED: CourseSummary = {
  id: 'c-archived',
  name: 'US History (2024)',
  section: 'Period 1',
  state: 'ARCHIVED',
  isSisShell: false,
  postCount: 31,
}
const SIS_SHELL: CourseSummary = {
  id: 'c-sis',
  name: 'US History — Period 3',
  section: null,
  state: 'ACTIVE',
  isSisShell: true,
  postCount: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.listCourses).mockImplementation(async (role) =>
    role === 'source' ? { courses: [ACTIVE, ARCHIVED] } : { courses: [ACTIVE, SIS_SHELL] },
  )
})

async function renderScreen(onContinue = vi.fn()) {
  render(<SelectionScreen onContinue={onContinue} />)
  const source = await screen.findByLabelText('Copy from (source)')
  const target = await screen.findByLabelText('Copy to (target)')
  return { source: source as HTMLSelectElement, target: target as HTMLSelectElement, onContinue }
}

describe('Source & Target Selection', () => {
  it('lists both active and archived courses as sources, with badge and post count (Scenario 17)', async () => {
    const { source } = await renderScreen()
    const options = within(source).getAllByRole('option').map((o) => o.textContent)
    expect(options.join('\n')).toContain('US History (2025) — Period 3 · Active · 42 posts')
    expect(options.join('\n')).toContain('US History (2024) — Period 1 · Archived · 31 posts')
  })

  it('never lists an archived course as a target (Scenario 17)', async () => {
    const { target } = await renderScreen()
    const options = within(target).getAllByRole('option').map((o) => o.textContent ?? '')
    expect(options.join('\n')).not.toContain('Archived')
    expect(options.some((o) => o.includes('US History (2024)'))).toBe(false)
  })

  it('badges an SIS roster shell in the target list', async () => {
    const { target } = await renderScreen()
    const options = within(target).getAllByRole('option').map((o) => o.textContent ?? '')
    expect(options.some((o) => o.includes('SIS Roster Shell'))).toBe(true)
  })

  it('shows the duplicate-run notice persistently, in the shared wording (Scenario 6)', async () => {
    await renderScreen()
    expect(screen.getByText(DUPLICATE_RUN_NOTICE)).toBeInTheDocument()
  })

  it('keeps Continue disabled until both courses are chosen', async () => {
    const { source } = await renderScreen()
    expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled()
    await userEvent.selectOptions(source, ACTIVE.id)
    expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled()
  })

  it('disables Continue and explains inline when source and target are the same (Scenario 16)', async () => {
    const { source, target } = await renderScreen()
    await userEvent.selectOptions(source, ACTIVE.id)
    await userEvent.selectOptions(target, ACTIVE.id)

    expect(screen.getByText('Choose two different courses.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled()
  })

  it('shows no inline error before a collision actually exists', async () => {
    const { source, target } = await renderScreen()
    await userEvent.selectOptions(source, ARCHIVED.id)
    await userEvent.selectOptions(target, SIS_SHELL.id)
    expect(screen.queryByText('Choose two different courses.')).toBeNull()
  })

  it('enables Continue for two distinct courses and reports both ids', async () => {
    const { source, target, onContinue } = await renderScreen()
    await userEvent.selectOptions(source, ARCHIVED.id)
    await userEvent.selectOptions(target, SIS_SHELL.id)

    const button = screen.getByRole('button', { name: /Continue/ })
    expect(button).toBeEnabled()
    await userEvent.click(button)
    await waitFor(() =>
      expect(onContinue).toHaveBeenCalledWith(
        expect.objectContaining({ id: ARCHIVED.id }),
        expect.objectContaining({ id: SIS_SHELL.id }),
      ),
    )
  })
})
