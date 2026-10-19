import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Dialog, DialogContent } from '@cherrystudio/ui'
import type * as DoctorComponents from '@renderer/components/doctor'
import type { SerializedError } from '@renderer/types/error'
import type { DiagnosisResult } from '@renderer/utils/errorDiagnosis'
import type { DoctorCheckResult, DoctorPendingCheck, DoctorState } from '@shared/types/doctor'
import { createAppErrorContext } from '@shared/utils/appError'

import type { ErrorDetailContentProps } from '../ErrorDetailModal'

vi.unmock('@cherrystudio/ui')
vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())

const aiDiagnosis: DiagnosisResult = {
  category: 'runtime',
  explanation: 'Check the provider configuration',
  steps: [],
  summary: 'Provider failed'
}

const providerError = {
  name: 'ProviderError',
  message: 'failed',
  stack: 'private stack',
  statusCode: 503
} satisfies SerializedError

const passingVersionResult: DoctorCheckResult = {
  id: 'install-version-channel',
  status: 'pass',
  durationMs: 1
}

const lowDiskResult: DoctorCheckResult = {
  id: 'storage-disk-space',
  status: 'warn',
  durationMs: 1,
  attribution: 'user-fixable',
  detail: { variant: 'low' },
  evidence: [{ key: 'path', value: '/Users/local/CherryStudio', dataClass: 'local_only' }],
  actions: []
}

const invalidBootConfigResult: DoctorCheckResult = {
  id: 'config-boot-config-valid',
  status: 'fail',
  durationMs: 1,
  attribution: 'user-fixable',
  detail: { variant: 'invalid_keys' },
  actions: [{ kind: 'fix', fixId: 'repair' }]
}

const appBugResult: DoctorCheckResult = {
  id: 'logs-recent-findings',
  status: 'warn',
  durationMs: 1,
  attribution: 'app-bug',
  detail: { variant: 'findings' },
  actions: [{ kind: 'report' }]
}

const transientResult: DoctorCheckResult = {
  id: 'network-online',
  status: 'warn',
  durationMs: 1,
  attribution: 'transient',
  detail: { variant: 'offline' },
  actions: []
}

const erroredResult: DoctorCheckResult = {
  id: 'install-native-modules',
  status: 'error',
  durationMs: 1,
  message: 'Native module check failed'
}

const skippedResult: DoctorCheckResult = {
  id: 'provider-api-key-present',
  status: 'skip',
  durationMs: 1,
  skippedBy: 'provider-model'
}

const chatSubject = { kind: 'chat' as const, providerId: 'deepseek', modelId: 'deepseek-v4-flash' }

const mocks = vi.hoisted(() => ({
  cacheReady: true,
  diagnoseError: vi.fn(),
  doctorState: { status: 'idle' } as DoctorState,
  openSettingsTab: vi.fn(),
  request: vi.fn(),
  showDoctor: vi.fn()
}))

const translations: Record<string, string> = {
  'common.close': 'Close',
  'common.copy': 'Copy',
  'common.cancel': 'Cancel',
  'common.none': 'None',
  'common.retry': 'Retry',
  'error.context.operation': 'Operation',
  'error.context.source': 'Source',
  'error.detail': 'Error Details',
  'error.responseBody': 'Response body',
  'error.diagnosis.view_details': 'View Details',
  'error.diagnostic_report.action': 'Report a problem',
  'error.diagnostic_report.location': 'Location',
  'error.diagnostic_report.locations.home': 'Home conversation',
  'error.diagnostic_report.locations.work': 'Work conversation',
  'error.diagnostics.action_required': 'Action required',
  'error.diagnostics.action_required_tag': 'Needs action',
  'error.diagnostics.back_to_overview': 'Back to diagnostic overview',
  'error.diagnostics.basic_information': 'Basic information',
  'error.diagnostics.checking_progress': 'Checking: {{check}} · {{completed}}/{{total}}',
  'error.diagnostics.diagnosing': 'Diagnosing',
  'error.diagnostics.preparing_result': 'Preparing results…',
  'error.diagnostics.result': 'Diagnostic result',
  'error.diagnostics.result_summary':
    '<fixed>Fixed: {{fixed}}; </fixed><attention>needs attention: {{attention}}</attention>.',
  'error.message': 'Error message',
  'error.modelId': 'Model',
  'error.name': 'Error name',
  'error.provider': 'Provider',
  'error.stack': 'Stack',
  'error.statusCode': 'Status code',
  'message.copied': 'Copied',
  'message.tools.units.item_one': '{{count}} item',
  'message.tools.units.item_other': '{{count}} items',
  'provider.deepseek': 'DeepSeek',
  'settings.doctor.actions.cancel_run': 'Cancel checks',
  'settings.doctor.actions.confirm_check': 'Send test message',
  'settings.doctor.actions.open_provider': 'Open provider settings',
  'settings.doctor.actions.run_network': 'Full check',
  'settings.doctor.actions.run_basic': 'Quick basic checks',
  'settings.doctor.actions.rerun': 'Run checks again',
  'settings.doctor.checks.config-boot-config-valid.detail.invalid_keys':
    'Some startup settings are not recognized or valid.',
  'settings.doctor.checks.config-boot-config-valid.title': 'Startup configuration',
  'settings.doctor.checks.install-native-modules.title': 'Native components',
  'settings.doctor.checks.logs-recent-findings.title': 'Recent findings',
  'settings.doctor.checks.network-online.title': 'Network availability',
  'settings.doctor.checks.network-model-endpoint.detail.unreachable': 'The configured Base URL could not be reached.',
  'settings.doctor.checks.network-model-endpoint.title': 'Selected model endpoint',
  'settings.doctor.checks.provider-api-key-present.detail.missing': '{{provider}} has no enabled API key.',
  'settings.doctor.checks.provider-api-key-present.title': 'Provider API key',
  'settings.doctor.checks.provider-model-conversation.confirmation':
    'Send one short test message to {{model}} ({{modelId}}) at {{endpoint}}?',
  'settings.doctor.checks.provider-model-conversation.title': 'Model conversation',
  'settings.doctor.checks.provider-model-list.detail.request_failed':
    '{{category}}. The remote model list could not be retrieved.',
  'settings.doctor.checks.provider-model-list.title': 'Remote model availability',
  'settings.doctor.checks.storage-disk-space.detail.low': 'Available disk space is low.',
  'settings.doctor.checks.storage-disk-space.title': 'Available disk space',
  'settings.doctor.checks.install-version-channel.title': 'Version and release channel',
  'settings.doctor.checks.pending': 'Awaiting check',
  'settings.doctor.checks.skipped': 'Skipped because {{check}} did not pass.',
  'settings.doctor.empty.description': 'Run basic checks, or a full check that includes network and service checks.',
  'settings.doctor.empty.title': 'No diagnostic result yet',
  'settings.doctor.error_category.auth': 'Not signed in or the API key is invalid',
  'settings.doctor.evidence.local_details': 'Local details',
  'settings.doctor.evidence.local_only': 'Local only',
  'settings.doctor.fixes.repair_boot_config': 'Repair startup configuration',
  'settings.doctor.messages.relaunch_required': 'Restart Cherry Studio to apply the repair.',
  'settings.doctor.status.fail': 'Failed',
  'settings.doctor.status.pass': 'Passed',
  'settings.doctor.status.pending': 'Pending',
  'settings.doctor.status.skip': 'Skipped',
  'settings.doctor.status.warn': 'Warning',
  'chat.artifacts.preview.openExternal.error.content': 'Error opening the external browser.',
  'settings.about.checkUpdate.label': 'Check Update',
  'settings.about.releases.button': 'Releases',
  'settings.about.updateError': 'Update error',
  'settings.about.updateNotAvailable': 'You are using the latest version',
  'settings.about.updateNotPublished': 'No published update is available yet. Please try again later.',
  'settings.doctor.summary.progress': '{{completed}} of {{total}} completed',
  'settings.doctor.stale.description': 'This diagnostic result is out of date.',
  'settings.doctor.title': 'System diagnostics'
}

