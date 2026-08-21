import { CodeCli } from '@shared/types/codeCli'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openSmartMiniApp: vi.fn(),
  request: vi.fn()
}))

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
    mocks.request.mockImplementation((route: string) => {
      if (route === 'hermes_dashboard.start') return Promise.resolve({ success: true, url: 'http://127.0.0.1:49152' })
      if (route === 'hermes_dashboard.get_status') return Promise.resolve({ status: 'stopped' })
      if (route === 'hermes_dashboard.stop') return Promise.resolve({ success: true })
      throw new Error(`Unexpected IPC route: ${route}`)
    })
    vi.spyOn(Date, 'now').mockReturnValue(1_774_560_000_000)
  })

  afterEach(() => vi.restoreAllMocks())

  it('starts and opens the Dashboard without a confirmation prompt', async () => {
    const { result } = renderHook(() => useHermesDashboardController(CodeCli.HERMES))

    await act(async () => {
      await result.current.onLaunch()
    })

    expect(mocks.request).toHaveBeenCalledWith('hermes_dashboard.start')
    expect(mocks.openSmartMiniApp).toHaveBeenCalledWith({
      appId: 'hermes-dashboard',
      name: 'Hermes',
      url: 'http://127.0.0.1:49152/?cherry_navigation_revision=1774560000000',
      logo: 'nousresearch'
    })
  })

  it('refreshes Dashboard status only while Hermes is selected', async () => {
    renderHook(() => useHermesDashboardController(CodeCli.HERMES))

    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('hermes_dashboard.get_status'))
    mocks.request.mockClear()

    renderHook(() => useHermesDashboardController(CodeCli.PI))

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mocks.request).not.toHaveBeenCalled()
  })
})
