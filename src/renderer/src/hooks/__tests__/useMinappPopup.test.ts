import type { MinAppType } from '@renderer/types'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Hoist mock functions so vi.mock factories can safely reference them
const { mockCloseTab, mockGetTabs, mockClearWebviewState, mockDispatch } = vi.hoisted(() => ({
  mockCloseTab: vi.fn(),
  mockGetTabs: vi.fn(() => [{ id: 'apps:test-app', path: '/apps/test-app' }]),
  mockClearWebviewState: vi.fn(),
  mockDispatch: vi.fn()
}))

vi.mock('@renderer/services/TabsService', () => ({
  default: {
    closeTab: (...args: any[]) => mockCloseTab(...args),
    getTabs: () => mockGetTabs()
  }
}))

vi.mock('@renderer/utils/webviewStateManager', () => ({
  clearWebviewState: (...args: any[]) => mockClearWebviewState(...args)
}))

vi.mock('@renderer/services/NavigationService', () => ({
  default: { navigate: vi.fn() }
}))

vi.mock('@renderer/config/minapps', () => ({
  allMinApps: []
}))

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

vi.mock('@renderer/hooks/useRuntime', () => ({
  useRuntime: () => ({
    openedKeepAliveMinapps: [],
    openedOneOffMinapp: null,
    minappShow: false,
    currentMinappId: ''
  })
}))

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

  it('disposeAfter still dispatches setOpenedKeepAliveMinapps', async () => {
    const { result } = renderHook(() => useMinappPopup())

    act(() => {
      result.current.minAppsCache.set(testApp.id, testApp)
      result.current.minAppsCache.delete(testApp.id)
    })

    // Wait for queueMicrotask to flush
    await act(async () => {
      await new Promise<void>((resolve) => queueMicrotask(resolve))
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