await i18next.use(initReactI18next).init({
  lng: 'en-US',
  resources: { 'en-US': { translation: translations } },
  interpolation: { escapeValue: false },
  keySeparator: false
})

vi.mock('@data/CacheService', async () => {
  const { mockCacheService } = await import('../../../../../tests/__mocks__/renderer/CacheService')
  return {
    cacheService: {
      ...mockCacheService,
      isSharedCacheReady: () => mocks.cacheReady,
      onSharedCacheReady: vi.fn()
    }
  }
})

vi.mock('@data/hooks/useCache', () => ({
  useSharedCacheValue: () => mocks.doctorState
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: vi.fn(), warn: vi.fn() }) }
}))

vi.mock('@renderer/hooks/useAppUpdateState', () => ({
  useAppUpdateState: () => ({
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
    updateAppUpdateState: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useMcpServer', () => ({ useMcpServers: () => ({ mcpServers: [] }) }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: (...args: unknown[]) => mocks.request(...args) } }))
vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: { withContext: () => ({ error: vi.fn(), warn: vi.fn() }) }
}))
vi.mock('@renderer/services/mainWindowNavigation', () => ({
  openSettingsTab: (...args: unknown[]) => mocks.openSettingsTab(...args)
}))
vi.mock('@renderer/services/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
  toastInlineError: () => undefined
}))
vi.mock('@renderer/utils/errorDiagnosis', () => ({ diagnoseError: mocks.diagnoseError }))

vi.mock('@renderer/i18n/resolver', () => ({ default: { t: (key: string) => translations[key] ?? key } }))

vi.mock('@renderer/components/doctor', async (importOriginal) => ({
  ...(await importOriginal<typeof DoctorComponents>()),
  DoctorPopup: { show: (...args: unknown[]) => mocks.showDoctor(...args) }
}))
vi.mock('@renderer/components/CodeViewer', () => ({
  default: ({ value }: { value: string }) => <pre>{value}</pre>
}))

import { cacheService } from '@data/CacheService'
import { PopupHost } from '@renderer/components/PopupHost'
import { OFFICIAL_RELEASES_URL, appUpdateCheckService } from '@renderer/services/AppUpdateCheckService'
import { POPUP_EXIT_MS, popupService } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { DiagnosticAiDiagnosis } from '@shared/types/diagnosticAi'
import type { DoctorScopeKey } from '@shared/types/doctor'
import type { DoctorAgentIncident, DoctorAgentState } from '@shared/types/doctorAgent'
import { doctorAgentKey, doctorAgentStateCacheKey, doctorStateCacheKey } from '@shared/utils/doctor'

import { MockCacheUtils } from '../../../../../tests/__mocks__/renderer/CacheService'

const { ErrorDetailContent, showErrorDetailPopup } = await import('../ErrorDetailModal')

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

Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })

function renderErrorDetailContent(props: ErrorDetailContentProps) {
  return render(
    <Dialog open>
      <DialogContent>
        <ErrorDetailContent subject={{ kind: 'global' }} {...props} />
      </DialogContent>
    </Dialog>
  )
}

