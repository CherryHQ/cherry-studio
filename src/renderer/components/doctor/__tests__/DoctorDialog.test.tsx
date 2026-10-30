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
  aiDiagnosis: undefined as unknown,
  controller: undefined as unknown as DoctorController,
  errorContext: undefined as unknown,
  requestReportClose: vi.fn<DiagnosticUploadPanelHandle['requestClose']>()
}))

vi.mock('@renderer/hooks/doctor', () => ({
  useDoctorController: () => mocks.controller
}))

vi.mock('../DoctorChecksPanel', () => ({
  DoctorChecksPanel: () => null
}))

vi.mock('@renderer/components/feedback/DiagnosticUploadPanel', () => ({
  DiagnosticUploadPanel: ({
    aiDiagnosis,
    errorContext,
    ref
  }: {
    aiDiagnosis?: unknown
    errorContext?: unknown
    ref?: RefObject<DiagnosticUploadPanelHandle | null>
  }) => {
    mocks.aiDiagnosis = aiDiagnosis
    mocks.errorContext = errorContext
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

import { cacheService } from '@data/CacheService'
import type { DiagnosticAiDiagnosis } from '@shared/types/diagnosticAi'
import type { DoctorScopeKey } from '@shared/types/doctor'
import type { DoctorAgentIncident, DoctorAgentState } from '@shared/types/doctorAgent'
import { doctorAgentKey, doctorAgentStateCacheKey, doctorStateCacheKey } from '@shared/utils/doctor'

import { MockCacheUtils } from '../../../../../tests/__mocks__/renderer/CacheService'
import { DoctorDialog } from '../DoctorDialog'

function publishDiagnosis(scope: DoctorScopeKey, text: string, incident?: DoctorAgentIncident) {
  const runId = 'report-1'
  cacheService.setShared(doctorStateCacheKey(scope), {
    status: 'completed',
    report: {
      schemaVersion: 1,
      scope,
      runId,
      tier: 'quick',
      selectedCheckIds: [],
      startedAt: '2026-05-01T00:00:00.000Z',
      finishedAt: '2026-05-01T00:00:01.000Z',
      expiresAt: '2026-05-01T00:10:01.000Z',
      basics: {
        version: '2.0.0',
        edition: 'global',
        channel: 'latest',
        platform: 'darwin',
        arch: 'arm64',
        osRelease: '25.0.0',
        runtime: {},
        isPackaged: true,
        isPortable: false
      },
      results: [],
      summary: { pass: 0, warn: 0, fail: 0, skip: 0, error: 0 }
    }
  })
  const agent: DoctorAgentState = {
    status: 'completed',
    runId: 'agent-run-1',
    scope,
    reportRunId: runId,
    sessionId: 'session-1',
    modelId: 'openai::gpt-4o',
    startedAt: '2026-05-01T00:00:02.000Z',
    text,
    toolCalls: [],
    proposals: [],
    changes: [],
    ...(incident ? { incident } : {})
  }
  cacheService.setShared(doctorAgentStateCacheKey(doctorAgentKey(scope, incident)), agent)
}

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
    actionError: null,
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
    scope: 'global',
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
    MockCacheUtils.resetMocks()
    mocks.aiDiagnosis = undefined
    mocks.controller = createController()
    mocks.errorContext = undefined
    mocks.requestReportClose.mockResolvedValue(true)
  })

  it('passes the opened error context to the report panel', async () => {
    const errorContext = {
      id: 'op-1',
      message: 'HTTP 500',
      occurredAt: '2026-01-01T00:00:00.000Z',
      operation: 'painting.generate',
      source: 'painting'
    }
    render(<DoctorDialog errorContext={errorContext} initialPanel="report" open resolve={vi.fn()} />)
    await screen.findByText('Report panel boundary')
    expect(mocks.errorContext).toEqual(errorContext)
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

  it('forwards an explicit snapshot without attaching a global cached result', async () => {
    publishDiagnosis('global', 'Global cached conclusion.')
    const snapshot: DiagnosticAiDiagnosis = {
      source: 'error-summary',
      status: 'completed',
      text: 'Explicit conclusion.'
    }
    render(<DoctorDialog aiDiagnosis={snapshot} initialPanel="report" open resolve={vi.fn()} />)

    await screen.findByText('Report panel boundary')
    expect(mocks.errorContext).toBeUndefined()
    expect(mocks.aiDiagnosis).toBe(snapshot)
  })

  it('does not attach a global cached result to a contextual report that has no snapshot', async () => {
    publishDiagnosis('global', 'Global cached conclusion.')
    const errorContext = {
      id: 'op-1',
      message: 'HTTP 500',
      occurredAt: '2026-01-01T00:00:00.000Z',
      operation: 'painting.generate',
      source: 'painting'
    }
    render(<DoctorDialog errorContext={errorContext} initialPanel="report" open resolve={vi.fn()} />)

    await screen.findByText('Report panel boundary')
    expect(mocks.errorContext).toEqual(errorContext)
    expect(mocks.aiDiagnosis).toBeUndefined()
  })

  it('carries the current global analysis into a report opened from checks', async () => {
    publishDiagnosis('global', 'Global conclusion.')
    render(<DoctorDialog initialPanel="checks" open resolve={vi.fn()} />)

    await screen.findByText('Report panel boundary')
    expect(mocks.errorContext).toBeUndefined()
    expect(mocks.aiDiagnosis).toMatchObject({
      source: 'doctor-agent',
      status: 'completed',
      scope: 'global',
      text: 'Global conclusion.'
    })
    expect(mocks.aiDiagnosis).not.toHaveProperty('errorId')
  })
})
