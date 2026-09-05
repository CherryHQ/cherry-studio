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
  'common.retry': 'Retry',
  'error.detail': 'Error Details',
  'error.diagnosis.ai_button': 'AI diagnosis',
  'error.diagnosis.ai_done': 'AI diagnosis complete',
  'error.diagnosis.ai_loading': 'Diagnosing',
  'error.diagnosis.ai_result': 'AI diagnosis result',
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
  'settings.doctor.actions.run_network': 'Full check',
  'settings.doctor.actions.run_basic': 'Quick basic checks',
  'settings.doctor.checks.config-boot-config-valid.detail.invalid_keys':
    'Some startup settings are not recognized or valid.',
  'settings.doctor.checks.config-boot-config-valid.title': 'Startup configuration',
  'settings.doctor.checks.storage-disk-space.detail.low': 'Available disk space is low.',
  'settings.doctor.checks.storage-disk-space.title': 'Available disk space',
  'settings.doctor.checks.install-version-channel.title': 'Version and release channel',
  'settings.doctor.fixes.repair_boot_config': 'Repair startup configuration',
  'settings.doctor.messages.relaunch_required': 'Restart Cherry Studio to apply the repair.',
  'settings.doctor.status.fail': 'Failed',
  'settings.doctor.status.pass': 'Passed',
  'settings.doctor.summary.problems': '{{count}} items need attention',
  'settings.doctor.summary.progress': '{{completed}} of {{total}} completed',
  'settings.doctor.stale.description': 'This diagnostic result is out of date.',
  'settings.doctor.title': 'System diagnostics'
}

function translate(key: string, params?: Record<string, string | number>) {
  return Object.entries(params ?? {}).reduce(
    (value, [name, replacement]) => value.replace(`{{${name}}}`, String(replacement)),
    translations[key] ?? key
  )
}

