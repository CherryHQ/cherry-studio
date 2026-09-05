import '@testing-library/jest-dom/vitest'

import { popupService } from '@renderer/services/popup'
import type { DoctorState } from '@shared/types/doctor'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChangeEvent } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  doctorState: { status: 'canceled', runId: 'run-1' } as DoctorState,
  request: vi.fn()
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

vi.mock('@renderer/components/feedback/DiagnosticUploadDialog', () => {
  const React = require('react')
  const DiagnosticUploadDialog = ({ ref, description, onDescriptionChange, open }) => {
    React.useImperativeHandle(ref, () => ({ requestClose: async () => true }))
    return open
      ? React.createElement('textarea', {
          'aria-label': 'settings.about.diagnostics.report.description_label',
          value: description,
          onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onDescriptionChange(event.target.value)
        })
      : null
  }
  return { DiagnosticUploadDialog }
})

vi.mock('@renderer/components/feedback/DiagnosticBundleDialog', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div>settings.doctor.panels.export</div> : null)
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      key === 'settings.doctor.confirm_fix.reclaimable'
        ? `settings.doctor.confirm_fix.reclaimable ${String(params?.size)}`
        : key
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

  it('keeps the first panel and editable draft without exposing permanent panel navigation', async () => {
    const user = userEvent.setup()
    render(<PopupHost />)

    let first!: Promise<Record<string, never>>
    let second!: Promise<Record<string, never>>
    act(() => {
      first = DoctorPopup.show({ initialPanel: 'report', initialDescription: 'safe first draft' })
      second = DoctorPopup.show({ initialPanel: 'checks', initialDescription: 'must be ignored' })
    })

    expect(second).toBe(first)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'settings.about.diagnostics.report.description_label' })).toHaveValue(
      'safe first draft'
    )

    await user.type(
      screen.getByRole('textbox', { name: 'settings.about.diagnostics.report.description_label' }),
      ' reviewed'
    )
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'settings.doctor.actions.back_to_checks' }))
    await waitFor(() =>
      expect(screen.getByText('settings.doctor.panel_descriptions.checks').parentElement).toHaveFocus()
    )
    await user.click(screen.getByRole('button', { name: 'settings.doctor.actions.more' }))
    await user.click(screen.getByRole('button', { name: 'settings.doctor.actions.report_problem' }))

    expect(screen.getByRole('textbox', { name: 'settings.about.diagnostics.report.description_label' })).toHaveValue(
      'safe first draft reviewed'
    )

    act(() => {
      const [entry] = popupService.getSnapshot()
      if (entry) popupService.settle(entry.instanceId, {})
    })
    await expect(first).resolves.toEqual({})
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
    expect(screen.getByText('settings.doctor.checks.install-version-channel.title')).toBeVisible()

    await user.click(await screen.findByRole('button', { name: 'settings.doctor.fixes.cleanup_storage' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent('settings.doctor.confirm_fix.title')
    expect(screen.getByRole('alert')).toHaveTextContent('settings.doctor.confirm_fix.storage_disk_space_scope')
    expect(screen.getByRole('alert')).toHaveTextContent('settings.doctor.confirm_fix.reclaimable 300 MB')
    expect(screen.getByRole('alert')).toHaveTextContent('settings.doctor.confirm_fix.irreversible')
    expect(screen.getByRole('alert')).toHaveTextContent('settings.doctor.confirm_fix.duration')
    expect(screen.getByRole('alert').closest('[tabindex="-1"]')).toHaveFocus()
    expect(screen.queryByText('secret backend failure')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'settings.doctor.fixes.cleanup_storage' }))
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('diagnostics.doctor.fix', {
        runId: 'run-2',
        checkId: 'storage-disk-space',
        fixId: 'cleanup'
      })
    )
    expect(screen.getByRole('button', { name: 'settings.doctor.fixes.cleanup_storage' })).toHaveFocus()
  })

  it('masks consent-required evidence and reveals it in place after confirmation', async () => {
    const user = userEvent.setup()
    mocks.doctorState = {
      status: 'completed',
      report: {
        schemaVersion: 1,
        runId: 'run-sensitive',
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
            id: 'logs-recent-findings',
            status: 'warn',
            durationMs: 1,
            attribution: 'app-bug',
            detail: { variant: 'findings' },
            evidence: [{ key: 'request-body', value: 'private response', dataClass: 'consent_required' }],
            actions: []
          }
        ],
        summary: { pass: 0, warn: 1, fail: 0, skip: 0, error: 0 }
      }
    }
    render(<PopupHost />)

    act(() => {
      void DoctorPopup.show({ initialPanel: 'checks' })
    })

    const details = await screen.findByText('settings.doctor.evidence.local_details')
    await user.click(details)
    expect(screen.queryByText('private response')).not.toBeInTheDocument()
    expect(screen.getByText('••••••')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'settings.doctor.actions.show_details' }))
    await user.click(screen.getByRole('button', { name: 'settings.doctor.actions.show_details' }))

    const revealed = await screen.findByText('private response')
    expect(details.closest('details')).toHaveAttribute('open')
    expect(revealed.closest('dl')).toHaveFocus()
  })
})
