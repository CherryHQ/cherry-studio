import type { DoctorState } from '@shared/types/doctor'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  doctorState: { status: 'idle' } as DoctorState,
  request: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn()
}))

vi.mock('@data/hooks/useCache', () => ({
  useSharedCacheValue: () => mocks.doctorState
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

vi.mock('@renderer/hooks/useMcpServer', () => ({
  useMcpServers: () => ({ mcpServers: [] })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (...args: unknown[]) => mocks.request(...args) }
}))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: { withContext: () => ({ error: vi.fn() }) }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: {
    error: (...args: unknown[]) => mocks.toastError(...args),
    success: (...args: unknown[]) => mocks.toastSuccess(...args)
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { useDoctorController } from '../useDoctorController'

describe('useDoctorController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.doctorState = { status: 'idle' }
    mocks.request.mockResolvedValue({ status: 'completed' })
  })

  it('starts one basic check without a partial check list when no result exists', async () => {
    renderHook(() => useDoctorController({ initialPanel: 'checks', onInstallUpdate: vi.fn(), onNavigate: vi.fn() }))

    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('diagnostics.doctor.run', {
        tier: 'quick'
      })
    )
    expect(mocks.request.mock.calls.some(([, input]) => input && 'checkIds' in input)).toBe(false)
  })

  it('switches a report action to the report panel without copying Doctor results into the draft', async () => {
    mocks.doctorState = { status: 'canceled', runId: 'run-1' }
    const { result } = renderHook(() =>
      useDoctorController({
        initialPanel: 'checks',
        initialDescription: 'confirmed safe description',
        onInstallUpdate: vi.fn(),
        onNavigate: vi.fn()
      })
    )

    await act(async () => result.current.executeAction('install-native-modules', { kind: 'report' }))

    expect(result.current.session.activePanel).toBe('report')
    expect(result.current.session.descriptionDraft).toBe('confirmed safe description')
    expect(mocks.request.mock.calls.some(([route]) => String(route).startsWith('diagnostics.bundle.'))).toBe(false)
  })

  it('initializes an empty report draft from only the localized check title and public ID', async () => {
    mocks.doctorState = { status: 'canceled', runId: 'run-1' }
    const { result } = renderHook(() =>
      useDoctorController({ initialPanel: 'checks', onInstallUpdate: vi.fn(), onNavigate: vi.fn() })
    )

    await act(async () => result.current.executeAction('install-native-modules', { kind: 'report' }))

    expect(result.current.session.descriptionDraft).toBe('settings.doctor.report.check_description')
  })

  it('requires inline confirmation for destructive fixes before sending the exact backend request', async () => {
    mocks.doctorState = { status: 'canceled', runId: 'run-1' }
    mocks.request.mockResolvedValue({ status: 'fixed', result: { id: 'storage-disk-space', status: 'pass' } })
    const { result } = renderHook(() =>
      useDoctorController({ initialPanel: 'checks', onInstallUpdate: vi.fn(), onNavigate: vi.fn() })
    )

    await act(async () =>
      result.current.executeAction('storage-disk-space', { kind: 'fix', fixId: 'cleanup' }, 'run-1')
    )
    expect(result.current.session.interaction.kind).toBe('confirm-fix')
    expect(mocks.request).not.toHaveBeenCalledWith('diagnostics.doctor.fix', expect.anything())

    await act(async () => result.current.confirmFix())

    expect(mocks.request).toHaveBeenCalledWith('diagnostics.doctor.fix', {
      runId: 'run-1',
      checkId: 'storage-disk-space',
      fixId: 'cleanup'
    })
    expect(result.current.session.interaction.kind).toBe('idle')
  })

  it('runs low-risk fixes directly and keeps the backend result authoritative', async () => {
    mocks.doctorState = { status: 'canceled', runId: 'run-1' }
    mocks.request.mockResolvedValue({
      status: 'requires_relaunch',
      result: { id: 'permission-screen-capture', status: 'pass', durationMs: 1 }
    })
    const { result } = renderHook(() =>
      useDoctorController({ initialPanel: 'checks', onInstallUpdate: vi.fn(), onNavigate: vi.fn() })
    )

    await act(async () =>
      result.current.executeAction('permission-screen-capture', { kind: 'fix', fixId: 'request' }, 'run-1')
    )

    expect(mocks.request).toHaveBeenCalledWith('diagnostics.doctor.fix', {
      runId: 'run-1',
      checkId: 'permission-screen-capture',
      fixId: 'request'
    })
    expect(result.current.viewModel.rows).toEqual([])
    expect(result.current.session.relaunchRequired).toBe(true)
    expect(mocks.toastSuccess).toHaveBeenCalledWith('settings.doctor.messages.relaunch_required')
  })

  it('offers cancellation only for a network and service run', async () => {
    mocks.doctorState = {
      status: 'running',
      runId: 'run-1',
      tier: 'quick',
      startedAt: '2026-09-04T08:59:00.000Z',
      results: []
    }
    const quick = renderHook(() =>
      useDoctorController({ initialPanel: 'checks', onInstallUpdate: vi.fn(), onNavigate: vi.fn() })
    )

    await act(async () => quick.result.current.cancel())
    expect(mocks.request).not.toHaveBeenCalledWith('diagnostics.doctor.cancel', expect.anything())
    quick.unmount()

    mocks.doctorState = { ...mocks.doctorState, tier: 'live' }
    const live = renderHook(() =>
      useDoctorController({ initialPanel: 'checks', onInstallUpdate: vi.fn(), onNavigate: vi.fn() })
    )
    await act(async () => live.result.current.cancel())

    expect(mocks.request).toHaveBeenCalledWith('diagnostics.doctor.cancel', { runId: 'run-1' })
  })

  it('opens the displayed app data directory without copying it into Doctor state', async () => {
    mocks.doctorState = { status: 'canceled', runId: 'run-1' }
    const { result } = renderHook(() =>
      useDoctorController({ initialPanel: 'checks', onInstallUpdate: vi.fn(), onNavigate: vi.fn() })
    )

    await act(async () => result.current.openPath('/Users/local/CherryStudio'))

    expect(mocks.request).toHaveBeenCalledWith('system.shell.open_path', '/Users/local/CherryStudio')
    expect(result.current.session.interaction).toEqual({ kind: 'idle' })
  })

  it('opens the existing application logs directory from the advanced tools', async () => {
    mocks.doctorState = { status: 'canceled', runId: 'run-1' }
    mocks.request.mockImplementation(async (route: string) =>
      route === 'app.get_info' ? { logsPath: '/Users/local/CherryStudio/logs' } : undefined
    )
    const { result } = renderHook(() =>
      useDoctorController({ initialPanel: 'checks', onInstallUpdate: vi.fn(), onNavigate: vi.fn() })
    )

    await act(async () => result.current.openLogsPath())

    expect(mocks.request).toHaveBeenCalledWith('app.get_info')
    expect(mocks.request).toHaveBeenCalledWith('system.shell.open_path', '/Users/local/CherryStudio/logs')
  })
})