function runningDoctorState(
  tier: 'quick' | 'live',
  activeCheckIds: Extract<DoctorState, { status: 'running' }>['activeCheckIds'] = [],
  selectedCheckIds: Extract<DoctorState, { status: 'running' }>['selectedCheckIds'] = activeCheckIds
): Extract<DoctorState, { status: 'running' }> {
  return {
    status: 'running',
    runId: `running-${tier}`,
    tier,
    selectedCheckIds,
    startedAt: new Date().toISOString(),
    activeCheckIds,
    results: []
  }
}

function completedDoctorState(
  results: readonly DoctorCheckResult[] = [],
  expiresAt = new Date(Date.now() + 60_000).toISOString(),
  pendingChecks?: readonly DoctorPendingCheck[]
): DoctorState {
  const now = Date.now()
  return {
    status: 'completed',
    report: {
      schemaVersion: 1,
      scope: 'global',
      runId: 'completed-quick',
      tier: 'quick',
      selectedCheckIds: results.map((result) => result.id),
      startedAt: new Date(now - 1_000).toISOString(),
      finishedAt: new Date(now).toISOString(),
      expiresAt,
      basics: {
        version: '2.0.0',
        edition: 'global',
        channel: 'latest',
        platform: 'darwin',
        arch: 'arm64',
        osRelease: '25.0.0',
        runtime: {},
        isPackaged: true,
        isPortable: false,
        userDataPath: '/Users/local/CherryStudio'
      },
      results,
      ...(pendingChecks ? { pendingChecks } : {}),
      summary: { pass: 0, warn: 0, fail: 0, skip: 0, error: 0 }
    }
  }
}

