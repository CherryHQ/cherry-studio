import type { DoctorState } from '@shared/types/doctor'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cacheReady: true,
  doctorState: { status: 'idle' } as DoctorState | undefined,
  readyListeners: new Set<() => void>(),
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
  request: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn()
}))

vi.mock('@data/CacheService', () => ({
  cacheService: {
    isSharedCacheReady: () => mocks.cacheReady,
    onSharedCacheReady: (listener: () => void) => {
      mocks.readyListeners.add(listener)
      return () => mocks.readyListeners.delete(listener)
    }
  }
}))

vi.mock('@data/hooks/useCache', () => ({
  useSharedCacheValue: () => mocks.doctorState
}))

vi.mock('@renderer/hooks/useAppUpdateState', () => ({
  useAppUpdateState: () => ({ appUpdateState: mocks.appUpdateState })
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

function completedDoctorState(): DoctorState {
  const now = Date.now()
  return {
    status: 'completed',
    report: {
      schemaVersion: 1,
      runId: 'completed-run',
      tier: 'quick',
      startedAt: new Date(now - 1_000).toISOString(),
      finishedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
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
        userDataPath: '/tmp/cherry'
      },
      results: [],
      summary: { pass: 0, warn: 0, fail: 0, skip: 0, error: 0 }
    }
  }
}

describe('useDoctorController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.cacheReady = true
    mocks.doctorState = { status: 'idle' }
    mocks.readyListeners.clear()
    Object.assign(mocks.appUpdateState, { downloaded: false, info: null })
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

  it('waits for shared-cache hydration before deciding that no report exists', async () => {
    mocks.cacheReady = false
    mocks.doctorState = undefined
    const { rerender } = renderHook(() =>
      useDoctorController({ initialPanel: 'checks', onInstallUpdate: vi.fn(), onNavigate: vi.fn() })
    )

    expect(mocks.request).not.toHaveBeenCalledWith('diagnostics.doctor.run', expect.anything())

    mocks.doctorState = {
      status: 'completed',
      report: {
        schemaVersion: 1,
        runId: 'hydrated-run',
        tier: 'quick',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
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
          userDataPath: '/tmp/cherry'
        },
        results: [],
        summary: { pass: 0, warn: 0, fail: 0, skip: 0, error: 0 }
      }
    }
    mocks.cacheReady = true
    act(() => mocks.readyListeners.forEach((listener) => listener()))
    rerender()

    await waitFor(() => expect(mocks.request).not.toHaveBeenCalledWith('diagnostics.doctor.run', expect.anything()))
  })

  it('runs one basic check when an embedded host opens over a completed run', async () => {
    mocks.doctorState = completedDoctorState()
    const options = {
      autoRunPolicy: 'when-not-running' as const,
      initialPanel: 'checks' as const,
      onInstallUpdate: vi.fn(),
      onNavigate: vi.fn()
    }
    const { rerender } = renderHook(() => useDoctorController(options))

    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('diagnostics.doctor.run', {
        tier: 'quick'
      })
    )
    rerender()
    expect(mocks.request.mock.calls.filter(([route]) => route === 'diagnostics.doctor.run')).toHaveLength(1)
  })

  it('observes an active shared run without replacing it', async () => {
    mocks.doctorState = {
      status: 'running',
      runId: 'shared-live',
      tier: 'live',
      startedAt: new Date().toISOString(),
      results: []
    }

    renderHook(() =>
      useDoctorController({
        autoRunPolicy: 'when-not-running',
        initialPanel: 'checks',
        onInstallUpdate: vi.fn(),
        onNavigate: vi.fn()
      })
    )

    await act(async () => {})
    expect(mocks.request).not.toHaveBeenCalledWith('diagnostics.doctor.run', expect.anything())
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

  it('hands a report action to an embedded host without changing panels', async () => {
    mocks.doctorState = { status: 'canceled', runId: 'run-1' }
    const onReportProblem = vi.fn()
    const { result } = renderHook(() =>
      useDoctorController({
        initialPanel: 'checks',
        onInstallUpdate: vi.fn(),
        onNavigate: vi.fn(),
        onReportProblem
      })
    )

    await act(async () => result.current.executeAction('logs-recent-findings', { kind: 'report' }, 'run-1'))

    expect(onReportProblem).toHaveBeenCalledWith('settings.doctor.report.check_description')
    expect(result.current.session.activePanel).toBe('checks')
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

  it('executes every non-fix backend action with its exact public contract', async () => {
    mocks.doctorState = { status: 'canceled', runId: 'run-1' }
    const onNavigate = vi.fn()
    const onInstallUpdate = vi.fn()
    const releaseInfo = { version: '2.1.0' }
    Object.assign(mocks.appUpdateState, { downloaded: true, info: releaseInfo })
    const { result } = renderHook(() => useDoctorController({ initialPanel: 'checks', onInstallUpdate, onNavigate }))

    await act(async () =>
      result.current.executeAction('provider-api-key-present', { kind: 'navigate', target: 'provider' })
    )
    await act(async () =>
      result.current.executeAction('network-endpoint-update', {
        kind: 'open_external',
        url: 'https://cherry-ai.com/status'
      })
    )
    await act(async () => result.current.executeAction('provider-cherry-account', { kind: 'open_cherry_account' }))
    await act(async () => result.current.executeAction('install-update-available', { kind: 'install_update' }))
    await act(async () => result.current.executeAction('config-hardware-acceleration', { kind: 'relaunch' }))

    expect(onNavigate).toHaveBeenCalledWith('provider')
    expect(mocks.request).toHaveBeenCalledWith('system.shell.open_website', 'https://cherry-ai.com/status')
    expect(mocks.request).toHaveBeenCalledWith('cherry_cloud.login.start')
    expect(onInstallUpdate).toHaveBeenCalledWith(releaseInfo)
    expect(mocks.request).toHaveBeenCalledWith('app.relaunch')
  })
})
