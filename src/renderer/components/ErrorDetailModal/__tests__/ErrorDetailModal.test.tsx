import { Dialog, DialogContent } from '@cherrystudio/ui'
import type * as DoctorComponents from '@renderer/components/doctor'
import type { SerializedError } from '@renderer/types/error'
import type { DiagnosisResult } from '@renderer/utils/errorDiagnosis'
import type { DoctorCheckResult, DoctorState } from '@shared/types/doctor'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  evidence: [{ key: 'reclaimableBytes', value: 1024, dataClass: 'public' }],
  actions: [{ kind: 'fix', fixId: 'cleanup' }]
}

const mocks = vi.hoisted(() => ({
  diagnoseError: vi.fn(),
  doctorState: { status: 'idle' } as DoctorState,
  openSettingsTab: vi.fn(),
  request: vi.fn(),
  showDoctor: vi.fn()
}))

const translations: Record<string, string> = {
  'common.copy': 'Copy',
  'common.cancel': 'Cancel',
  'common.retry': 'Retry',
  'error.detail': 'Error Details',
  'error.diagnosis.ai_button': 'AI diagnosis',
  'error.diagnosis.ai_done': 'AI diagnosis complete',
  'error.diagnosis.ai_loading': 'Diagnosing',
  'error.diagnosis.ai_result': 'AI diagnosis',
  'error.diagnosis.view_details': 'View Details',
  'error.diagnostic_report.action': 'Report a problem',
  'error.diagnostic_report.location': 'Location',
  'error.diagnostics.back_to_overview': 'Back to diagnostic overview',
  'error.diagnostics.basic_information': 'Basic information',
  'error.message': 'Error message',
  'error.modelId': 'Model',
  'error.name': 'Error name',
  'error.provider': 'Provider',
  'error.stack': 'Stack',
  'error.statusCode': 'Status code',
  'message.copied': 'Copied',
  'settings.doctor.actions.run_network': 'Full check (includes network and services)',
  'settings.doctor.actions.run_basic': 'Quick basic checks',
  'settings.doctor.checks.storage-disk-space.detail.low': 'Available disk space is low.',
  'settings.doctor.checks.storage-disk-space.title': 'Available disk space',
  'settings.doctor.checks.install-version-channel.title': 'Version and release channel',
  'settings.doctor.confirm_fix.title': 'Continue with this action?',
  'settings.doctor.domains.install': 'Installation',
  'settings.doctor.domains.storage': 'Storage',
  'settings.doctor.fixes.cleanup_storage': 'Clean up storage',
  'settings.doctor.status.pass': 'Passed',
  'settings.doctor.stale.description': 'This result is out of date.',
  'settings.doctor.title': 'System diagnostics'
}

vi.mock('@data/CacheService', () => ({
  cacheService: { isSharedCacheReady: () => true, onSharedCacheReady: vi.fn() }
}))

vi.mock('@data/hooks/useCache', () => ({
  useSharedCacheValue: () => mocks.doctorState
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ warn: vi.fn() }) }
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
  loggerService: { withContext: () => ({ error: vi.fn() }) }
}))
vi.mock('@renderer/services/mainWindowNavigation', () => ({
  openSettingsTab: (...args: unknown[]) => mocks.openSettingsTab(...args)
}))
vi.mock('@renderer/services/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@renderer/utils/errorDiagnosis', () => ({ diagnoseError: mocks.diagnoseError }))

vi.mock('@renderer/i18n/resolver', () => ({ default: { t: (key: string) => translations[key] ?? key } }))
vi.mock('i18next', () => ({ t: (key: string) => translations[key] ?? key }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string) => translations[key] ?? key
  })
}))

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
        <ErrorDetailContent {...props} />
      </DialogContent>
    </Dialog>
  )
}

function runningDoctorState(tier: 'quick' | 'live'): DoctorState {
  return {
    status: 'running',
    runId: `running-${tier}`,
    tier,
    startedAt: new Date().toISOString(),
    results: []
  }
}

function completedDoctorState(
  results: readonly DoctorCheckResult[] = [],
  expiresAt = new Date(Date.now() + 60_000).toISOString()
): DoctorState {
  const now = Date.now()
  return {
    status: 'completed',
    report: {
      schemaVersion: 1,
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
      summary: { pass: 0, warn: 0, fail: 0, skip: 0, error: 0 }
    }
  }
}

function deferredDiagnosis() {
  let resolve!: (result: DiagnosisResult) => void
  return {
    promise: new Promise<DiagnosisResult>((next) => {
      resolve = next
    }),
    resolve
  }
}

