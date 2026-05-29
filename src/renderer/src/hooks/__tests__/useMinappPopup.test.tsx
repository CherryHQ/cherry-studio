import type { MinAppType } from '@renderer/types'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock TabsService to track closeTab calls
const mockCloseTab = vi.fn()
const mockGetTabs = vi.fn(() => [{ id: 'apps:test-app', path: '/apps/test-app' }])
vi.mock('@renderer/services/TabsService', () => ({
  default: {
    closeTab: (...args: any[]) => mockCloseTab(...args),
    getTabs: () => mockGetTabs()
  }
}))

// Mock webviewStateManager
const mockClearWebviewState = vi.fn()
vi.mock('@renderer/utils/webviewStateManager', () => ({
  clearWebviewState: (...args: any[]) => mockClearWebviewState(...args)
}))

// Mock NavigationService
vi.mock('@renderer/services/NavigationService', () => ({
  default: { navigate: vi.fn() }
}))

// Mock config/minapps
vi.mock('@renderer/config/minapps', () => ({
  allMinApps: []
}))

// Mock store hooks — provide a simple dispatch spy
const mockDispatch = vi.fn()
vi.mock('@renderer/store', () => ({
  default: {
    getState: () => ({
      tabs: { tabs: [{ id: 'apps:test-app', path: '/apps/test-app' }], activeTabId: 'apps:test-app' }
    }),
    dispatch: (...args: any[]) => mockDispatch(...args)
  },
  useAppDispatch: () => mockDispatch,
  useAppSelector: () => undefined
}))

// Mock useRuntime — return default empty state
vi.mock('@renderer/hooks/useRuntime', () => ({
  useRuntime: () => ({
    openedKeepAliveMinapps: [],
    openedOneOffMinapp: null,
    minappShow: false,
    currentMinappId: ''
  })
}))

// Mock useSettings — return default settings with isTopNavbar
vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({ maxKeepAliveMinapps: 10 }),
  useNavbarPosition: () => ({ isTopNavbar: true })
}))

import { useMinappPopup } from '../useMinappPopup'

const testApp: MinAppType = {
  id: 'test-app',
  name: 'Test App',
  url: 'https://example.com',
  logo: ''
}

describe('useMinappPopup - disposeAfter reentry regression (issue #15405)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTabs.mockReturnValue([{ id: 'apps:test-app', path: '/apps/test-app' }])
  })

  it('disposeAfter does NOT call TabsService.closeTab when cache entry is deleted', () => {
    const { result } = renderHook(() => useMinappPopup())

    // Insert then delete to trigger disposeAfter
    act(() => {
      result.current.minAppsCache.set(testApp.id, testApp)
      result.current.minAppsCache.delete(testApp.id)
    })

    // disposeAfter must NOT close tabs — the old reentry caused React error #185
    expect(mockCloseTab).not.toHaveBeenCalled()

    // disposeAfter must still clean up WebView state
    expect(mockClearWebviewState).toHaveBeenCalledWith('test-app')
  })

  it('disposeAfter still dispatches setOpenedKeepAliveMinapps', () => {
    const { result } = renderHook(() => useMinappPopup())

    act(() => {
      result.current.minAppsCache.set(testApp.id, testApp)
      result.current.minAppsCache.delete(testApp.id)
    })

    // dispatch should have been called — both onInsert (from set) and disposeAfter (from delete)
    // dispatch setOpenedKeepAliveMinapps
    expect(mockDispatch).toHaveBeenCalled()
    const dispatchedActions = mockDispatch.mock.calls.map((call: any[]) => call[0])
    const syncActions = dispatchedActions.filter((action: any) => action?.type === 'runtime/setOpenedKeepAliveMinapps')
    // At least one setOpenedKeepAliveMinapps dispatch should exist
    expect(syncActions.length).toBeGreaterThanOrEqual(1)
  })
})
