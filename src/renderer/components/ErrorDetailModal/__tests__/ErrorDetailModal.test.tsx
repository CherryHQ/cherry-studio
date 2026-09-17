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

const missingApiKeyResult: DoctorCheckResult = {
  id: 'provider-api-key-present',
  status: 'fail',
  durationMs: 1,
  attribution: 'user-fixable',
  detail: { variant: 'missing', params: { provider: 'DeepSeek' } },
  evidence: [
    { key: 'providerId', value: 'deepseek', dataClass: 'local_only' },
    { key: 'status', value: 401, dataClass: 'public' },
    { key: 'request', value: 'private request', dataClass: 'consent_required' }
  ],
  actions: [{ kind: 'navigate', target: '/settings/provider' }]
}

const modelEndpointPass: DoctorCheckResult = {
  id: 'network-model-endpoint',
  status: 'pass',
  durationMs: 1
}

const modelListFail: DoctorCheckResult = {
  id: 'provider-model-list',
  status: 'fail',
  durationMs: 1,
  attribution: 'user-fixable',
  detail: { variant: 'request_failed', params: { category: 'auth' } },
  evidence: [
    { key: 'status', value: 401, dataClass: 'public' },
    { key: 'body', value: 'Not logged in · Please run /login', dataClass: 'local_only' }
  ],
  actions: [{ kind: 'navigate', target: '/settings/provider' }]
}

const conversationPending: DoctorPendingCheck = {
  checkId: 'provider-model-conversation',
  requestId: 'confirm-conversation',
  confirmation: {
    messageKey: 'settings.doctor.checks.provider-model-conversation.confirmation',
    params: { model: 'DeepSeek V4 Flash', modelId: 'deepseek-v4-flash', endpoint: 'https://api.deepseek.com/' }
  }
}

const conversationFail: DoctorCheckResult = {
  id: 'provider-model-conversation',
  status: 'fail',
  durationMs: 1,
  attribution: 'user-fixable',
  detail: { variant: 'request_failed', params: { category: 'auth' } },
  actions: [{ kind: 'navigate', target: '/settings/provider' }]
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
  'error.detail': 'Error Details',
  'error.diagnosis.view_details': 'View Details',
  'error.diagnostic_report.action': 'Report a problem',
  'error.diagnostic_report.location': 'Location',
  'error.diagnostics.action_required': 'Action required',
  'error.diagnostics.action_required_tag': 'Needs action',
  'error.diagnostics.back_to_overview': 'Back to diagnostic overview',
  'error.diagnostics.basic_information': 'Basic information',
  'error.diagnostics.basic_information_with_location': 'Basic information ({{location}})',
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

vi.mock('@data/CacheService', () => ({
  cacheService: { isSharedCacheReady: () => mocks.cacheReady, onSharedCacheReady: vi.fn() }
}))

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
    }
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
vi.mock('@renderer/services/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@renderer/utils/errorDiagnosis', () => ({ diagnoseError: mocks.diagnoseError }))

vi.mock('@renderer/i18n/resolver', () => ({ default: { t: (key: string) => translations[key] ?? key } }))

vi.mock('@renderer/components/doctor', async (importOriginal) => ({
  ...(await importOriginal<typeof DoctorComponents>()),
  DoctorPopup: { show: (...args: unknown[]) => mocks.showDoctor(...args) }
}))

import { PopupHost } from '@renderer/components/PopupHost'
import { POPUP_EXIT_MS, popupService } from '@renderer/services/popup'

