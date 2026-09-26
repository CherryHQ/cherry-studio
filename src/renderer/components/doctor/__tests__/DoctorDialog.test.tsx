import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useImperativeHandle } from 'react'
import type { RefObject } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DiagnosticUploadPanelHandle } from '@renderer/components/feedback/DiagnosticUploadPanel'
import type { DoctorController } from '@renderer/hooks/doctor'
import { buildDoctorViewModel } from '@renderer/utils/doctor'

vi.unmock('@cherrystudio/ui')

const mocks = vi.hoisted(() => ({
  controller: undefined as unknown as DoctorController,
  requestReportClose: vi.fn<DiagnosticUploadPanelHandle['requestClose']>()
}))

vi.mock('@renderer/hooks/doctor', () => ({
  useDoctorController: () => mocks.controller
}))

vi.mock('../DoctorChecksPanel', () => ({
  DoctorChecksPanel: () => null
}))

vi.mock('@renderer/components/feedback/DiagnosticUploadPanel', () => ({
  DiagnosticUploadPanel: ({ ref }: { ref?: RefObject<DiagnosticUploadPanelHandle | null> }) => {
    useImperativeHandle(ref, () => ({ requestClose: mocks.requestReportClose }), [])
    return <div>Report panel boundary</div>
  }
}))

vi.mock('@renderer/components/feedback/DiagnosticHistoryDialog', () => ({
  DiagnosticHistoryDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Diagnostic history" /> : null
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { DoctorDialog } from '../DoctorDialog'

type ControllerOverrides = {
  readonly canChangePanel?: boolean
  readonly isCloseBlocked?: boolean
  readonly session?: Partial<DoctorController['session']>
}

function createController(overrides: ControllerOverrides = {}) {
  const baseController = {
    appUpdateState: {
      info: null,
      checking: false,
      downloading: false,
      downloaded: false,
      downloadProgress: 0,
      available: false,
      ignore: false,
      manualCheck: false
    },
    cancel: vi.fn<DoctorController['cancel']>(),
    canChangePanel: true,
    cancelConfirmation: vi.fn<DoctorController['cancelConfirmation']>(),
    confirmCheck: vi.fn<DoctorController['confirmCheck']>(),
    confirmEvidence: vi.fn<DoctorController['confirmEvidence']>(),
    executeAction: vi.fn<DoctorController['executeAction']>(),
    isAutoRunPending: false,
    isInteracting: false,
    isCloseBlocked: false,
    openLogsPath: vi.fn<DoctorController['openLogsPath']>(),
    openPath: vi.fn<DoctorController['openPath']>(),
    requestEvidence: vi.fn<DoctorController['requestEvidence']>(),
    run: vi.fn<DoctorController['run']>(),
    session: {
      activePanel: 'report',
      descriptionDraft: '',
      fixedCheckIds: [],
      interaction: { kind: 'idle' },
      relaunchRequired: false
    },
    setDescription: vi.fn<DoctorController['setDescription']>(),
    setPanel: vi.fn<DoctorController['setPanel']>(),
    setPanelInteraction: vi.fn<DoctorController['setPanelInteraction']>(),
    toggleDevTools: vi.fn<DoctorController['toggleDevTools']>(),
    viewModel: buildDoctorViewModel({ status: 'idle' })
  } satisfies DoctorController

  return {
    ...baseController,
    ...overrides,
    session: { ...baseController.session, ...overrides.session }
  } satisfies DoctorController
}

describe('DoctorDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.controller = createController()
    mocks.requestReportClose.mockResolvedValue(true)
  })

  it('closes a directly opened report after the report panel accepts dismissal', async () => {
    const user = userEvent.setup()
    const resolve = vi.fn()
    render(<DoctorDialog initialPanel="report" open resolve={resolve} />)

    expect(screen.queryByRole('button', { name: 'settings.doctor.actions.back_to_checks' })).not.toBeInTheDocument()
    await screen.findByText('Report panel boundary')
    await user.click(screen.getByRole('button', { name: 'common.close' }))

    expect(mocks.requestReportClose).toHaveBeenCalledOnce()
    expect(resolve).toHaveBeenCalledWith({})
  })

  it('returns an internally opened report to checks after the report panel accepts dismissal', async () => {
    const user = userEvent.setup()
    const resolve = vi.fn()
    render(<DoctorDialog initialPanel="checks" open resolve={resolve} />)

    await screen.findByText('Report panel boundary')
    await user.click(screen.getByRole('button', { name: 'settings.doctor.actions.back_to_checks' }))

    expect(mocks.requestReportClose).toHaveBeenCalledOnce()
    expect(mocks.controller.setPanel).toHaveBeenCalledWith('checks')
    expect(resolve).not.toHaveBeenCalled()
  })

  it('opens diagnostic history from the report title', async () => {
    const user = userEvent.setup()
    render(<DoctorDialog initialPanel="report" open resolve={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'settings.about.feedback.history.title' }))

    expect(screen.getByRole('dialog', { name: 'Diagnostic history', hidden: true })).toBeInTheDocument()
  })

  it('blocks button, overlay, and Escape dismissal while an operation is active', async () => {
    const user = userEvent.setup()
    const resolve = vi.fn()
    mocks.controller = createController({ isCloseBlocked: true, canChangePanel: false })
    render(<DoctorDialog initialPanel="report" open resolve={resolve} />)

    const dialog = screen.getByRole('dialog')
    expect(screen.queryByRole('button', { name: 'common.close' })).not.toBeInTheDocument()

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(overlay).toBeInTheDocument()
    await user.click(overlay as HTMLElement)
    await user.keyboard('{Escape}')

    expect(dialog).toBeVisible()
    expect(mocks.requestReportClose).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
  })
})
