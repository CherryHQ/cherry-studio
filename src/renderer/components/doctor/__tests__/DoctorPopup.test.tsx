import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChangeEvent } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { popupService } from '@renderer/services/popup'
import { DOCTOR_CHECK_CATALOG, DOCTOR_CHECK_IDS, type DoctorCheckResult, type DoctorState } from '@shared/types/doctor'

vi.unmock('@cherrystudio/ui')

const mocks = vi.hoisted(() => ({
  doctorState: { status: 'canceled', runId: 'run-1', selectedCheckIds: [] } as DoctorState,
  request: vi.fn(),
  translations: {
    'error.diagnostics.checking_progress': 'Checking: {{check}} · {{completed}}/{{total}}',
    'settings.doctor.checks.error': 'This check could not be completed',
    'settings.doctor.checks.skipped': 'Skipped because {{check}} did not complete',
    'settings.doctor.checks.provider-api-key-present.title': 'Default provider API key',
    'settings.doctor.checks.provider-model.title': 'Provider model',
    'settings.doctor.summary.fixed': 'Fixed: {{count}}',
    'settings.doctor.summary.needs_attention': 'Needs attention: {{count}}',
    'settings.doctor.summary.problems': '{{count}} items need attention',
    'settings.doctor.summary.progress': '{{completed}} of {{total}} completed',
    'settings.doctor.summary.running_basic': 'Running quick basic checks…',
    'settings.doctor.summary.running_full': 'Running full checks, including network and services…'
  } as Record<string, string>
}))

vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())

vi.mock('@data/CacheService', () => ({
  cacheService: { isSharedCacheReady: () => true, onSharedCacheReady: vi.fn() }
}))
vi.mock('@data/hooks/useCache', () => ({ useSharedCacheValue: () => mocks.doctorState }))
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
vi.mock('@renderer/services/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@renderer/services/mainWindowNavigation', () => ({ openSettingsTab: vi.fn() }))

vi.mock('@renderer/components/feedback/DiagnosticUploadPanel', () => {
  const React = require('react')
  const DiagnosticUploadPanel = ({ ref, description, onBusyChange, onClose, onDescriptionChange }) => {
    React.useImperativeHandle(ref, () => ({ requestClose: async () => true }))
    return React.createElement(
      React.Fragment,
      null,
      React.createElement('textarea', {
        'aria-label': 'settings.about.diagnostics.report.description_label',
        value: description,
        onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onDescriptionChange(event.target.value)
      }),
      React.createElement('button', { type: 'button', onClick: () => onBusyChange?.(true) }, 'Start report operation'),
      React.createElement('button', { type: 'button', onClick: onClose }, 'Close report panel')
    )
  }
  return { DiagnosticUploadPanel }
})

vi.mock('@renderer/components/feedback/DiagnosticBundlePanel', () => ({
  default: ({ onClose }) => (
    <div>
      settings.doctor.panels.export
      <button type="button" onClick={onClose}>
        Close export panel
      </button>
    </div>
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, number | string>) =>
      Object.entries(values ?? {}).reduce(
        (translation, [name, value]) => translation.replace(`{{${name}}}`, String(value)),
        mocks.translations[key] ?? key
      )
  })
}))

import { PopupHost } from '@renderer/components/PopupHost'

import DoctorPopup from '../DoctorPopup'

function completedDoctorState(
  results: readonly DoctorCheckResult[] = [{ id: 'install-version-channel', status: 'pass', durationMs: 1 }],
  expiresAt = new Date(Date.now() + 60_000).toISOString()
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
      summary: { pass: 1, warn: 0, fail: 0, skip: 0, error: 0 }
    }
  }
}

afterEach(async () => {
  cleanup()
  vi.useFakeTimers()
  await act(async () => {
    for (const entry of [...popupService.getSnapshot()]) popupService.settle(entry.instanceId, {})
    await vi.runAllTimersAsync()
  })
  vi.useRealTimers()
})

