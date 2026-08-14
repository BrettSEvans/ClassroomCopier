/**
 * UX Acceptance Scenarios 2 (silent healthy pre-flight), 3 (type-aware skip
 * label), 4 (Scenario-3 option set), 5 (global auto-fix toggle) and 6
 * (duplicate-run warning restated verbatim). Plus D26 (empty course).
 */
import { useRef, useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreflightFinding, PreflightResponse, Resolution } from '@classroom-copier/shared'
import { ActionSheetModal } from './ActionSheetModal'
import { PreflightScreen } from './PreflightScreen'
import { ReadyToTransfer } from './ReadyToTransfer'
import { DUPLICATE_RUN_NOTICE } from '../../components/shared'
import * as api from '../../lib/api-client'

vi.mock('../../lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api-client')>(
    '../../lib/api-client',
  )
  return { ...actual, runPreflight: vi.fn() }
})

/** F2 on a Material — the fixture the "never hardcode Skip Assignment" gate needs. */
const MATERIAL_FINDING: PreflightFinding = {
  id: 'find-1',
  scanItemId: 'si-1',
  sourceType: 'courseWorkMaterial',
  sourceId: 'm-1',
  postTitle: 'Week 1 Reading',
  postTypeLabel: 'Material',
  attachmentId: 'att-1',
  attachmentName: 'Unit 1 Slides.pdf',
  issue: 'trashed',
  scenario: 2,
  options: [
    {
      kind: 'create_draft_shell_with_note',
      label: 'Create Draft Shell with Note',
      recommended: true,
      riskWarning: null,
    },
    { kind: 'skip_post', label: 'Skip Material', recommended: false, riskWarning: null },
  ],
}

/** F3 on an Assignment. */
const ASSIGNMENT_FINDING: PreflightFinding = {
  id: 'find-2',
  scanItemId: 'si-2',
  sourceType: 'courseWork',
  sourceId: 'cw-1',
  postTitle: 'Essay 1',
  postTypeLabel: 'Assignment',
  attachmentId: 'att-2',
  attachmentName: 'Rubric Template.docx',
  issue: 'permission_locked',
  scenario: 3,
  options: [
    {
      kind: 'copy_to_my_drive',
      label: 'Copy to My Drive (Become Owner)',
      recommended: true,
      riskWarning: null,
    },
    {
      kind: 'link_existing_file',
      label: 'Link Existing File (Risk Warning)',
      recommended: false,
      riskWarning: 'If the co-teacher removes access later, students lose the file.',
    },
    {
      kind: 'skip_attachment_and_note_draft',
      label: 'Skip Attachment and Note Draft',
      recommended: false,
      riskWarning: null,
    },
  ],
}

function scan(overrides: Partial<PreflightResponse> = {}): PreflightResponse {
  return {
    scanId: 'scan-1',
    sourceCourseId: 'c-source',
    targetCourseId: 'c-target',
    sourceCourseName: 'US History (2025)',
    targetCourseName: 'US History — Period 3',
    totalPostsScanned: 42,
    scannedAt: new Date().toISOString(),
    findings: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ------------------------------------------------------------------ *
 * Scanning
 * ------------------------------------------------------------------ */

describe('Pre-flight scanning (Acceptance Scenario 2)', () => {
  it('cycles the three status lines', async () => {
    vi.mocked(api.runPreflight).mockReturnValue(new Promise(() => {}))
    render(
      <PreflightScreen
        sourceId="c-source"
        targetId="c-target"
        onReady={vi.fn()}
        onCancel={vi.fn()}
        stepMs={5}
      />,
    )
    expect(screen.getByText('Checking topics…')).toBeInTheDocument()
    await screen.findByText('Verifying attachments…')
    await screen.findByText('Checking permissions…')
  })

  it('shows a brief "All clear" and auto-advances when there are no findings', async () => {
    vi.mocked(api.runPreflight).mockResolvedValue(scan())
    const onReady = vi.fn()
    render(
      <PreflightScreen
        sourceId="c-source"
        targetId="c-target"
        onReady={onReady}
        onCancel={vi.fn()}
        stepMs={5}
        allClearMs={20}
      />,
    )

    expect(await screen.findByText('All clear')).toBeInTheDocument()
    expect(onReady).not.toHaveBeenCalled()
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1))
    expect(onReady).toHaveBeenCalledWith(expect.objectContaining({ scanId: 'scan-1' }), [])
  })

  it('never opens the Action Sheet when the scan is healthy', async () => {
    vi.mocked(api.runPreflight).mockResolvedValue(scan())
    render(
      <PreflightScreen
        sourceId="c-source"
        targetId="c-target"
        onReady={vi.fn()}
        onCancel={vi.fn()}
        stepMs={5}
        allClearMs={5}
      />,
    )
    await screen.findByText('All clear')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens the Action Sheet when the scan reports findings', async () => {
    vi.mocked(api.runPreflight).mockResolvedValue(scan({ findings: [MATERIAL_FINDING] }))
    render(
      <PreflightScreen
        sourceId="c-source"
        targetId="c-target"
        onReady={vi.fn()}
        onCancel={vi.fn()}
        stepMs={5}
      />,
    )
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(
      screen.getByText('We found 1 item that needs your attention before copying.'),
    ).toBeInTheDocument()
  })
})

