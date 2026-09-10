import { cacheService } from '@data/CacheService'
import { CodeCli } from '@shared/types/codeCli'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ openSmartMiniApp: vi.fn(), request: vi.fn() }))

vi.mock('@data/hooks/useCache', async (importOriginal) => importOriginal())
vi.mock('@renderer/hooks/useMiniAppPopup', () => ({
  useMiniAppPopup: () => ({ openSmartMiniApp: mocks.openSmartMiniApp })
}))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))
vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: { withContext: () => ({ error: vi.fn() }) }
}))
vi.mock('@renderer/services/toast', () => ({ toast: { error: vi.fn() } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const { useHermesDashboardController } = await import('../useHermesDashboardController')

describe('useHermesDashboardController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cacheService.deleteShared('feature.hermes_dashboard.status')
    mocks.request.mockImplementation((route: string) => {
      if (route === 'hermes_dashboard.start') return Promise.resolve({ success: true, url: 'http://127.0.0.1:49152' })
      if (route === 'hermes_dashboard.stop') return Promise.resolve({ success: true })
      throw new Error(`Unexpected IPC route: ${route}`)
    })
    vi.spyOn(Date, 'now').mockReturnValue(1_774_560_000_000)
  })

  afterEach(() => vi.restoreAllMocks())

  it('starts and opens the Dashboard through command IPC', async () => {
    const { result } = renderHook(() => useHermesDashboardController(CodeCli.HERMES))

    await act(async () => result.current.onLaunch())

    expect(mocks.request).toHaveBeenCalledWith('hermes_dashboard.start')
    expect(mocks.openSmartMiniApp).toHaveBeenCalledWith({
      appId: 'hermes-dashboard',
      name: 'code.cli_tools.hermes',
      url: 'http://127.0.0.1:49152/?cherry_navigation_revision=1774560000000',
      logo: 'nousresearch'
    })
  })

  it('does not open a launch result superseded by stop', async () => {
    let resolveStart!: (value: { success: true; url: string }) => void
    mocks.request.mockImplementation((route: string) => {
      if (route === 'hermes_dashboard.start') return new Promise((resolve) => (resolveStart = resolve))
      if (route === 'hermes_dashboard.stop') return Promise.resolve({ success: true })
      throw new Error(`Unexpected IPC route: ${route}`)
    })
    const { result } = renderHook(() => useHermesDashboardController(CodeCli.HERMES))

    let start!: Promise<void>
    await act(async () => {
      start = result.current.onLaunch()
      await Promise.resolve()
    })
    await act(async () => result.current.onStop())
    resolveStart({ success: true, url: 'http://127.0.0.1:49152' })
    await act(async () => start)

    expect(mocks.openSmartMiniApp).not.toHaveBeenCalled()
    expect(result.current.launching).toBe(false)
  })

  it('opens the URL from the shared snapshot', async () => {
    cacheService.setShared('feature.hermes_dashboard.status', {
      status: 'running',
      url: 'http://127.0.0.1:49153'
    })
    const { result } = renderHook(() => useHermesDashboardController(CodeCli.HERMES))

    await act(async () => result.current.onOpenDashboard())

    expect(mocks.openSmartMiniApp).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'http://127.0.0.1:49153/?cherry_navigation_revision=1774560000000' })
    )
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('reflects shared status and reloads config when a run ends', () => {
    const reload = vi.fn()
    cacheService.setShared('feature.hermes_dashboard.status', { status: 'running' })
    const { result } = renderHook(() =>
      useHermesDashboardController(CodeCli.HERMES, { onConfigMayHaveChanged: reload })
    )

    expect(result.current.running).toBe(true)
    act(() => cacheService.setShared('feature.hermes_dashboard.status', { status: 'error' }))
    expect(result.current.running).toBe(false)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads config after an in-band start failure', async () => {
    const reload = vi.fn()
    mocks.request.mockResolvedValue({
      success: false,
      reason: 'dashboard_dependencies_missing',
      message: 'Hermes Dashboard dependencies are missing'
    })
    const { result } = renderHook(() =>
      useHermesDashboardController(CodeCli.HERMES, { onConfigMayHaveChanged: reload })
    )

    await act(async () => result.current.onLaunch())

    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads config after a successful stop', async () => {
    const reload = vi.fn()
    const { result } = renderHook(() =>
      useHermesDashboardController(CodeCli.HERMES, { onConfigMayHaveChanged: reload })
    )

    await act(async () => result.current.onStop())

    expect(reload).toHaveBeenCalledOnce()
  })
})