describe('DoctorPopup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.doctorState = { status: 'canceled', runId: 'run-1', selectedCheckIds: [] }
    mocks.request.mockResolvedValue(undefined)
  })

  it('sizes secondary panels to their content within the viewport cap', async () => {
    render(<PopupHost />)

    act(() => {
      void DoctorPopup.show({ initialPanel: 'report' })
    })

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveClass('max-h-[calc(100vh-100px)]')
    expect(dialog).not.toHaveClass('h-[min(760px,calc(100vh-2rem))]')
    expect(dialog).not.toHaveAccessibleDescription()
  })

  it('shows the checks panel without a description or dividers', async () => {
    mocks.doctorState = completedDoctorState()
    render(<PopupHost />)

    act(() => {
      void DoctorPopup.show({ initialPanel: 'checks' })
    })

    const dialog = await screen.findByRole('dialog')
    expect(dialog).not.toHaveAccessibleDescription()
    expect(screen.queryByText('settings.doctor.panel_descriptions.checks')).not.toBeInTheDocument()
    // The checks layout intentionally joins its header, scrolling body, and footer without dividers.
    expect(dialog.querySelector('[data-slot="dialog-header"]')).not.toHaveClass('border-b')
    expect(dialog.querySelector('[data-slot="dialog-footer"]')).not.toHaveClass('border-t')
  })

  it('treats a directly opened report as a standalone problem report', async () => {
    const user = userEvent.setup()
    render(<PopupHost />)

    act(() => {
      void DoctorPopup.show({ initialPanel: 'report' })
    })

    expect(await screen.findByRole('heading', { name: 'settings.doctor.panels.report' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'settings.doctor.actions.back_to_checks' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close report panel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('hides the quick basic action while a result is current', async () => {
    mocks.doctorState = completedDoctorState()
    render(<PopupHost />)

    act(() => {
      void DoctorPopup.show({ initialPanel: 'checks' })
    })

    expect(await screen.findByRole('button', { name: 'settings.doctor.actions.run_network' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'settings.doctor.actions.run_basic' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'error.diagnostics.action_required' })).not.toBeInTheDocument()
    expect(screen.queryByText('Fixed: 0')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'error.diagnostics.result' })).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: /settings\.doctor\.checks\.install-version-channel\.title.*settings\.doctor\.status\.pass/
      })
    ).toBeVisible()
  })

  it('runs quick checks from the expired-result alert', async () => {
    const user = userEvent.setup()
    mocks.doctorState = completedDoctorState(undefined, new Date(Date.now() - 1_000).toISOString())
    render(<PopupHost />)

    act(() => {
      void DoctorPopup.show({ initialPanel: 'checks' })
    })

    await screen.findByText('settings.doctor.stale.description')
    const staleAlert = screen
      .getAllByRole('status')
      .find((alert) => within(alert).queryByText('settings.doctor.stale.description'))
    expect(staleAlert).toBeDefined()

    await user.click(
      within(staleAlert as HTMLElement).getByRole('button', { name: 'settings.doctor.actions.run_basic' })
    )

    expect(mocks.request).toHaveBeenCalledWith('diagnostics.doctor.run', { subject: { kind: 'global' }, tier: 'quick' })
  })

  it('offers a quick recovery after full checks are canceled', async () => {
    const user = userEvent.setup()
    mocks.doctorState = { status: 'canceled', runId: 'canceled-live', selectedCheckIds: [] }
    render(<PopupHost />)

    act(() => {
      void DoctorPopup.show({ initialPanel: 'checks' })
    })

    await screen.findByText('settings.doctor.empty.canceled_title')
    const canceledAlert = screen
      .getAllByRole('status')
      .find((alert) => within(alert).queryByText('settings.doctor.empty.canceled_title'))
    expect(canceledAlert).toBeDefined()

    await user.click(
      within(canceledAlert as HTMLElement).getByRole('button', { name: 'settings.doctor.actions.rerun' })
    )

    expect(mocks.request).toHaveBeenCalledWith('diagnostics.doctor.run', { subject: { kind: 'global' }, tier: 'quick' })
  })

  it.each(['quick', 'live'] as const)('keeps an active %s run cancelable', async (tier) => {
    const user = userEvent.setup()
    mocks.doctorState = {
      status: 'running',
      runId: `running-${tier}`,
      tier,
      selectedCheckIds:
        tier === 'quick'
          ? DOCTOR_CHECK_IDS.filter((id) => DOCTOR_CHECK_CATALOG[id].tier === 'quick')
          : DOCTOR_CHECK_IDS,
      startedAt: new Date().toISOString(),
      activeCheckIds: [],
      results: []
    }
    render(<PopupHost />)

    act(() => {
      void DoctorPopup.show({ initialPanel: 'checks' })
    })

    await user.click(await screen.findByRole('button', { name: 'settings.doctor.actions.cancel_run' }))

    expect(mocks.request).toHaveBeenCalledWith('diagnostics.doctor.cancel', {
      scope: 'global',
      runId: `running-${tier}`
    })
  })

  it('uses the export title and keeps generic problem reporting out of the checks menu', async () => {
    const user = userEvent.setup()
    mocks.doctorState = completedDoctorState()
    render(<PopupHost />)

    act(() => {
      void DoctorPopup.show({ initialPanel: 'checks' })
    })

    expect(await screen.findByRole('heading', { name: 'settings.doctor.title' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'settings.doctor.actions.more' }))
    expect(screen.getByRole('menu')).toHaveAttribute('data-side', 'top')
    expect(screen.queryByRole('menuitem', { name: 'settings.doctor.actions.report_problem' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'settings.doctor.actions.copy' })).toBeVisible()
    await user.click(screen.getByRole('menuitem', { name: 'settings.doctor.panels.export' }))

    expect(screen.getByRole('heading', { name: 'settings.doctor.panels.export' })).toBeVisible()
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('settings.doctor.panel_descriptions.export')
    expect(screen.getByRole('dialog').querySelector('[data-slot="dialog-header"]')).toHaveClass('border-b')
    await user.click(screen.getByRole('button', { name: 'settings.doctor.actions.back_to_checks' }))
    expect(screen.getByRole('heading', { name: 'settings.doctor.title' })).toBeVisible()
  })

  it('shows every check during a run and updates results in place', async () => {
    mocks.doctorState = {
      status: 'running',
      runId: 'quick-run',
      tier: 'quick',
      selectedCheckIds: DOCTOR_CHECK_IDS.filter((id) => DOCTOR_CHECK_CATALOG[id].tier === 'quick'),
      startedAt: new Date().toISOString(),
      activeCheckIds: ['provider-api-key-present'],
      results: [{ id: 'install-version-channel', status: 'pass', durationMs: 1 }]
    }
    const view = render(<PopupHost />)

    act(() => {
      void DoctorPopup.show({ initialPanel: 'checks' })
    })

    const quickCheckCount = DOCTOR_CHECK_IDS.filter((id) => DOCTOR_CHECK_CATALOG[id].tier === 'quick').length
    const checks = await screen.findByRole('region', { name: 'settings.doctor.copy.checks_heading' })
    expect(within(checks).getAllByRole('button')).toHaveLength(quickCheckCount)
    for (const check of within(checks).getAllByRole('button')) {
      expect(check).toHaveAttribute('aria-expanded', 'false')
    }
    expect(screen.queryByText(/^Checking:/)).not.toBeInTheDocument()
    expect(
      within(checks).getByRole('button', {
        name: /settings\.doctor\.checks\.install-version-channel\.title.*settings\.doctor\.status\.pass/
      })
    ).toBeVisible()
    expect(
      within(checks).getByRole('button', { name: /Default provider API key.*settings\.doctor\.status\.pending/ })
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: 'settings.doctor.advanced.title' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.doctor.actions.cancel_run' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'settings.doctor.actions.more' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'settings.doctor.actions.run_network' })).toBeDisabled()

    mocks.doctorState = {
      ...mocks.doctorState,
      activeCheckIds: [],
      results: [...mocks.doctorState.results, { id: 'provider-api-key-present', status: 'pass', durationMs: 1 }]
    }
    view.rerender(<PopupHost />)

    expect(
      await within(checks).findByRole('button', { name: /Default provider API key.*settings\.doctor\.status\.pass/ })
    ).toBeVisible()
    expect(within(checks).getAllByRole('button')).toHaveLength(quickCheckCount)
  })

  it('lists all completed checks with their results and collapsed details', async () => {
    const user = userEvent.setup()
    mocks.doctorState = {
      status: 'completed',
      report: {
        schemaVersion: 1,
        scope: 'global',
        runId: 'run-2',
        tier: 'quick',
        selectedCheckIds: [
          'storage-disk-space',
          'config-boot-config-valid',
          'provider-api-key-present',
          'logs-recent-findings'
        ],
        startedAt: new Date(Date.now() - 1_000).toISOString(),
        finishedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
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
        results: [
          {
            id: 'install-version-channel',
            status: 'pass',
            durationMs: 1
          },
          {
            id: 'permission-accessibility',
            status: 'warn',
            durationMs: 1,
            attribution: 'user-fixable',
            detail: { variant: 'denied' },
            evidence: [{ key: 'permission', value: 'denied', dataClass: 'local_only' }],
            actions: [{ kind: 'fix', fixId: 'request' }]
          },
          {
            id: 'storage-disk-space',
            status: 'fail',
            durationMs: 1,
            attribution: 'user-fixable',
            detail: {
              variant: 'low',
              params: {
                reclaimableBytes: 300 * 1024 * 1024,
                normalCacheBytes: 80 * 1024 * 1024,
                diagnosticDataBytes: 220 * 1024 * 1024
              }
            },
            evidence: [
              { key: 'reclaimableBytes', value: 300 * 1024 * 1024, dataClass: 'public' },
              { key: 'normalCacheBytes', value: 80 * 1024 * 1024, dataClass: 'public' },
              { key: 'diagnosticDataBytes', value: 220 * 1024 * 1024, dataClass: 'public' },
              { key: 'cachePath', value: '/private/cache', dataClass: 'local_only' }
            ],
            actions: []
          },
          {
            id: 'logs-recent-findings',
            status: 'warn',
            durationMs: 1,
            attribution: 'app-bug',
            detail: { variant: 'findings' },
            actions: [{ kind: 'report' }]
          },
          {
            id: 'network-online',
            status: 'warn',
            durationMs: 1,
            attribution: 'transient',
            detail: { variant: 'offline' },
            actions: []
          },
          {
            id: 'provider-model',
            status: 'error',
            durationMs: 1,
            message: 'Probe failed'
          },
          {
            id: 'provider-api-key-present',
            status: 'skip',
            durationMs: 1,
            skippedBy: 'provider-model'
          }
        ],
        summary: { pass: 1, warn: 3, fail: 1, skip: 1, error: 1 }
      }
    }
    render(<PopupHost />)

    act(() => {
      void DoctorPopup.show({ initialPanel: 'checks' })
    })

    const checks = await screen.findByRole('region', { name: 'settings.doctor.copy.checks_heading' })
    expect(screen.queryByRole('region', { name: 'error.diagnostics.result' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'error.diagnostics.action_required' })).not.toBeInTheDocument()
    expect(within(checks).getAllByRole('button')).toHaveLength(7)
    const orderedChecks = within(checks).getAllByRole('button')
    const expectedTitles = [
      'settings.doctor.checks.storage-disk-space.title',
      'Provider model',
      'settings.doctor.checks.permission-accessibility.title',
      'settings.doctor.checks.network-online.title',
      'settings.doctor.checks.logs-recent-findings.title',
      'settings.doctor.checks.install-version-channel.title',
      'Default provider API key'
    ]
    for (const [index, title] of expectedTitles.entries()) {
      expect(orderedChecks[index]).toHaveAccessibleName(expect.stringContaining(title))
    }
    for (const check of within(checks).getAllByRole('button')) {
      expect(check).toHaveAttribute('aria-expanded', 'false')
    }

    expect(
      screen.getByRole('button', {
        name: /settings\.doctor\.checks\.install-version-channel\.title.*settings\.doctor\.status\.pass/
      })
    ).toBeVisible()
    expect(
      within(checks).getByRole('button', { name: /settings\.doctor\.checks\.logs-recent-findings\.title/ })
    ).toBeVisible()
    expect(
      within(checks).getByRole('button', { name: /settings\.doctor\.checks\.network-online\.title/ })
    ).toBeVisible()
    const errorCheck = within(checks).getByRole('button', {
      name: /Provider model.*settings\.doctor\.status\.error/
    })
    const skippedCheck = within(checks).getByRole('button', {
      name: /Default provider API key.*settings\.doctor\.status\.skip/
    })
    expect(errorCheck).toBeVisible()
    expect(skippedCheck).toBeVisible()
    if (errorCheck.getAttribute('aria-expanded') === 'false') await user.click(errorCheck)
    expect(within(checks).getByText('This check could not be completed')).toBeVisible()
    await user.click(skippedCheck)
    expect(within(checks).getByText('Skipped because Provider model did not complete')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'settings.doctor.advanced.title' })).not.toBeInTheDocument()
    expect(screen.queryByText('2.0.0')).not.toBeInTheDocument()
    expect(screen.queryByText('/Users/local/CherryStudio')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'settings.doctor.actions.more' }))

    expect(screen.getByRole('menuitem', { name: 'settings.about.debug.title' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'settings.about.diagnostics.sources.logs.title' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'settings.doctor.basics.data_path' })).toBeVisible()
    await user.keyboard('{Escape}')

    const firstCheck = within(checks).getByRole('button', {
      name: /settings\.doctor\.checks\.permission-accessibility\.title.*settings\.doctor\.status\.warn/
    })
    const failingCheck = within(checks).getByRole('button', {
      name: /settings\.doctor\.checks\.storage-disk-space\.title.*settings\.doctor\.status\.fail/
    })
    expect(firstCheck).toHaveAttribute('aria-expanded', 'false')
    expect(failingCheck).toHaveAttribute('aria-expanded', 'false')

    await user.click(firstCheck)

    expect(firstCheck).toHaveAttribute('aria-expanded', 'true')
    expect(within(checks).getByRole('button', { name: 'settings.doctor.evidence.local_details' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )

    await user.click(failingCheck)

    expect(failingCheck).toHaveAttribute('aria-expanded', 'true')
    expect(firstCheck).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('reclaimableBytes')).toBeVisible()
  })

  it('runs a fix after expanding its check', async () => {
    const user = userEvent.setup()
    mocks.doctorState = completedDoctorState([
      {
        id: 'permission-accessibility',
        status: 'warn',
        durationMs: 1,
        attribution: 'user-fixable',
        detail: { variant: 'denied' },
        actions: [{ kind: 'fix', fixId: 'request' }]
      }
    ])
    mocks.request.mockResolvedValue({ status: 'fixed' })
    render(<PopupHost />)

    act(() => {
      void DoctorPopup.show({ initialPanel: 'checks' })
    })

    await user.click(
      await screen.findByRole('button', { name: /settings\.doctor\.checks\.permission-accessibility\.title/ })
    )
    await user.click(screen.getByRole('button', { name: 'settings.doctor.fixes.request_accessibility' }))

    expect(mocks.request).toHaveBeenCalledWith('diagnostics.doctor.fix', {
      scope: 'global',
      runId: 'completed-quick',
      checkId: 'permission-accessibility',
      fixId: 'request'
    })
  })

  it('blocks every dismiss path while the report panel is busy', async () => {
    const user = userEvent.setup()
    render(<PopupHost />)

    act(() => {
      void DoctorPopup.show({ initialPanel: 'report' })
    })

    const dialog = await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Start report operation' }))

    expect(screen.queryByRole('button', { name: 'common.close' })).not.toBeInTheDocument()
    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(overlay).toBeInTheDocument()
    await user.click(overlay as HTMLElement)
    await user.keyboard('{Escape}')
    expect(dialog).toBeVisible()
  })
})
