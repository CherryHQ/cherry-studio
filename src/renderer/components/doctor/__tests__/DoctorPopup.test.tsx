import '@testing-library/jest-dom/vitest'

import { popupService } from '@renderer/services/popup'
import type { DoctorState } from '@shared/types/doctor'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChangeEvent } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@cherrystudio/ui')

const mocks = vi.hoisted(() => ({
  doctorState: { status: 'canceled', runId: 'run-1' } as DoctorState,
  request: vi.fn(),
  translations: {
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
  const DiagnosticUploadPanel = ({ ref, description, onBusyChange, onDescriptionChange }) => {
    React.useImperativeHandle(ref, () => ({ requestClose: async () => true }))
    return React.createElement(
      React.Fragment,
      null,
      React.createElement('textarea', {
        'aria-label': 'settings.about.diagnostics.report.description_label',
        value: description,
        onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onDescriptionChange(event.target.value)
      }),
      React.createElement('button', { type: 'button', onClick: () => onBusyChange?.(true) }, 'Start report operation')
    )
  }
  return { DiagnosticUploadPanel }
})

vi.mock('@renderer/components/feedback/DiagnosticBundlePanel', () => ({
  default: () => <div>settings.doctor.panels.export</div>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      mocks.translations[key] ??
      (key === 'settings.doctor.confirm_fix.reclaimable'
        ? `settings.doctor.confirm_fix.reclaimable ${String(params?.size)}`
        : key)
  })
}))

import { PopupHost } from '@renderer/components/PopupHost'

import DoctorPopup from '../DoctorPopup'

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
    mocks.doctorState = { status: 'canceled', runId: 'run-1' }
    mocks.request.mockResolvedValue(undefined)
  })

  it('sizes secondary panels to their content within the viewport cap', async () => {
    render(<PopupHost />)

    act(() => {
      void DoctorPopup.show({ initialPanel: 'report' })
    })

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveClass('max-h-[calc(100vh-2rem)]')
    expect(dialog).not.toHaveClass('h-[min(760px,calc(100vh-2rem))]')
  })

  it('renders secondary-panel back navigation as an accessible icon-only action', async () => {
    const user = userEvent.setup()
    render(<PopupHost />)

    act(() => {
      void DoctorPopup.show({ initialPanel: 'report' })
    })

    const backButton = await screen.findByRole('button', { name: 'settings.doctor.actions.back_to_checks' })
    expect(backButton).toHaveTextContent(/^$/)

    await user.hover(backButton)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('settings.doctor.actions.back_to_checks')
  })

  it('keeps the editable report draft while navigating panels', async () => {
    const user = userEvent.setup()
    render(<PopupHost />)

    act(() => {
      void DoctorPopup.show({ initialPanel: 'report', initialDescription: 'safe first draft' })
    })

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(
      await screen.findByRole('textbox', { name: 'settings.about.diagnostics.report.description_label' })
    ).toHaveValue('safe first draft')

    await user.type(
      screen.getByRole('textbox', { name: 'settings.about.diagnostics.report.description_label' }),
      ' reviewed'
    )
    await user.click(screen.getByRole('button', { name: 'settings.doctor.actions.back_to_checks' }))
    await waitFor(() =>
      expect(screen.getByText('settings.doctor.panel_descriptions.checks').parentElement).toHaveFocus()
    )
    await user.click(screen.getByRole('button', { name: 'settings.doctor.actions.more' }))
    await user.click(screen.getByRole('menuitem', { name: 'settings.doctor.actions.report_problem' }))

    expect(screen.getByRole('textbox', { name: 'settings.about.diagnostics.report.description_label' })).toHaveValue(
      'safe first draft reviewed'
    )
  })

  it('announces whether quick basic checks or full checks are running', async () => {
    mocks.doctorState = {
      status: 'running',
      runId: 'quick-run',
      tier: 'quick',
      startedAt: new Date().toISOString(),
      results: []
    }
    const view = render(<PopupHost />)

    act(() => {
      void DoctorPopup.show({ initialPanel: 'checks' })
    })

    expect(await screen.findByText('Running quick basic checks…')).toBeVisible()

    mocks.doctorState = { ...mocks.doctorState, runId: 'full-run', tier: 'live' }
    view.rerender(<PopupHost />)

    expect(await screen.findByText('Running full checks, including network and services…')).toBeVisible()
  })

  it('renders backend findings safely and confirms a destructive fix inside the Doctor dialog', async () => {
    const user = userEvent.setup()
    mocks.doctorState = {
      status: 'completed',
      report: {
        schemaVersion: 1,
        runId: 'run-2',
        tier: 'quick',
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
              { key: 'diagnosticDataBytes', value: 220 * 1024 * 1024, dataClass: 'public' }
            ],
            actions: [{ kind: 'fix', fixId: 'cleanup' }]
          },
          {
            id: 'logs-recent-findings',
            status: 'error',
            durationMs: 1,
            message: 'secret backend failure'
          }
        ],
        summary: { pass: 1, warn: 0, fail: 1, skip: 0, error: 1 }
      }
    }
    mocks.request.mockResolvedValue({
      status: 'fixed',
      result: { id: 'storage-disk-space', status: 'pass', durationMs: 1 }
    })
    render(<PopupHost />)

    act(() => {
      void DoctorPopup.show({ initialPanel: 'checks' })
    })

    expect(await screen.findByRole('button', { name: /settings\.doctor\.domains\.storage/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    const healthyGroup = screen.getByRole('button', { name: /settings\.doctor\.domains\.install/ })
    expect(healthyGroup).toHaveAttribute('aria-expanded', 'false')
    await user.click(healthyGroup)
    const healthyCheck = screen
      .getByText('settings.doctor.checks.install-version-channel.title')
      .closest('[data-ui="doctor.check-row"]')
    expect(healthyCheck).not.toBeNull()
    expect(within(healthyCheck as HTMLElement).getAllByText('settings.doctor.status.pass')[0]).toBeVisible()

    await user.click(await screen.findByRole('button', { name: 'settings.doctor.fixes.cleanup_storage' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent('settings.doctor.confirm_fix.title')
    expect(screen.getByRole('status')).toHaveTextContent('settings.doctor.confirm_fix.storage_disk_space_scope')
    expect(screen.getByRole('status')).toHaveTextContent('settings.doctor.confirm_fix.reclaimable 300 MB')
    expect(screen.getByRole('status')).toHaveTextContent('settings.doctor.confirm_fix.irreversible')
    expect(screen.getByRole('status')).toHaveTextContent('settings.doctor.confirm_fix.duration')
    expect(screen.getByRole('status').closest('[tabindex="-1"]')).toHaveFocus()
    expect(screen.queryByText('secret backend failure')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'settings.doctor.fixes.cleanup_storage' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'settings.doctor.fixes.cleanup_storage' })).toHaveFocus()
    )
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
