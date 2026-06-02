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

vi.mock('../useSettings', () => ({
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
  let result: { current: ReturnType<typeof useMinappPopup> }

  beforeEach(async () => {
    // Clear module-level cache and drain pending microtasks so
    // disposeAfter's queueMicrotask dispatches don't leak between tests.
    const hook = renderHook(() => useMinappPopup())
    hook.result.current.minAppsCache.clear()
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    vi.clearAllMocks()
    mockGetTabs.mockReturnValue([{ id: 'apps:test-app', path: '/apps/test-app' }])
    result = renderHook(() => useMinappPopup()).result
  })

  it('disposeAfter does NOT call TabsService.closeTab when cache entry is deleted', () => {
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

  it('onInsert dispatches setOpenedKeepAliveMinapps synchronously', () => {
    act(() => {
      result.current.minAppsCache.set(testApp.id, testApp)
    })

    // onInsert dispatches synchronously (no queueMicrotask)
    const dispatchedActions = mockDispatch.mock.calls.map((call: any[]) => call[0])
    const syncActions = dispatchedActions.filter((action: any) => action?.type === 'runtime/setOpenedKeepAliveMinapps')
    expect(syncActions.length).toBeGreaterThanOrEqual(1)
  })

  it('disposeAfter dispatches setOpenedKeepAliveMinapps via microtask', async () => {
    act(() => {
      result.current.minAppsCache.set(testApp.id, testApp)
    })

    // Reset to isolate disposeAfter dispatch
    mockDispatch.mockClear()

    act(() => {
      result.current.minAppsCache.delete(testApp.id)
    })

    // Assert: dispatch has NOT happened synchronously inside delete
    const syncCalls = mockDispatch.mock.calls.map((call: any[]) => call[0])
    const syncListActions = syncCalls.filter((action: any) => action?.type === 'runtime/setOpenedKeepAliveMinapps')
    expect(syncListActions.length).toBe(0)

    // Wait for queueMicrotask to flush
    await act(async () => {
      await new Promise<void>((resolve) => queueMicrotask(resolve))
    })

    const dispatchedActions = mockDispatch.mock.calls.map((call: any[]) => call[0])
    const asyncActions = dispatchedActions.filter((action: any) => action?.type === 'runtime/setOpenedKeepAliveMinapps')
    expect(asyncActions.length).toBeGreaterThanOrEqual(1)
  })
})

describe('useMinappPopup - keep-alive idempotent cache writes (issue #15405)', () => {
  let result: { current: ReturnType<typeof useMinappPopup> }

  beforeEach(async () => {
    const hook = renderHook(() => useMinappPopup())
    hook.result.current.minAppsCache.clear()
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    vi.clearAllMocks()
    result = renderHook(() => useMinappPopup()).result
  })

  it('repeated openMinappKeepAlive does not re-dispatch setOpenedKeepAliveMinapps', () => {
    // First open — should dispatch setOpenedKeepAliveMinapps via onInsert
    act(() => {
      result.current.openMinappKeepAlive(testApp)
    })

    const firstListDispatches = mockDispatch.mock.calls
      .map((call: any[]) => call[0])
      .filter((action: any) => action?.type === 'runtime/setOpenedKeepAliveMinapps').length

    expect(firstListDispatches).toBeGreaterThanOrEqual(1)

    // Reset and open same app again
    mockDispatch.mockClear()

    act(() => {
      result.current.openMinappKeepAlive(testApp)
    })

    // Should NOT dispatch setOpenedKeepAliveMinapps again (cache entry unchanged)
    const listDispatches = mockDispatch.mock.calls
      .map((call: any[]) => call[0])
      .filter((action: any) => action?.type === 'runtime/setOpenedKeepAliveMinapps')
    expect(listDispatches.length).toBe(0)

    // But should still dispatch setCurrentMinappId and setMinappShow
    const actionTypes = mockDispatch.mock.calls.map((call: any[]) => call[0]?.type)
    expect(actionTypes).toContain('runtime/setCurrentMinappId')
    expect(actionTypes).toContain('runtime/setMinappShow')
  })

  it('opens minapp with changed URL still refreshes cache and dispatches opened list', () => {
    // First open
    act(() => {
      result.current.openMinappKeepAlive(testApp)
    })
    mockDispatch.mockClear()

    // Open same id but different URL — should refresh cache
    const updatedApp: MinAppType = { ...testApp, url: 'https://example.com/new-token' }
    act(() => {
      result.current.openMinappKeepAlive(updatedApp)
    })

    const listDispatches = mockDispatch.mock.calls
      .map((call: any[]) => call[0])
      .filter((action: any) => action?.type === 'runtime/setOpenedKeepAliveMinapps')
    // onInsert fires because cache entry was refreshed
    expect(listDispatches.length).toBeGreaterThanOrEqual(1)

    // Cache should have the new URL
    const cached = result.current.minAppsCache.get(testApp.id)
    expect(cached?.url).toBe('https://example.com/new-token')
  })

  it('openMinappKeepAlive callback stays stable across rerenders', async () => {
    const { result, rerender } = renderHook(() => useMinappPopup())
    // Ensure clean cache and drain pending microtasks for this isolated render
    result.current.minAppsCache.clear()
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    vi.clearAllMocks()

    const firstRef = result.current.openMinappKeepAlive

    // Rerender — dependency is only [dispatch] now, so callback should stay the same
    rerender()
    expect(result.current.openMinappKeepAlive).toBe(firstRef)
  })
})