describe('ErrorDetailContent diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('shows compact basic information and copies the unchanged error text', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()

    renderErrorDetailContent({
      diagnosisContext: { errorSource: 'chat', providerName: 'OpenAI', modelId: 'gpt-5' },
      diagnosticReport: { location: 'Home conversation' },
      error: providerError
    })

    expect(screen.getByText('Basic information')).toBeInTheDocument()
    expect(screen.getByText('Home conversation')).toBeInTheDocument()
    expect(screen.getByText('OpenAI')).toBeInTheDocument()
    expect(screen.getByText('gpt-5')).toBeInTheDocument()
    expect(screen.getByText('503')).toBeInTheDocument()
    expect(screen.queryByText('private stack')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Report a problem' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith(
      ['Error name: ProviderError', 'Error message: failed', 'Stack: private stack'].join('\n')
    )
  })

  it('keeps diagnostics mounted while navigating error details from the dialog header', async () => {
    const user = userEvent.setup()
    const pendingDiagnosis = deferredDiagnosis()
    mocks.diagnoseError.mockReturnValueOnce(pendingDiagnosis.promise)
    mocks.doctorState = runningDoctorState('quick')
    const view = render(<PopupHost />)

    act(() => {
      showErrorDetailPopup({ error: providerError })
    })

    await user.click(screen.getByRole('button', { name: 'View Details' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Back to diagnostic overview' })).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: 'Error Details' })).toBeInTheDocument()
    expect(within(dialog).getByText('private stack')).toBeVisible()

    mocks.doctorState = completedDoctorState([passingVersionResult])
    view.rerender(<PopupHost />)
    await act(async () => pendingDiagnosis.resolve(aiDiagnosis))
    await user.click(within(dialog).getByRole('button', { name: 'Back to diagnostic overview' }))

    expect(await screen.findByText(aiDiagnosis.explanation)).toBeInTheDocument()
    const installGroup = screen.getByRole('button', { name: /Installation/ })
    await user.click(installGroup)
    expect(screen.getByText('Version and release channel')).toBeVisible()
    expect(mocks.request).not.toHaveBeenCalledWith('diagnostics.doctor.cancel', expect.anything())
  })

  it('collapses a successful AI diagnosis until the user expands it', async () => {
    const user = userEvent.setup()
    mocks.doctorState = runningDoctorState('quick')

    renderErrorDetailContent({ cachedDiagnosis: aiDiagnosis, error: providerError })

    const disclosure = screen.getByLabelText('AI diagnosis')
    expect(screen.getByText(aiDiagnosis.explanation)).not.toBeVisible()

    await user.click(disclosure)

    expect(screen.getByText(aiDiagnosis.explanation)).toBeVisible()
  })

  it('offers a basic rerun directly from an expired-result warning', async () => {
    const user = userEvent.setup()
    mocks.doctorState = completedDoctorState([], new Date(Date.now() - 1).toISOString())
    renderErrorDetailContent({ cachedDiagnosis: aiDiagnosis, error: providerError })

    await screen.findByText('This result is out of date.')
    const staleAlert = screen
      .getAllByRole('status')
      .find((alert) => within(alert).queryByText('This result is out of date.'))
    expect(staleAlert).toBeDefined()
    const rerun = within(staleAlert as HTMLElement).getByRole('button', { name: 'Quick basic checks' })

    await user.click(rerun)

    expect(mocks.request).toHaveBeenCalledWith('diagnostics.doctor.run', { tier: 'quick' })
  })

  it('opens destructive confirmation as a child dialog without replacing the error overview', async () => {
    const user = userEvent.setup()
    mocks.doctorState = runningDoctorState('quick')
    const view = render(<PopupHost />)

    act(() => {
      showErrorDetailPopup({ error: providerError })
    })
    mocks.doctorState = completedDoctorState([lowDiskResult])
    view.rerender(<PopupHost />)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Storage/ })).toHaveAttribute('aria-expanded', 'true')
    )
    await user.click(await screen.findByRole('button', { name: 'Clean up storage' }))

    const dialogs = screen.getAllByRole('dialog')
    expect(dialogs).toHaveLength(2)
    expect(screen.getByText('Basic information')).toBeVisible()
    expect(within(dialogs[1]).getByRole('status')).toHaveTextContent('Continue with this action?')
  })

  it('starts uncached AI and basic Doctor diagnostics together', async () => {
    renderErrorDetailContent({ error: providerError })

    await waitFor(() => expect(mocks.diagnoseError).toHaveBeenCalledOnce())
    expect(mocks.request).toHaveBeenCalledWith('diagnostics.doctor.run', { tier: 'quick' })
  })

  it('runs a full check from the diagnostics header', async () => {
    const user = userEvent.setup()
    mocks.doctorState = runningDoctorState('quick')
    const { rerender } = renderErrorDetailContent({ error: providerError })

    mocks.doctorState = completedDoctorState([passingVersionResult])
    rerender(
      <Dialog open>
        <DialogContent>
          <ErrorDetailContent error={providerError} />
        </DialogContent>
      </Dialog>
    )
    const networkCheck = await screen.findByRole('button', { name: 'Full check (includes network and services)' })
    await waitFor(() => expect(networkCheck).toBeEnabled())
    await user.click(networkCheck)

    expect(mocks.request).toHaveBeenCalledWith('diagnostics.doctor.run', { tier: 'live' })
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
    mocks.diagnoseError.mockResolvedValueOnce({
      ...aiDiagnosis,
      explanation: 'private AI diagnosis'
    })

    renderErrorDetailContent({
      diagnosticReport: { location: 'Agent conversation' },
      error: providerError,
      onOpenDiagnosticReport
    })

    expect(await screen.findByText('private AI diagnosis')).toBeInTheDocument()
    const footer = screen.getByRole('group', { name: 'Error Details' })
    expect(
      within(footer)
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual(['Report a problem'])
    await user.click(within(footer).getByRole('button', { name: 'Report a problem' }))

    const description = onOpenDiagnosticReport.mock.calls[0][0]
    expect(description).toContain('Error message: failed')
    expect(description).not.toContain('private AI diagnosis')
    expect(description).not.toContain('private Doctor evidence')
    expect(description).not.toContain('private stack')
  })

  it('waits for error details to finish closing before opening report review', async () => {
    vi.useFakeTimers()
    render(<PopupHost />)

    act(() => {
      showErrorDetailPopup({
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