vi.mock('@data/CacheService', () => ({
  cacheService: { isSharedCacheReady: () => mocks.cacheReady, onSharedCacheReady: vi.fn() }
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
    t: translate
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

function getStartAiDiagnosisButton() {
  const action = screen
    .getAllByRole('button', { name: 'AI diagnosis' })
    .find((button) => !button.hasAttribute('aria-expanded'))
  expect(action).toBeDefined()
  return action as HTMLButtonElement
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
      diagnosisContext: { errorSource: 'chat', providerName: 'OpenAI', modelId: 'gpt-5' },
      diagnosticReport: { location: 'Home conversation' },
      error: providerError
    })

    const basicInformation = screen.getByRole('region', { name: 'Basic information' })
    expect(basicInformation).toBeInTheDocument()
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

  it('keeps diagnostics mounted while nested error details are open and restores focus when they close', async () => {
    const user = userEvent.setup()
    const pendingDiagnosis = deferredDiagnosis()
    mocks.diagnoseError.mockReturnValueOnce(pendingDiagnosis.promise)
    mocks.doctorState = runningDoctorState('quick')
    const view = render(<PopupHost />)

    act(() => {
      showErrorDetailPopup({ error: providerError })
    })

    const outerDialog = screen.getByText('Basic information').closest('[role="dialog"]')
    const viewDetails = screen.getByRole('button', { name: 'View Details' })
    await user.click(getStartAiDiagnosisButton())
    await user.click(viewDetails)

    expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(2)
    expect(outerDialog).toBeInTheDocument()
    expect(within(outerDialog as HTMLElement).getByText('Basic information')).toBeInTheDocument()
    const detailDialog = screen.getByText('private stack').closest('[role="dialog"]')
    expect(detailDialog).not.toBe(outerDialog)
    expect(within(detailDialog as HTMLElement).getByRole('heading', { name: 'Error Details' })).toBeInTheDocument()

    mocks.doctorState = completedDoctorState([passingVersionResult])
    view.rerender(<PopupHost />)
    await act(async () => pendingDiagnosis.resolve(aiDiagnosis))
    await user.click(within(detailDialog as HTMLElement).getByRole('button', { name: 'Close' }))

    expect(await screen.findByText(aiDiagnosis.explanation)).toBeInTheDocument()
    await waitFor(() => expect(viewDetails).toHaveFocus())
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
      showErrorDetailPopup({ error: providerError })
    })

    await user.click(screen.getByRole('button', { name: /Startup configuration/ }))
    const repair = screen.getByRole('button', { name: 'Repair startup configuration' })
    await waitFor(() => expect(repair).toBeEnabled())
    await user.click(repair)

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument())
    await user.keyboard('{Escape}')
    expect(popupService.getSnapshot()[0]?.open).toBe(true)
    const overlay = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')
    expect(overlay).not.toBeNull()
    fireEvent.click(overlay as HTMLElement)
    expect(popupService.getSnapshot()[0]?.open).toBe(true)

    await act(async () => resolveFix({ status: 'requires_relaunch' }))

    expect(await screen.findByText('Restart Cherry Studio to apply the repair.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('copies the unchanged error text from the nested error details', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    render(<PopupHost />)

    act(() => {
      showErrorDetailPopup({ error: providerError })
    })

    await user.click(screen.getByRole('button', { name: 'View Details' }))
    const detailDialog = screen.getByText('private stack').closest('[role="dialog"]')
    await user.click(within(detailDialog as HTMLElement).getByRole('button', { name: 'Copy' }))

    expect(writeText).toHaveBeenCalledWith(
      ['Error name: ProviderError', 'Error message: failed', 'Stack: private stack'].join('\n')
    )
  })

  it('shows a completed AI diagnosis as the initially expanded list item', () => {
    mocks.cacheReady = false
    mocks.doctorState = completedDoctorState([passingVersionResult])

    renderErrorDetailContent({ cachedDiagnosis: aiDiagnosis, error: providerError })

    const diagnostics = screen.getByRole('region', { name: 'System diagnostics' })
    expect(within(diagnostics).getByText('1 of 1 completed · 0 items need attention')).toBeVisible()
    expect(within(diagnostics).getByRole('button', { name: /AI diagnosis/ })).toHaveAttribute('aria-expanded', 'true')
    expect(within(diagnostics).getByText(aiDiagnosis.explanation)).toBeVisible()
  })

  it('switches from AI diagnosis to an expanded Doctor item in the same accordion', async () => {
    const user = userEvent.setup()
    mocks.doctorState = completedDoctorState([lowDiskResult])

    renderErrorDetailContent({ cachedDiagnosis: aiDiagnosis, error: providerError })

    const aiTrigger = screen.getByRole('button', { name: /AI diagnosis/ })
    const doctorTrigger = screen.getByRole('button', { name: /Available disk space/ })
    expect(aiTrigger).toHaveAttribute('aria-expanded', 'true')
    expect(doctorTrigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Available disk space is low.')).not.toBeInTheDocument()

    await user.click(doctorTrigger)

    expect(aiTrigger).toHaveAttribute('aria-expanded', 'false')
    expect(doctorTrigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByText(aiDiagnosis.explanation)).not.toBeInTheDocument()
    expect(await screen.findByText('Available disk space is low.')).toBeVisible()
    expect(screen.queryByRole('button', { name: /Installation/ })).not.toBeInTheDocument()
  })

  it('offers a basic rerun directly from an expired-result warning', async () => {
    const user = userEvent.setup()
    mocks.doctorState = completedDoctorState([], new Date(Date.now() - 1).toISOString())
    renderErrorDetailContent({ cachedDiagnosis: aiDiagnosis, error: providerError })

    await screen.findByText('This diagnostic result is out of date.')
    const staleAlert = screen
      .getAllByRole('status')
      .find((alert) => within(alert).queryByText('This diagnostic result is out of date.'))
    expect(staleAlert).toBeDefined()
    const rerun = within(staleAlert as HTMLElement).getByRole('button', { name: 'Quick basic checks' })

    await user.click(rerun)

    expect(mocks.request).toHaveBeenCalledWith('diagnostics.doctor.run', { tier: 'quick' })
  })

  it('starts Doctor diagnostics immediately but waits for an explicit AI diagnosis request', async () => {
    const user = userEvent.setup()
    renderErrorDetailContent({ error: providerError })

    expect(mocks.request).toHaveBeenCalledWith('diagnostics.doctor.run', { tier: 'quick' })
    expect(mocks.diagnoseError).not.toHaveBeenCalled()

    await user.click(getStartAiDiagnosisButton())

    await waitFor(() => expect(mocks.diagnoseError).toHaveBeenCalledOnce())
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
    const networkCheck = await screen.findByRole('button', { name: 'Full check' })
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

    await user.click(getStartAiDiagnosisButton())
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