/* ------------------------------------------------------------------ *
 * Action Sheet Modal
 * ------------------------------------------------------------------ */

function ModalHarness({
  findings,
  onContinue = vi.fn(),
}: {
  findings: PreflightFinding[]
  onContinue?: (resolutions: Resolution[]) => void
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button type="button" ref={trigger} onClick={() => setOpen(true)}>
        Open action sheet
      </button>
      {open ? (
        <ActionSheetModal
          findings={findings}
          onContinue={(r) => {
            setOpen(false)
            onContinue(r)
          }}
          onCancel={() => setOpen(false)}
          returnFocusTo={trigger}
        />
      ) : null}
    </>
  )
}

describe('Action Sheet Modal', () => {
  it('renders the heading, the parent post title with its type, the attachment and the issue', async () => {
    render(<ActionSheetModal findings={[MATERIAL_FINDING, ASSIGNMENT_FINDING]} onContinue={vi.fn()} onCancel={vi.fn()} />)
    expect(
      screen.getByText('We found 2 items that need your attention before copying.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Attached to “Week 1 Reading” (Material)')).toBeInTheDocument()
    expect(screen.getByText('Unit 1 Slides.pdf')).toBeInTheDocument()
    expect(screen.getByText('Issue: file is trashed or deleted.')).toBeInTheDocument()
    expect(screen.getByText('Attached to “Essay 1” (Assignment)')).toBeInTheDocument()
    expect(screen.getByText('Issue: permission-locked (co-teacher owned).')).toBeInTheDocument()
  })

  it('uses the server-supplied type-aware skip label: "Skip Material", never "Skip Assignment" (Scenario 3)', () => {
    render(<ActionSheetModal findings={[MATERIAL_FINDING]} onContinue={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('radio', { name: /Skip Material/ })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Skip Assignment/ })).toBeNull()
  })

  it('renders the Scenario-3 option set with "Copy to My Drive" stamped Recommended (Scenario 4)', () => {
    render(<ActionSheetModal findings={[ASSIGNMENT_FINDING]} onContinue={vi.fn()} onCancel={vi.fn()} />)
    const recommended = screen.getByRole('radio', { name: /Copy to My Drive \(Become Owner\)/ })
    expect(recommended.closest('.option')).toHaveClass('recommended')
    expect(within(recommended.closest('.option') as HTMLElement).getByText('Recommended')).toHaveClass(
      'stamp',
    )
    expect(screen.getByRole('radio', { name: /Link Existing File/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Skip Attachment and Note Draft/ })).toBeInTheDocument()
    expect(
      screen.getByText('If the co-teacher removes access later, students lose the file.'),
    ).toBeInTheDocument()
  })

  it('defaults the global auto-fix switch to OFF with nothing selected and Continue disabled', () => {
    const { container } = render(
      <ActionSheetModal findings={[MATERIAL_FINDING, ASSIGNMENT_FINDING]} onContinue={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(screen.getByRole('switch', { name: /Apply recommended fixes automatically/ })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    screen.getAllByRole('radio').forEach((radio) => expect(radio).not.toBeChecked())
    expect(container.querySelectorAll('.option.selected')).toHaveLength(0)
    expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled()
  })

  it('selects every recommended option and enables Continue when the switch is turned on (Scenario 5)', async () => {
    const onContinue = vi.fn()
    render(
      <ActionSheetModal
        findings={[MATERIAL_FINDING, ASSIGNMENT_FINDING]}
        onContinue={onContinue}
        onCancel={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('switch', { name: /Apply recommended fixes automatically/ }))

    expect(screen.getByRole('radio', { name: /Create Draft Shell with Note/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Copy to My Drive/ })).toBeChecked()
    const continueButton = screen.getByRole('button', { name: /Continue/ })
    expect(continueButton).toBeEnabled()

    await userEvent.click(continueButton)
    expect(onContinue).toHaveBeenCalledWith([
      { kind: 'create_draft_shell_with_note', findingId: 'find-1' },
      { kind: 'copy_to_my_drive', findingId: 'find-2' },
    ])
  })

  it('keeps Continue disabled until EVERY row resolves', async () => {
    render(
      <ActionSheetModal findings={[MATERIAL_FINDING, ASSIGNMENT_FINDING]} onContinue={vi.fn()} onCancel={vi.fn()} />,
    )
    await userEvent.click(screen.getByRole('radio', { name: /Skip Material/ }))
    expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled()
    await userEvent.click(screen.getByRole('radio', { name: /Link Existing File/ }))
    expect(screen.getByRole('button', { name: /Continue/ })).toBeEnabled()
  })

  it('marks a NON-recommended choice as visibly selected, independently of the recommended tint', async () => {
    render(<ActionSheetModal findings={[ASSIGNMENT_FINDING]} onContinue={vi.fn()} onCancel={vi.fn()} />)
    const chosen = screen.getByRole('radio', { name: /Link Existing File/ })
    await userEvent.click(chosen)

    const chosenRow = chosen.closest('.option') as HTMLElement
    expect(chosenRow).toHaveClass('selected')
    expect(chosenRow).not.toHaveClass('recommended')

    // The recommended row keeps its static tint and stamp but is NOT selected.
    const recommendedRow = screen
      .getByRole('radio', { name: /Copy to My Drive/ })
      .closest('.option') as HTMLElement
    expect(recommendedRow).toHaveClass('recommended')
    expect(recommendedRow).not.toHaveClass('selected')
  })

  it('marks an accepted recommendation as both recommended and selected', async () => {
    render(<ActionSheetModal findings={[ASSIGNMENT_FINDING]} onContinue={vi.fn()} onCancel={vi.fn()} />)
    const recommended = screen.getByRole('radio', { name: /Copy to My Drive/ })
    await userEvent.click(recommended)
    const row = recommended.closest('.option') as HTMLElement
    expect(row).toHaveClass('recommended')
    expect(row).toHaveClass('selected')
  })

  it('is a focus-trapped dialog whose first focus lands on the heading', async () => {
    render(<ActionSheetModal findings={[MATERIAL_FINDING]} onContinue={vi.fn()} onCancel={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', {
          name: 'We found 1 item that needs your attention before copying.',
        }),
      ),
    )
  })

  it('closes on Escape and returns focus to the control that opened it', async () => {
    render(<ModalHarness findings={[MATERIAL_FINDING]} />)
    const trigger = screen.getByRole('button', { name: 'Open action sheet' })
    await userEvent.click(trigger)
    await screen.findByRole('dialog')

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('closes on Cancel and returns focus to the control that opened it', async () => {
    render(<ModalHarness findings={[MATERIAL_FINDING]} />)
    const trigger = screen.getByRole('button', { name: 'Open action sheet' })
    await userEvent.click(trigger)
    await userEvent.click(await screen.findByRole('button', { name: /Cancel/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('keeps Tab inside the dialog', async () => {
    render(<ActionSheetModal findings={[MATERIAL_FINDING]} onContinue={vi.fn()} onCancel={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    for (let i = 0; i < 12; i += 1) {
      await userEvent.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
  })
})

/* ------------------------------------------------------------------ *
 * Ready to Transfer
 * ------------------------------------------------------------------ */

describe('Ready to Transfer', () => {
  it('restates the counts, the reassurance line and the duplicate-run notice verbatim (Scenario 6)', () => {
    render(<ReadyToTransfer scan={scan()} onBack={vi.fn()} onStart={vi.fn()} />)
    expect(
      screen.getByText(/Ready to copy/).textContent?.replace(/\s+/g, ' '),
    ).toBe('Ready to copy 42 posts from “US History (2025)” into “US History — Period 3.”')
    expect(
      screen.getByText(
        'Everything will land as Drafts with dates cleared — nothing is visible to students until you publish it.',
      ),
    ).toHaveClass('reassure')
    expect(screen.getByText(DUPLICATE_RUN_NOTICE)).toBeInTheDocument()
  })

  it('offers Back and Start Transfer', async () => {
    const onBack = vi.fn()
    const onStart = vi.fn()
    render(<ReadyToTransfer scan={scan()} onBack={onBack} onStart={onStart} />)
    await userEvent.click(screen.getByRole('button', { name: /Back/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Start Transfer' }))
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('says WHEN the count was measured (APPLY-I)', () => {
    // The scan is a snapshot: a post added to the source after it is correctly
    // excluded from the job, and the summary then reads "N of N" about an N
    // measured earlier. Saying nothing about that, in a product whose thesis is
    // that it never lies about what happened, was the gap.
    const at = new Date('2026-08-14T09:41:00.000Z')
    render(
      <ReadyToTransfer
        scan={scan({ scannedAt: at.toISOString() })}
        onBack={vi.fn()}
        onStart={vi.fn()}
      />,
    )
    const freshness = screen.getByTestId('scan-freshness')
    expect(freshness).toHaveTextContent(/^Scanned at /)
    expect(freshness).toHaveTextContent(
      at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    )
    expect(freshness).toHaveTextContent(/scan again/)
  })

  it('renders the explicit 0-posts state rather than silently succeeding (D26)', async () => {
    const onStart = vi.fn()
    render(<ReadyToTransfer scan={scan({ totalPostsScanned: 0 })} onBack={vi.fn()} onStart={onStart} />)

    expect(screen.getByText(/0 posts to copy/)).toBeInTheDocument()
    expect(screen.queryByText(/Ready to copy 0 posts/)).toBeNull()

    const start = screen.getByRole('button', { name: 'Start Transfer' })
    expect(start).toBeEnabled()
    await userEvent.click(start)
    expect(onStart).toHaveBeenCalledTimes(1)
  })
})