describe('ErrorDetailContent diagnostics', () => {
  it('keeps an unknown diagnostic target separate from an existing global report', () => {
    mocks.doctorState = completedDoctorState([lowDiskResult])
    renderErrorDetailContent({ subject: undefined, error: providerError })
    expect(screen.queryByRole('region', { name: 'Diagnostic result' })).not.toBeInTheDocument()
    expect(screen.getByText('error.diagnostics.context_unavailable')).toBeVisible()
    expect(screen.getByRole('button', { name: 'View Details' })).toBeEnabled()
    expect(mocks.request).not.toHaveBeenCalled()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    appUpdateCheckService.resetAppUpdateCheckForTests()
    MockCacheUtils.resetMocks()
    mocks.cacheReady = true
    mocks.doctorState = { status: 'idle' }
    mocks.diagnoseError.mockResolvedValue(aiDiagnosis)
    mocks.request.mockResolvedValue({ status: 'completed' })
  })

  afterEach(async () => {
    cleanup()
    vi.useFakeTimers()
    await act(async () => {
      for (const entry of [...popupService.getSnapshot()]) {
        popupService.settle(entry.instanceId, undefined)
      }
      vi.advanceTimersByTime(POPUP_EXIT_MS)
    })
    vi.useRealTimers()
  })

  it.each(['Copy', 'View Details'])('shows the %s action label in a tooltip', async (label) => {
    renderErrorDetailContent({ error: providerError })

    const button = screen.getByRole('button', { name: label })
    const trigger = button.closest('[data-slot="tooltip-trigger"]')
    fireEvent.pointerMove(trigger as HTMLElement, { pointerType: 'mouse' })
    expect(await screen.findByRole('tooltip', { name: label })).toHaveTextContent(label)
  })

  it('shows compact basic information and copies the unchanged error text', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()

    renderErrorDetailContent({
      diagnosisContext: { errorSource: 'chat', providerId: 'OpenAI', modelId: 'gpt-5' },
      diagnosticReport: { location: 'Home conversation' },
      localizedErrorMessage: 'API Key is invalid, please check and reconfigure',
      error: providerError
    })

    const basicInformation = screen.getByRole('region', { name: 'Home conversation' })
    expect(basicInformation).toBeInTheDocument()
    expect(basicInformation).toHaveAttribute('data-variant', 'sectioned')
    expect(screen.getByText('OpenAI:gpt-5')).toBeInTheDocument()
    expect(screen.getByText('API Key is invalid, please check and reconfigure (failed)')).toBeInTheDocument()
    expect(within(basicInformation).getByRole('heading', { name: 'Home conversation' })).toBeInTheDocument()
    expect(screen.queryByText('OpenAI')).not.toBeInTheDocument()
    expect(screen.queryByText('gpt-5')).not.toBeInTheDocument()
    expect(screen.queryByText('503')).not.toBeInTheDocument()
    expect(screen.queryByText('private stack')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Report a problem' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith(
      ['Error name: ProviderError', 'Error message: failed', 'Stack: private stack'].join('\n')
    )
  })

  it('titles Agent basic information as a work conversation', () => {
    renderErrorDetailContent({
      diagnosticReport: { location: 'agent' },
      error: providerError
    })

    expect(screen.getByRole('region', { name: 'Work conversation' })).toBeInTheDocument()
  })

  it('returns from nested error details through the localized header action without unmounting diagnostics', async () => {
    const user = userEvent.setup()
    mocks.doctorState = runningDoctorState('quick')
    const view = render(<PopupHost />)

    act(() => {
      void showErrorDetailPopup({ subject: { kind: 'global' }, error: providerError })
    })

    const outerDialog = screen.getByText('Basic information').closest('[role="dialog"]')
    const viewDetails = screen.getByRole('button', { name: 'View Details' })
    await user.click(viewDetails)

    expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(2)
    expect(outerDialog).toBeInTheDocument()
    expect(within(outerDialog as HTMLElement).getByText('Basic information')).toBeInTheDocument()
    const detailDialog = screen.getByText('private stack').closest('[role="dialog"]')
    expect(detailDialog).not.toBe(outerDialog)
    const detailHeader = detailDialog?.querySelector('[data-slot="dialog-header"]')
    expect(detailHeader).toBeInTheDocument()
    const backToOverview = within(detailHeader as HTMLElement).getByRole('button', {
      name: 'Back to diagnostic overview'
    })
    expect(within(detailHeader as HTMLElement).getByRole('heading', { name: 'Error Details' })).toBeInTheDocument()

    mocks.doctorState = completedDoctorState([passingVersionResult])
    view.rerender(<PopupHost />)
    await user.click(backToOverview)

    expect(screen.queryByText('private stack')).not.toBeInTheDocument()
    expect(outerDialog).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Diagnostic result' })).toBeInTheDocument()
    await waitFor(() => expect(viewDetails).toHaveFocus())
    expect(mocks.diagnoseError).not.toHaveBeenCalled()
    expect(mocks.request).not.toHaveBeenCalledWith('diagnostics.doctor.cancel', expect.anything())
  })

  it('keeps error details open until an in-progress Doctor repair reports its result', async () => {
    let resolveFix!: (result: { status: 'requires_relaunch' }) => void
    mocks.cacheReady = false
    mocks.doctorState = completedDoctorState([invalidBootConfigResult])
    mocks.request.mockImplementation((route: string) => {
      if (route === 'diagnostics.doctor.fix') {
        return new Promise((resolve) => {
          resolveFix = resolve
        })
      }
      return Promise.resolve({ status: 'completed' })
    })
    const user = userEvent.setup()
    render(<PopupHost />)

    act(() => {
      void showErrorDetailPopup({
        subject: { kind: 'global' },
        diagnosticReport: { location: 'Agent conversation' },
        error: providerError
      })
    })

    await screen.findByRole('region', { name: 'Diagnostic result' })
    await user.click(screen.getByRole('button', { name: /Startup configuration/ }))
    const repair = screen.getByRole('button', { name: 'Repair startup configuration' })
    await waitFor(() => expect(repair).toBeEnabled())
    expect(repair).toHaveAttribute('data-variant', 'outline')
    await user.click(repair)

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument())
    const reportProblem = screen.getByRole('button', { name: 'Report a problem' })
    expect(reportProblem).toBeDisabled()
    await user.click(reportProblem)
    expect(popupService.getSnapshot()[0]?.open).toBe(true)
    expect(mocks.showDoctor).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(popupService.getSnapshot()[0]?.open).toBe(true)
    const overlay = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')
    expect(overlay).not.toBeNull()
    fireEvent.click(overlay as HTMLElement)
    expect(popupService.getSnapshot()[0]?.open).toBe(true)

    await act(async () => resolveFix({ status: 'requires_relaunch' }))

    expect(await screen.findByText('Restart Cherry Studio to apply the repair.')).toBeInTheDocument()
    const result = screen.getByRole('region', { name: 'Diagnostic result' })
    expect(result).toHaveTextContent('Fixed: Startup configuration; needs attention: 1 item.')
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('copies the unchanged error text from the nested error details', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    render(<PopupHost />)

    act(() => {
      void showErrorDetailPopup({ subject: { kind: 'global' }, error: providerError })
    })

    await user.click(screen.getByRole('button', { name: 'View Details' }))
    const detailDialog = screen.getByText('private stack').closest('[role="dialog"]')
    await user.click(within(detailDialog as HTMLElement).getByRole('button', { name: 'Copy' }))

    expect(writeText).toHaveBeenCalledWith(
      ['Error name: ProviderError', 'Error message: failed', 'Stack: private stack'].join('\n')
    )
  })

  it('shows a non-JSON error cause as text instead of parsing it as HTML', async () => {
    const user = userEvent.setup()
    const htmlCause = '<img src="x" onerror="alert(1)">'
    render(<PopupHost />)

    act(() => {
      void showErrorDetailPopup({
        subject: { kind: 'global' },
        error: { ...providerError, name: 'AI_InvalidArgumentError', cause: htmlCause }
      })
    })

    await user.click(screen.getByRole('button', { name: 'View Details' }))

    const causeText = await screen.findByText(htmlCause)
    expect(causeText.closest('[role="dialog"]')?.querySelector('img')).toBeNull()
  })

  it('shows only Doctor results and hides the empty fixed summary', () => {
    mocks.cacheReady = false
    mocks.doctorState = completedDoctorState([passingVersionResult])

    renderErrorDetailContent({ error: providerError })

    const result = screen.getByRole('region', { name: 'Diagnostic result' })
    const summary = within(result).getByText('needs attention: 0 items').closest('p')
    if (!summary) throw new Error('Expected a single diagnostic result paragraph')
    const attention = within(result).getByText('needs attention: 0 items')
    expect(summary).toHaveTextContent('needs attention: 0 items.')
    expect(summary.tagName).toBe('P')
    expect(result.querySelectorAll('p')).toHaveLength(1)
    expect(result).not.toHaveTextContent('Fixed: None')
    expect(attention).toHaveClass('text-warning')
    expect(result).toHaveAttribute('data-variant', 'sectioned')
    expect(result).not.toHaveTextContent(aiDiagnosis.summary)
    expect(screen.queryByText(/AI summary/i)).not.toBeInTheDocument()
    expect(screen.queryByText('AI unavailable')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(mocks.diagnoseError).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'Action required' })).not.toBeInTheDocument()
  })

  it('shows the Doctor result after an automatic Doctor run fails', async () => {
    let rejectRun!: (error: Error) => void
    const user = userEvent.setup()
    mocks.request.mockImplementation((route: string) => {
      if (route === 'diagnostics.doctor.run') {
        return new Promise((_, reject) => {
          rejectRun = reject
        })
      }
      return Promise.resolve({ status: 'completed' })
    })

    renderErrorDetailContent({ error: providerError })

    expect(screen.getByRole('region', { name: 'Diagnosing' })).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Diagnostic result' })).not.toBeInTheDocument()

    await act(async () => rejectRun(new Error('Doctor unavailable')))

    expect(await screen.findByRole('region', { name: 'Diagnostic result' })).toHaveTextContent(
      'needs attention: 0 items.'
    )
    const quickRetry = screen.getByRole('button', { name: 'Quick basic checks' })
    expect(quickRetry).toBeEnabled()
    await user.click(quickRetry)
    await waitFor(() =>
      expect(mocks.request.mock.calls.filter(([route]) => route === 'diagnostics.doctor.run')).toHaveLength(2)
    )
    expect(mocks.request).toHaveBeenLastCalledWith('diagnostics.doctor.run', {
      subject: { kind: 'global' },
      tier: 'quick'
    })
    expect(mocks.diagnoseError).not.toHaveBeenCalled()
  })

  it('shows only user-fixable rows in Diagnostic result without local diagnostic dumps', async () => {
    const user = userEvent.setup()
    mocks.doctorState = completedDoctorState([
      passingVersionResult,
      lowDiskResult,
      invalidBootConfigResult,
      appBugResult,
      transientResult,
      erroredResult,
      skippedResult
    ])

    renderErrorDetailContent({ error: providerError })

    const result = screen.getByRole('region', { name: 'Diagnostic result' })
    const accordion = result.querySelector('[data-slot="accordion"]')
    expect(result).toHaveAttribute('data-variant', 'sectioned')
    expect(accordion).not.toHaveClass('rounded-lg', 'border', 'bg-background')
    expect(within(result).getByText('Available disk space')).toHaveClass('text-xs')
    expect(result).toHaveTextContent('needs attention: 2 items')
    const lowDisk = within(result).getByRole('button', { name: /Available disk space/ })
    expect(within(lowDisk).getByText('Needs action')).toHaveClass('text-warning')
    expect(within(lowDisk).queryByText('Warning')).not.toBeInTheDocument()
    expect(within(result).getByRole('button', { name: /Startup configuration/ })).toHaveTextContent('Needs action')
    expect(within(result).getByRole('button', { name: /Startup configuration/ })).not.toHaveTextContent('Failed')
    await user.click(lowDisk)
    expect(within(result).queryByRole('button', { name: 'Local details' })).not.toBeInTheDocument()
    expect(within(result).queryByText('/Users/local/CherryStudio')).not.toBeInTheDocument()
    expect(within(result).getByRole('button', { name: /Startup configuration/ })).toBeInTheDocument()
    expect(within(result).queryByRole('button', { name: /Version and release channel/ })).not.toBeInTheDocument()
    expect(within(result).queryByRole('button', { name: /Recent findings/ })).not.toBeInTheDocument()
    expect(within(result).queryByRole('button', { name: /Network availability/ })).not.toBeInTheDocument()
    expect(within(result).queryByRole('button', { name: /Native components/ })).not.toBeInTheDocument()
    expect(within(result).queryByRole('button', { name: /Provider API key/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Action required' })).not.toBeInTheDocument()
  })

  it('shows one progress line and no Action required panel while Doctor is running', () => {
    mocks.doctorState = {
      ...runningDoctorState('quick', ['config-boot-config-valid', 'storage-disk-space']),
      results: [lowDiskResult]
    }

    renderErrorDetailContent({ error: providerError })

    const diagnosing = screen.getByRole('region', { name: 'Diagnosing' })
    expect(within(diagnosing).getAllByRole('status')).toHaveLength(1)
    expect(within(diagnosing).getByText(/^Checking: Startup configuration/)).toBeVisible()
    expect(within(diagnosing).queryByText(/Available disk space/)).not.toBeInTheDocument()
    expect(within(diagnosing).queryByText('Needs attention')).not.toBeInTheDocument()
    expect(within(diagnosing).getByRole('button', { name: 'Cancel checks' })).toBeEnabled()
    expect(screen.queryByRole('region', { name: 'Action required' })).not.toBeInTheDocument()
    expect(mocks.diagnoseError).not.toHaveBeenCalled()
  })

  it('orders Doctor results and basic information', () => {
    mocks.doctorState = completedDoctorState([lowDiskResult])

    renderErrorDetailContent({ error: providerError })

    const result = screen.getByRole('region', { name: 'Diagnostic result' })
    const basicInformation = screen.getByRole('region', { name: 'Basic information' })
    const panels = screen.getAllByRole('region').filter((panel) => [result, basicInformation].includes(panel))

    expect(panels).toEqual([result, basicInformation])
    expect(result).toHaveTextContent('needs attention: 1 item')
    expect(within(result).getByRole('button', { name: /Available disk space/ })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Action required' })).not.toBeInTheDocument()
    expect(mocks.diagnoseError).not.toHaveBeenCalled()
  })

  it('refreshes conversation diagnostics from the header', async () => {
    const user = userEvent.setup()
    renderErrorDetailContent({ subject: chatSubject, error: providerError })

    const result = await screen.findByRole('region', { name: 'Diagnostic result' })
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('diagnostics.doctor.run_contextual', { subject: chatSubject })
    )
    expect(within(result).getByText('Selected model endpoint')).toBeVisible()
    expect(within(result).getByText('Remote model availability')).toBeVisible()
    expect(within(result).getByText('Model conversation')).toBeVisible()
    mocks.request.mockClear()
    await user.click(within(result).getByRole('button', { name: 'Full check' }))
    expect(mocks.request).toHaveBeenCalledWith('diagnostics.doctor.run_contextual', { subject: chatSubject })
    expect(mocks.request.mock.calls.filter(([route]) => route === 'diagnostics.doctor.run_contextual')).toHaveLength(1)
  })

  it('offers a basic rerun directly from an expired-result warning', async () => {
    const user = userEvent.setup()
    mocks.doctorState = completedDoctorState([], new Date(Date.now() - 1).toISOString())
    renderErrorDetailContent({ error: providerError })

    await screen.findByText('This diagnostic result is out of date.')
    const staleAlert = screen
      .getAllByRole('status')
      .find((alert) => within(alert).queryByText('This diagnostic result is out of date.'))
    expect(staleAlert).toBeDefined()
    const rerun = within(staleAlert as HTMLElement).getByRole('button', { name: 'Quick basic checks' })
    expect(mocks.request).not.toHaveBeenCalledWith('diagnostics.doctor.run', expect.anything())

    await user.click(rerun)

    expect(mocks.request).toHaveBeenCalledWith('diagnostics.doctor.run', { subject: { kind: 'global' }, tier: 'quick' })
    expect(mocks.request.mock.calls.filter(([route]) => route === 'diagnostics.doctor.run')).toHaveLength(1)
  })

  it('offers a quick retry when embedded checks are canceled without a report', async () => {
    const user = userEvent.setup()
    mocks.doctorState = { status: 'canceled', runId: 'canceled-quick', selectedCheckIds: [] }
    renderErrorDetailContent({ error: providerError })

    const retry = await screen.findByRole('button', { name: 'Run checks again' })
    expect(mocks.request.mock.calls.filter(([route]) => route === 'diagnostics.doctor.run')).toHaveLength(0)

    await user.click(retry)

    expect(mocks.request).toHaveBeenCalledWith('diagnostics.doctor.run', { subject: { kind: 'global' }, tier: 'quick' })
    expect(mocks.request.mock.calls.filter(([route]) => route === 'diagnostics.doctor.run')).toHaveLength(1)
  })

  it('offers an in-place retry when the initial Doctor request fails', async () => {
    const user = userEvent.setup()
    mocks.request.mockRejectedValueOnce(new Error('Doctor unavailable')).mockResolvedValueOnce({ status: 'completed' })
    renderErrorDetailContent({ error: providerError })

    const retry = await screen.findByRole('button', { name: 'Quick basic checks' })
    await waitFor(() => expect(retry).toBeEnabled())

    await user.click(retry)

    expect(mocks.request.mock.calls.filter(([route]) => route === 'diagnostics.doctor.run')).toHaveLength(2)
  })

  it('starts Doctor automatically exactly once without starting AI diagnosis', async () => {
    const view = renderErrorDetailContent({ error: providerError })

    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('diagnostics.doctor.run', {
        subject: { kind: 'global' },
        tier: 'quick'
      })
    )

    view.rerender(
      <Dialog open>
        <DialogContent>
          <ErrorDetailContent subject={{ kind: 'global' }} error={providerError} />
        </DialogContent>
      </Dialog>
    )
    await waitFor(() =>
      expect(mocks.request.mock.calls.filter(([route]) => route === 'diagnostics.doctor.run')).toHaveLength(1)
    )
    expect(mocks.diagnoseError).not.toHaveBeenCalled()
  })

  it.each(['quick', 'live'] as const)('cancels an active %s run from the diagnostics header', async (tier) => {
    const user = userEvent.setup()
    mocks.doctorState = runningDoctorState(tier)
    renderErrorDetailContent({ error: providerError })

    await user.click(screen.getByRole('button', { name: 'Cancel checks' }))

    expect(mocks.request).toHaveBeenCalledWith('diagnostics.doctor.cancel', {
      scope: 'global',
      runId: `running-${tier}`
    })
  })

  it('shows only problem reporting in the footer and excludes diagnostic results from its prefill', async () => {
    const user = userEvent.setup()
    const onOpenDiagnosticReport = vi.fn()
    mocks.doctorState = completedDoctorState([
      {
        id: 'logs-recent-findings',
        status: 'warn',
        durationMs: 1,
        attribution: 'app-bug',
        detail: { variant: 'findings' },
        evidence: [{ key: 'request-body', value: 'private Doctor evidence', dataClass: 'consent_required' }],
        actions: [{ kind: 'report' }]
      }
    ])
    renderErrorDetailContent({
      diagnosticReport: { location: 'Agent conversation' },
      error: providerError,
      onOpenDiagnosticReport
    })

    expect(screen.getByRole('region', { name: 'Diagnostic result' })).toBeInTheDocument()
    const reportProblem = screen.getByRole('button', { name: 'Report a problem' })
    expect(screen.queryByRole('group', { name: 'Error Details' })).not.toBeInTheDocument()
    await user.click(reportProblem)

    const description = onOpenDiagnosticReport.mock.calls[0][0]
    expect(description).toContain('Error message: ProviderError: failed')
    expect(description).toContain('Location: Agent conversation')
    expect(description).not.toContain('private Doctor evidence')
    expect(description).not.toContain('private stack')
    expect(mocks.diagnoseError).not.toHaveBeenCalled()
  })

  it('waits for error details to finish closing before opening report review', async () => {
    vi.useFakeTimers()
    render(<PopupHost />)

    act(() => {
      void showErrorDetailPopup({
        subject: { kind: 'global' },
        diagnosticReport: { location: 'Home conversation' },
        error: providerError
      })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Report a problem' }))
    await act(async () => {})

    expect(mocks.showDoctor).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(POPUP_EXIT_MS - 1)
    })
    expect(mocks.showDoctor).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    await act(async () => {})
    expect(mocks.showDoctor).toHaveBeenCalledWith({
      initialPanel: 'report',
      initialDescription: expect.stringContaining('Location: Home conversation')
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not reserve the detail when no popup host is mounted', () => {
    expect(showErrorDetailPopup({ subject: { kind: 'global' }, error: providerError })).toBeNull()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    render(<PopupHost />)
    act(() => {
      void showErrorDetailPopup({
        error: providerError,
        localizedErrorMessage: 'Host is ready',
        subject: { kind: 'global' }
      })
    })
    expect(screen.getByText(/Host is ready/)).toBeInTheDocument()
  })

  it('does not replace an error detail the user is already reading', () => {
    render(<PopupHost />)

    act(() => {
      void showErrorDetailPopup({
        error: providerError,
        localizedErrorMessage: 'First fault',
        subject: chatSubject
      })
    })
    expect(screen.getByText(/First fault/)).toBeInTheDocument()

    let second: Promise<void> | null = null
    act(() => {
      second = showErrorDetailPopup({
        error: providerError,
        localizedErrorMessage: 'Second fault',
        subject: { kind: 'global' }
      })
    })

    expect(second).toBeNull()
    expect(screen.getByText(/First fault/)).toBeInTheDocument()
    expect(screen.queryByText(/Second fault/)).not.toBeInTheDocument()
  })

  it('reports an operation fault with its context and without a conversation', async () => {
    vi.useFakeTimers()
    render(<PopupHost />)
    const errorContext = createAppErrorContext({
      id: 'op-1',
      message: 'HTTP 500 upstream boom',
      modelId: 'gpt-image-1',
      operation: 'painting.generate',
      providerId: 'openai',
      source: 'painting'
    })

    act(() => {
      void showErrorDetailPopup({ errorContext })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Report a problem' }))
    act(() => {
      vi.advanceTimersByTime(POPUP_EXIT_MS)
    })
    await act(async () => {})

    expect(mocks.showDoctor).toHaveBeenCalledWith({
      errorContext,
      initialDescription: expect.stringContaining('Source: painting'),
      initialPanel: 'report'
    })
    expect(mocks.showDoctor.mock.calls[0]?.[0].initialDescription).toContain('Operation: painting.generate')
    expect(mocks.showDoctor.mock.calls[0]?.[0].initialDescription).not.toContain('topicId')
  })

  it('forwards the current operation analysis and fault id when the report is opened', async () => {
    vi.useFakeTimers()
    const errorContext = createAppErrorContext({
      id: 'op-1',
      message: 'HTTP 500 upstream boom',
      operation: 'painting.generate',
      source: 'painting'
    })
    publishDiagnosis('operation:op-1', 'Operation conclusion.', { kind: 'operation', context: errorContext })
    render(<PopupHost />)

    act(() => {
      void showErrorDetailPopup({ errorContext })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Report a problem' }))
    act(() => {
      vi.advanceTimersByTime(POPUP_EXIT_MS)
    })
    await act(async () => {})

    const handoff = mocks.showDoctor.mock.calls[0]?.[0] as {
      aiDiagnosis?: DiagnosticAiDiagnosis
      errorContext?: { id: string }
    }
    expect(handoff.errorContext?.id).toBe(errorContext.id)
    expect(handoff.aiDiagnosis).toMatchObject({
      source: 'doctor-agent',
      status: 'completed',
      errorId: errorContext.id,
      text: 'Operation conclusion.'
    })
    expect(handoff.aiDiagnosis).not.toHaveProperty('topicId')
    expect(handoff.aiDiagnosis).not.toHaveProperty('messageId')
  })

  it('forwards an explicit snapshot when the report has no fault and no live capture', async () => {
    const user = userEvent.setup()
    const onOpenDiagnosticReport = vi.fn()
    publishDiagnosis('global', 'Global cached conclusion.')
    const snapshot: DiagnosticAiDiagnosis = {
      source: 'error-summary',
      status: 'completed',
      text: 'Explicit conclusion.'
    }
    renderErrorDetailContent({
      aiDiagnosis: snapshot,
      diagnosticReport: { location: 'Home conversation' },
      onOpenDiagnosticReport,
      subject: undefined
    })

    await user.click(screen.getByRole('button', { name: 'Report a problem' }))

    expect(onOpenDiagnosticReport).toHaveBeenCalledWith(
      expect.stringContaining('Location: Home conversation'),
      undefined,
      expect.objectContaining({ source: 'error-summary', status: 'completed', text: 'Explicit conclusion.' })
    )
    expect(onOpenDiagnosticReport.mock.calls[0]?.[2]).not.toHaveProperty('errorId')
    expect(onOpenDiagnosticReport.mock.calls[0]?.[2].text).not.toContain('Global cached conclusion.')
  })

  it('does not attach a global cached result to a contextual report', async () => {
    const user = userEvent.setup()
    const onOpenDiagnosticReport = vi.fn()
    const errorContext = createAppErrorContext({
      id: 'op-1',
      message: 'HTTP 500 upstream boom',
      operation: 'painting.generate',
      source: 'painting'
    })
    publishDiagnosis('global', 'Global cached conclusion.')
    renderErrorDetailContent({
      errorContext,
      incident: { kind: 'operation', context: errorContext },
      onOpenDiagnosticReport,
      subject: { kind: 'operation', operationId: errorContext.id }
    })

    await user.click(screen.getByRole('button', { name: 'Report a problem' }))

    expect(onOpenDiagnosticReport).toHaveBeenCalledWith(expect.any(String), errorContext, undefined)
  })

  it('shows provider status and response body in the technical detail', async () => {
    const user = userEvent.setup()
    renderErrorDetailContent({
      error: {
        cause: null,
        data: null,
        isRetryable: false,
        message: 'quota',
        name: 'AI_APICallError',
        requestBodyValues: null,
        responseBody: '{"error":"quota"}',
        responseHeaders: null,
        stack: 'stack line',
        statusCode: 429,
        url: 'https://example.test/v1'
      }
    })

    await user.click(screen.getByRole('button', { name: 'View Details' }))
    expect(screen.getByText('429')).toBeInTheDocument()
    expect(screen.getByText('{"error":"quota"}')).toBeInTheDocument()
  })

  it('shows the supplied stack when the detail was opened without a serialized error', async () => {
    const user = userEvent.setup()
    renderErrorDetailContent({
      error: undefined,
      errorContext: createAppErrorContext({
        id: 'ctx-1',
        message: 'Render failed',
        name: 'TypeError',
        operation: 'react.render',
        source: 'renderer',
        stack: 'TypeError: boom\n at Widget.tsx:4'
      }),
      subject: { kind: 'operation', operationId: 'ctx-1' }
    })

    await user.click(screen.getByRole('button', { name: 'View Details' }))
    expect(screen.getByText(/Widget\.tsx:4/)).toBeInTheDocument()
  })

  it('keeps check-again and opens the official releases page only when a failed manual check asks for it', async () => {
    const user = userEvent.setup()
    let meta = document.querySelector('meta[name="logger-window-source"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'logger-window-source')
      document.head.appendChild(meta)
    }
    meta.setAttribute('content', 'mainWindow')
    renderErrorDetailContent({ error: providerError })

    expect(screen.queryByRole('button', { name: 'Releases' })).not.toBeInTheDocument()
    expect(mocks.request).not.toHaveBeenCalledWith('system.shell.open_external_website', OFFICIAL_RELEASES_URL)

    act(() => {
      appUpdateCheckService.setUpdateNotice('settings.about.updateNotPublished')
    })
    const unpublished = screen.getByText('No published update is available yet. Please try again later.')
    expect(unpublished).toHaveAttribute('role', 'alert')
    expect(screen.getByRole('button', { name: 'Releases' })).toBeEnabled()
    expect(mocks.request).not.toHaveBeenCalledWith('system.shell.open_external_website', OFFICIAL_RELEASES_URL)

    act(() => {
      appUpdateCheckService.setUpdateNotice('settings.about.updateError')
    })
    expect(screen.getByText('Update error')).toHaveAttribute('role', 'alert')
    expect(screen.getByRole('button', { name: 'Check Update' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Releases' }))
    expect(mocks.request).toHaveBeenCalledWith('system.shell.open_external_website', OFFICIAL_RELEASES_URL)
    expect(mocks.request.mock.calls.filter(([channel]) => channel === 'app.updater.check_for_update')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Check Update' }))
    await waitFor(() => {
      expect(mocks.request.mock.calls.filter(([channel]) => channel === 'app.updater.check_for_update')).toHaveLength(1)
    })

    act(() => {
      appUpdateCheckService.setUpdateNotice('settings.about.updateNotAvailable')
    })
    expect(screen.queryByRole('button', { name: 'Releases' })).not.toBeInTheDocument()
    expect(screen.getByText('You are using the latest version')).toHaveAttribute('role', 'status')
  })

  it('shows a local releases-open failure and still allows another open and another update check', async () => {
    const user = userEvent.setup()
    const unhandled: unknown[] = []
    const onWindowRejection = (event: PromiseRejectionEvent) => {
      event.preventDefault()
      unhandled.push(event.reason)
    }
    const onProcessRejection = (reason: unknown) => {
      unhandled.push(reason)
    }
    window.addEventListener('unhandledrejection', onWindowRejection)
    process.on('unhandledRejection', onProcessRejection)
    let meta = document.querySelector('meta[name="logger-window-source"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'logger-window-source')
      document.head.appendChild(meta)
    }
    meta.setAttribute('content', 'mainWindow')
    let failOpen = true
    mocks.request.mockImplementation((channel: string) => {
      if (channel === 'system.shell.open_external_website') {
        return failOpen ? Promise.reject(new Error('shell failed')) : Promise.resolve(undefined)
      }
      return Promise.resolve({ status: 'completed', isPortable: false })
    })

    try {
      renderErrorDetailContent({ error: providerError })
      act(() => {
        appUpdateCheckService.setUpdateNotice('settings.about.updateError')
      })

      await user.click(screen.getByRole('button', { name: 'Releases' }))
      expect(await screen.findByText('Error opening the external browser.')).toHaveAttribute('role', 'alert')
      expect(screen.getByRole('button', { name: 'Releases' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Check Update' })).toBeEnabled()
      expect(screen.getByText('Update error')).toBeInTheDocument()
      expect(vi.mocked(toast.error)).not.toHaveBeenCalled()
      await waitFor(() => expect(unhandled).toEqual([]))

      failOpen = false
      await user.click(screen.getByRole('button', { name: 'Releases' }))
      await waitFor(() => {
        expect(screen.queryByText('Error opening the external browser.')).not.toBeInTheDocument()
      })
      expect(screen.getByRole('button', { name: 'Releases' })).toBeEnabled()
      expect(unhandled).toEqual([])

      await user.click(screen.getByRole('button', { name: 'Check Update' }))
      await waitFor(() => {
        expect(mocks.request.mock.calls.filter(([channel]) => channel === 'app.updater.check_for_update')).toHaveLength(
          1
        )
      })
      expect(unhandled).toEqual([])
    } finally {
      window.removeEventListener('unhandledrejection', onWindowRejection)
      process.off('unhandledRejection', onProcessRejection)
    }
  })
})
