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
  useTranslation: () => ({ t: (key: string) => key })
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

  it('keeps the first panel and editable draft when a second entry opens during the same flight', async () => {
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
    await user.click(screen.getByRole('button', { name: 'settings.doctor.panels.checks' }))
    await user.click(screen.getByRole('button', { name: 'settings.doctor.panels.report' }))

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
            id: 'storage-disk-space',
            status: 'fail',
            durationMs: 1,
            attribution: 'user-fixable',
            detail: { variant: 'low' },
            actions: [{ kind: 'fix', fixId: 'cleanup' }]
          },
          {
            id: 'logs-recent-findings',
            status: 'error',
            durationMs: 1,
            message: 'secret backend failure'
          }
        ],
        summary: { pass: 0, warn: 0, fail: 1, skip: 0, error: 1 }
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

    await user.click(await screen.findByRole('button', { name: 'settings.doctor.fixes.cleanup_storage' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent('settings.doctor.confirm_fix.title')
    expect(screen.queryByText('secret backend failure')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'settings.doctor.fixes.cleanup_storage' }))
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('diagnostics.doctor.fix', {
        runId: 'run-2',
        checkId: 'storage-disk-space',
        fixId: 'cleanup'
      })
    )
  })
})