const { ErrorDetailContent, showErrorDetailPopup } = await import('../ErrorDetailModal')

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
  activeCheckIds: Extract<DoctorState, { status: 'running' }>['activeCheckIds'] = []
): Extract<DoctorState, { status: 'running' }> {
  return {
    status: 'running',
    runId: `running-${tier}`,
    tier,
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

    const basicInformation = screen.getByRole('region', { name: 'Basic information (Home conversation)' })
    expect(basicInformation).toBeInTheDocument()
    expect(basicInformation).toHaveAttribute('data-variant', 'sectioned')
    expect(screen.getByText('OpenAI:gpt-5')).toBeInTheDocument()
    expect(screen.getByText('API Key is invalid, please check and reconfigure (failed)')).toBeInTheDocument()
    expect(screen.queryByText('Home conversation')).not.toBeInTheDocument()
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

  it('returns from nested error details through the localized header action without unmounting diagnostics', async () => {
    const user = userEvent.setup()
    mocks.doctorState = runningDoctorState('quick')
    const view = render(<PopupHost />)

    act(() => {
      showErrorDetailPopup({ subject: { kind: 'global' }, error: providerError })
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
      showErrorDetailPopup({
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
      showErrorDetailPopup({ subject: { kind: 'global' }, error: providerError })
    })

    await user.click(screen.getByRole('button', { name: 'View Details' }))
    const detailDialog = screen.getByText('private stack').closest('[role="dialog"]')
    await user.click(within(detailDialog as HTMLElement).getByRole('button', { name: 'Copy' }))

    expect(writeText).toHaveBeenCalledWith(
      ['Error name: ProviderError', 'Error message: failed', 'Stack: private stack'].join('\n')
    )
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

  it('renders conversation connectivity as three collapsed steps without the result summary', async () => {
    const user = userEvent.setup()
    mocks.doctorState = completedDoctorState([modelEndpointPass, modelListFail], undefined, [conversationPending])

    renderErrorDetailContent({ subject: chatSubject, error: providerError })

    const result = screen.getByRole('region', { name: 'Diagnostic result' })
    const endpoint = within(result).getByRole('button', { name: /Selected model endpoint/ })
    const availability = within(result).getByRole('button', { name: /Remote model availability/ })
    const conversation = within(result).getByRole('button', { name: /Model conversation/ })
    expect(within(endpoint).queryByText('1')).not.toBeInTheDocument()
    expect(within(availability).queryByText('2')).not.toBeInTheDocument()
    expect(within(conversation).queryByText('3')).not.toBeInTheDocument()
    expect(within(endpoint).getByText('Passed')).toHaveClass('text-success')
    expect(within(availability).getByText('Failed')).toHaveClass('text-error')
    expect(within(conversation).getByText('Pending')).toHaveClass('text-warning')
    expect(endpoint).toHaveAttribute('aria-expanded', 'false')
    expect(availability).toHaveAttribute('aria-expanded', 'false')
    expect(conversation).toHaveAttribute('aria-expanded', 'false')
    expect(result).not.toHaveTextContent('needs attention')
    expect(result).not.toHaveTextContent('Fixed:')

    await user.click(endpoint)
    expect(
      within(endpoint.closest('[data-slot="accordion-item"]') as HTMLElement).getByText('Passed', { selector: 'p' })
    ).toBeVisible()
    await user.click(availability)
    expect(
      await screen.findByText('Not signed in or the API key is invalid. The remote model list could not be retrieved.')
    ).toBeVisible()
    expect(screen.queryByText('401')).not.toBeInTheDocument()
    expect(screen.queryByText('Not logged in · Please run /login')).not.toBeInTheDocument()
    await user.click(conversation)
    expect(
      await screen.findByText(
        'Send one short test message to DeepSeek V4 Flash (deepseek-v4-flash) at https://api.deepseek.com/?'
      )
    ).toBeVisible()
    expect(within(result).getByRole('button', { name: 'Send test message' })).toBeEnabled()
    expect(screen.queryByRole('region', { name: 'Action required' })).not.toBeInTheDocument()
  })

  it('keeps connectivity findings on the steps and other user-fixable rows in Diagnostic result', () => {
    mocks.doctorState = completedDoctorState([missingApiKeyResult, modelEndpointPass, modelListFail], undefined, [
      conversationPending
    ])

    renderErrorDetailContent({ subject: chatSubject, error: providerError })

    const result = screen.getByRole('region', { name: 'Diagnostic result' })
    expect(within(result).getByText('Remote model availability')).toBeVisible()
    expect(within(result).getByText('Model conversation')).toBeVisible()
    expect(within(result).getByRole('button', { name: /Provider API key/ })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Action required' })).not.toBeInTheDocument()
    expect(result).not.toHaveTextContent('needs attention')
    const apiKey = within(result).getByRole('button', { name: /Provider API key/ })
    expect(apiKey.querySelector('svg.text-error')).not.toBeInTheDocument()
    expect(within(apiKey).getByText('Needs action')).toHaveClass('text-warning')
    expect(within(apiKey).queryByText('Failed')).not.toBeInTheDocument()
    expect(within(result).getByRole('button', { name: /Remote model availability/ })).not.toHaveTextContent(
      'Needs action'
    )
  })

  it('explains a missing API key with the provider name and no local diagnostic dump', async () => {
    const user = userEvent.setup()
    mocks.doctorState = completedDoctorState([missingApiKeyResult, modelEndpointPass])

    renderErrorDetailContent({ subject: chatSubject, error: providerError })

    const result = screen.getByRole('region', { name: 'Diagnostic result' })
    await user.click(within(result).getByRole('button', { name: /Provider API key/ }))
    expect(within(result).getByText('DeepSeek has no enabled API key.')).toBeVisible()
    expect(within(result).queryByRole('button', { name: 'Local details' })).not.toBeInTheDocument()
    expect(result).not.toHaveTextContent('providerId')
    expect(result).not.toHaveTextContent('401')
    expect(result).not.toHaveTextContent('private request')
  })

  it('keeps a confirmed conversation failure on the connectivity steps', () => {
    mocks.doctorState = completedDoctorState([modelEndpointPass, modelListFail, conversationFail])

    renderErrorDetailContent({ subject: chatSubject, error: providerError })

    const result = screen.getByRole('region', { name: 'Diagnostic result' })
    expect(within(result).getByText('Remote model availability')).toBeVisible()
    expect(within(result).getByText('Model conversation')).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Action required' })).not.toBeInTheDocument()
  })

  it('offers provider settings from a failed connectivity step', async () => {
    const user = userEvent.setup()
    mocks.doctorState = completedDoctorState([modelEndpointPass, modelListFail, conversationFail])

    renderErrorDetailContent({
      subject: chatSubject,
      error: providerError,
      onDoctorNavigate: mocks.openSettingsTab
    })

    await user.click(screen.getByRole('button', { name: /Model conversation/ }))
    await user.click(await screen.findByRole('button', { name: 'Open provider settings' }))

    expect(mocks.openSettingsTab).toHaveBeenCalledWith('/settings/provider')
    expect(screen.queryByRole('region', { name: 'Action required' })).not.toBeInTheDocument()
  })

  it('does not repeat provider settings on connectivity steps when the API key already offers it', async () => {
    const user = userEvent.setup()
    mocks.doctorState = completedDoctorState([missingApiKeyResult, modelEndpointPass, conversationFail])

    renderErrorDetailContent({
      subject: chatSubject,
      error: providerError,
      onDoctorNavigate: mocks.openSettingsTab
    })

    const result = screen.getByRole('region', { name: 'Diagnostic result' })
    await user.click(within(result).getByRole('button', { name: /Model conversation/ }))
    expect(within(result).queryByRole('button', { name: 'Open provider settings' })).not.toBeInTheDocument()
    await user.click(within(result).getByRole('button', { name: /Provider API key/ }))
    await user.click(within(result).getByRole('button', { name: 'Open provider settings' }))
    expect(mocks.openSettingsTab).toHaveBeenCalledWith('/settings/provider')
    expect(screen.queryByRole('region', { name: 'Action required' })).not.toBeInTheDocument()
  })

  it('confirms the conversation step from the diagnostic result', async () => {
    const user = userEvent.setup()
    mocks.doctorState = completedDoctorState([modelEndpointPass, modelListFail], undefined, [conversationPending])
    mocks.request.mockResolvedValue({ status: 'completed' })

    renderErrorDetailContent({ subject: chatSubject, error: providerError })

    await user.click(screen.getByRole('button', { name: /Model conversation/ }))
    await user.click(await screen.findByRole('button', { name: 'Send test message' }))

    expect(mocks.request).toHaveBeenCalledWith('diagnostics.doctor.confirm_check', {
      scope: 'chat:deepseek/deepseek-v4-flash',
      runId: 'completed-quick',
      requestId: 'confirm-conversation'
    })
  })

  it('shows three connectivity steps while a conversation diagnosis is running', () => {
    mocks.doctorState = runningDoctorState('live', ['network-model-endpoint'])

    renderErrorDetailContent({ subject: chatSubject, error: providerError })

    const diagnosing = screen.getByRole('region', { name: 'Diagnosing' })
    expect(within(diagnosing).queryByText('1')).not.toBeInTheDocument()
    expect(within(diagnosing).getByText('Selected model endpoint')).toBeVisible()
    expect(within(diagnosing).queryByText('2')).not.toBeInTheDocument()
    expect(within(diagnosing).getByText('Remote model availability')).toBeVisible()
    expect(within(diagnosing).queryByText('3')).not.toBeInTheDocument()
    expect(within(diagnosing).getByText('Model conversation')).toBeVisible()
    expect(diagnosing).not.toHaveTextContent('needs attention')
    expect(within(diagnosing).queryByRole('status')).not.toBeInTheDocument()
  })

  it('enables the system diagnosis full check without a prior conversation report', async () => {
    const user = userEvent.setup()
    const onOpenFullCheck = vi.fn()
    renderErrorDetailContent({ subject: chatSubject, error: providerError, onOpenFullCheck })

    const result = await screen.findByRole('region', { name: 'Diagnostic result' })
    const fullCheck = await screen.findByRole('button', { name: 'Full check' })
    await waitFor(() => expect(fullCheck).toBeEnabled())
    expect(mocks.request).toHaveBeenCalledWith('diagnostics.doctor.run', {
      subject: chatSubject,
      tier: 'live',
      includeConnectivity: true
    })
    expect(within(result).getByText('Selected model endpoint')).toBeVisible()
    expect(within(result).getByText('Remote model availability')).toBeVisible()
    expect(within(result).getByText('Model conversation')).toBeVisible()
    expect(screen.queryByText('No diagnostic result yet')).not.toBeInTheDocument()

    mocks.request.mockClear()
    await user.click(fullCheck)

    expect(onOpenFullCheck).toHaveBeenCalledTimes(1)
    expect(mocks.request).not.toHaveBeenCalledWith('diagnostics.doctor.run', expect.anything())
  })

  it('opens System Doctor from a conversation full check after error details close', async () => {
    const user = userEvent.setup()
    mocks.doctorState = completedDoctorState([modelEndpointPass, modelListFail], undefined, [conversationPending])
    render(<PopupHost />)
    act(() => showErrorDetailPopup({ subject: chatSubject, error: providerError }))

    const fullCheck = await screen.findByRole('button', { name: 'Full check' })
    await waitFor(() => expect(fullCheck).toBeEnabled())
    mocks.request.mockClear()
    await user.click(fullCheck)

    expect(mocks.request).not.toHaveBeenCalledWith('diagnostics.doctor.run', expect.anything())
    expect(mocks.showDoctor).not.toHaveBeenCalled()
    expect(popupService.getSnapshot()[0]?.open).toBe(false)

    await waitFor(() =>
      expect(mocks.showDoctor).toHaveBeenCalledWith({ initialPanel: 'checks', initialRunTier: 'live' })
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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
    mocks.doctorState = { status: 'canceled', runId: 'canceled-quick' }
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

  it('runs a full check from the diagnostics header', async () => {
    const user = userEvent.setup()
    mocks.doctorState = runningDoctorState('quick')
    const { rerender } = renderErrorDetailContent({ error: providerError })

    mocks.doctorState = completedDoctorState([passingVersionResult])
    rerender(
      <Dialog open>
        <DialogContent>
          <ErrorDetailContent subject={{ kind: 'global' }} error={providerError} />
        </DialogContent>
      </Dialog>
    )
    const networkCheck = await screen.findByRole('button', { name: 'Full check' })
    await waitFor(() => expect(networkCheck).toBeEnabled())
    await user.click(networkCheck)

    expect(mocks.request).toHaveBeenCalledWith('diagnostics.doctor.run', { subject: { kind: 'global' }, tier: 'live' })
  })

  it('opens System Doctor for the full check after error details close', async () => {
    const user = userEvent.setup()
    mocks.doctorState = completedDoctorState([passingVersionResult])
    render(<PopupHost />)

    act(() => showErrorDetailPopup({ subject: { kind: 'global' }, error: providerError }))
    await user.click(screen.getByRole('button', { name: 'Full check' }))

    expect(mocks.request).not.toHaveBeenCalledWith('diagnostics.doctor.run', {
      subject: { kind: 'global' },
      tier: 'live'
    })
    expect(mocks.showDoctor).not.toHaveBeenCalled()
    expect(popupService.getSnapshot()[0]?.open).toBe(false)

    await waitFor(() =>
      expect(mocks.showDoctor).toHaveBeenCalledWith({ initialPanel: 'checks', initialRunTier: 'live' })
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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
      showErrorDetailPopup({
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
})
