import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CodeCli } from '@shared/types/codeCli'

const mocks = vi.hoisted(() => ({
  openSmartMiniApp: vi.fn(),
  request: vi.fn(),
  handlers: new Map<string, (payload: unknown) => void>()
}))

vi.mock('@renderer/hooks/useMiniAppPopup', () => ({
  useMiniAppPopup: () => ({ openSmartMiniApp: mocks.openSmartMiniApp })
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.request },
  useIpcOn: (event: string, handler: (payload: unknown) => void) => mocks.handlers.set(event, handler)
}))
vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: { withContext: () => ({ error: vi.fn() }) }
}))
vi.mock('@renderer/services/toast', () => ({ toast: { error: vi.fn() } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const { useHermesDashboardController } = await import('../useHermesDashboardController')

describe('useHermesDashboardController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
    mocks.request.mockImplementation((route: string) => {
      if (route === 'hermes_dashboard.start') return Promise.resolve({ success: true, url: 'http://127.0.0.1:49152' })
      if (route === 'hermes_dashboard.get_status') return Promise.resolve({ status: 'stopped' })
      if (route === 'hermes_dashboard.stop') return Promise.resolve({ success: true })
      throw new Error(`Unexpected IPC route: ${route}`)
    })
    vi.spyOn(Date, 'now').mockReturnValue(1_774_560_000_000)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('starts and opens the Dashboard without a confirmation prompt', async () => {
    const { result } = renderHook(() => useHermesDashboardController(CodeCli.HERMES))

    await act(async () => {
      await result.current.onLaunch()
    })

    expect(mocks.request).toHaveBeenCalledWith('hermes_dashboard.start')
    expect(mocks.openSmartMiniApp).toHaveBeenCalledWith({
      appId: 'hermes-dashboard',
      name: 'code.cli_tools.hermes',
      url: 'http://127.0.0.1:49152/?cherry_navigation_revision=1774560000000',
      logo: 'nousresearch'
    })
  })

  it('clears busy state when a pending launch is superseded by stop', async () => {
    let resolveStart: ((value: { success: true; url: string }) => void) | undefined
    mocks.request.mockImplementation((route: string) => {
      if (route === 'hermes_dashboard.get_status') return Promise.resolve({ status: 'stopped' })
      if (route === 'hermes_dashboard.start') {
        return new Promise((resolve) => {
          resolveStart = resolve
        })
      }
      if (route === 'hermes_dashboard.stop') return Promise.resolve({ success: true })
      throw new Error(`Unexpected IPC route: ${route}`)
    })
    const { result } = renderHook(() => useHermesDashboardController(CodeCli.HERMES))

    let start: Promise<void>
    await act(async () => {
      start = result.current.onLaunch()
      await Promise.resolve()
    })
    expect(result.current.launching).toBe(true)

    await act(async () => {
      await result.current.onStop()
    })
    expect(result.current.launching).toBe(false)
    expect(result.current.stopping).toBe(false)

    resolveStart?.({ success: true, url: 'http://127.0.0.1:49152' })
    await act(async () => {
      await start
    })
    expect(result.current.launching).toBe(false)
    expect(result.current.stopping).toBe(false)
    // The superseded start must not revive running or open the Web UI after the stop.
    expect(result.current.running).toBe(false)
    expect(mocks.openSmartMiniApp).not.toHaveBeenCalled()
  })

  it('clears busy state when a pending stop is superseded by launch', async () => {
    let resolveStop: ((value: { success: true }) => void) | undefined
    mocks.request.mockImplementation((route: string) => {
      if (route === 'hermes_dashboard.get_status') return Promise.resolve({ status: 'stopped' })
      if (route === 'hermes_dashboard.start') return Promise.resolve({ success: true, url: 'http://127.0.0.1:49152' })
      if (route === 'hermes_dashboard.stop') {
        return new Promise((resolve) => {
          resolveStop = resolve
        })
      }
      throw new Error(`Unexpected IPC route: ${route}`)
    })
    const { result } = renderHook(() => useHermesDashboardController(CodeCli.HERMES))

    let stop: Promise<boolean>
    await act(async () => {
      stop = result.current.onStop()
      await Promise.resolve()
    })
    expect(result.current.stopping).toBe(true)

    await act(async () => {
      await result.current.onLaunch()
    })
    expect(result.current.launching).toBe(false)
    expect(result.current.stopping).toBe(false)

    resolveStop?.({ success: true })
    await act(async () => {
      await stop
    })
    expect(result.current.launching).toBe(false)
    expect(result.current.stopping).toBe(false)
  })

  it('uses the authoritative Dashboard URL when reopening after another window restarts it', async () => {
    const { result } = renderHook(() => useHermesDashboardController(CodeCli.HERMES))

    await act(async () => {
      await result.current.onLaunch()
    })
    mocks.openSmartMiniApp.mockClear()
    mocks.request.mockImplementation((route: string) => {
      if (route === 'hermes_dashboard.get_status')
        return Promise.resolve({ status: 'running', url: 'http://127.0.0.1:49153' })
      throw new Error(`Unexpected IPC route: ${route}`)
    })

    await act(async () => {
      await result.current.onOpenDashboard()
    })

    expect(mocks.request).toHaveBeenCalledWith('hermes_dashboard.get_status')
    expect(mocks.openSmartMiniApp).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'http://127.0.0.1:49153/?cherry_navigation_revision=1774560000000' })
    )
  })

  it('ignores a stale status response after a newer launch succeeds', async () => {
    let resolveStatus: ((status: { status: 'stopped'; url?: string }) => void) | undefined
    mocks.request.mockImplementation((route: string) => {
      if (route === 'hermes_dashboard.get_status') {
        return new Promise((resolve) => {
          resolveStatus = resolve
        })
      }
      if (route === 'hermes_dashboard.start') return Promise.resolve({ success: true, url: 'http://127.0.0.1:49152' })
      throw new Error(`Unexpected IPC route: ${route}`)
    })
    const { result } = renderHook(() => useHermesDashboardController(CodeCli.HERMES))

    await act(async () => {
      await result.current.onLaunch()
    })
    await act(async () => {
      resolveStatus?.({ status: 'stopped' })
      await Promise.resolve()
    })

    expect(result.current.running).toBe(true)
  })

  it('reloads config when startup fails after the service cleanup completes', async () => {
    const reload = vi.fn()
    mocks.request.mockImplementation((route: string) => {
      if (route === 'hermes_dashboard.get_status') return Promise.resolve({ status: 'stopped' })
      if (route === 'hermes_dashboard.start') {
        return Promise.resolve({
          success: false,
          reason: 'dashboard_dependencies_missing',
          message: 'Hermes Dashboard dependencies are missing'
        })
      }
      throw new Error(`Unexpected IPC route: ${route}`)
    })
    const { result } = renderHook(() =>
      useHermesDashboardController(CodeCli.HERMES, { onConfigMayHaveChanged: reload })
    )

    await act(async () => {
      await result.current.onLaunch()
    })

    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads config after a successful stop even when the local status is not running', async () => {
    const reload = vi.fn()
    const { result } = renderHook(() =>
      useHermesDashboardController(CodeCli.HERMES, { onConfigMayHaveChanged: reload })
    )

    await act(async () => {
      await result.current.onStop()
    })

    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads config after a successful stop', async () => {
    const reload = vi.fn()
    const { result } = renderHook(() =>
      useHermesDashboardController(CodeCli.HERMES, { onConfigMayHaveChanged: reload })
    )

    await act(async () => {
      await result.current.onLaunch()
      await result.current.onStop()
    })

    expect(reload).toHaveBeenCalledOnce()
  })

  it('refreshes Dashboard status only while Hermes is selected', async () => {
    vi.useFakeTimers()
    const { rerender } = renderHook(({ tool }) => useHermesDashboardController(tool), {
      initialProps: { tool: CodeCli.HERMES }
    })

    await act(async () => {
      await Promise.resolve()
    })
    mocks.request.mockClear()
    rerender({ tool: CodeCli.PI })

    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    expect(mocks.request).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
