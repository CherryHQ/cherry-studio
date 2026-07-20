import type { MiniApp } from '@shared/data/types/miniApp'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock side-effect dependencies BEFORE importing the hook
vi.mock('@renderer/utils/webviewStateManager', () => ({
  clearWebviewState: vi.fn(),
  setWebviewLoaded: vi.fn()
}))

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))

// TabsContext is consumed by useMiniAppPopup to open AppShell tabs and to find
// pinned miniapp route tabs that are exempt from keep-alive eviction. The test
// surface here defaults to "no pinned tabs"; individual tests override this.
const mockTabs = vi.hoisted(() => ({
  tabs: [] as Array<{ id: string; url: string; isPinned?: boolean; type: 'route' }>,
  hasContext: true,
  closeTab: vi.fn(),
  openTab: vi.fn(),
  updateTab: vi.fn()
}))
vi.mock('@renderer/hooks/tab', () => ({
  useOptionalTabsContext: () =>
    mockTabs.hasContext
      ? {
          tabs: mockTabs.tabs,
          closeTab: mockTabs.closeTab,
          openTab: mockTabs.openTab,
          updateTab: mockTabs.updateTab
        }
      : null
}))

// Import mocked modules
import { clearWebviewState } from '@renderer/utils/webviewStateManager'

const mockClearWebviewState = vi.mocked(clearWebviewState)

// Import hooks AFTER mocks
import { useMiniAppPopup } from '../useMiniAppPopup'
import { useMiniApps } from '../useMiniApps'
import { createMiniApp } from './fixtures/miniApp'

const KEEP_ALIVE_KEY = 'mini_app.opened_keep_alive'

/** Helper: create a plain array response matching MiniApp[] */
const miniAppList = (items: MiniApp[]) => items

const getKeepAlive = () => MockUseCacheUtils.getCacheValue(KEEP_ALIVE_KEY) ?? []
const isInKeepAlive = (appId: string) => getKeepAlive().some((a) => a.appId === appId)

/**
 * Combined hook for testing - useMiniAppPopup uses useMiniApps internally,
 * but tests need access to state properties from useMiniApps
 */
const useTestMiniAppPopup = () => {
  const popup = useMiniAppPopup()
  const miniApps = useMiniApps()
  return {
    ...popup,
    // State properties from useMiniApps
    currentMiniAppId: miniApps.currentMiniAppId,
    openedKeepAliveMiniApps: miniApps.openedKeepAliveMiniApps
  }
}

describe('useMiniAppPopup', () => {
  beforeEach(async () => {
    MockUseCacheUtils.resetMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUseDataApiUtils.resetMocks()
    MockUseDataApiUtils.mockQueryData('/mini-apps', miniAppList([]))
    mockClearWebviewState.mockClear()
    mockTabs.tabs = []
    mockTabs.hasContext = true
    mockTabs.closeTab.mockClear()
    mockTabs.openTab.mockClear()
    mockTabs.updateTab.mockClear()
    mocks.request.mockReset()
    mocks.request.mockResolvedValue(undefined)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ...window.api
      }
    })
  })

  // === Basic Return Values ===

  describe('basic return values', () => {
    it('should return all expected functions', () => {
      const { result } = renderHook(() => useMiniAppPopup())
      expect(typeof result.current.openMiniAppKeepAlive).toBe('function')
      expect(typeof result.current.openSmartMiniApp).toBe('function')
    })

    it('should work without TabsProvider', () => {
      mockTabs.hasContext = false
      const { result } = renderHook(() => useMiniAppPopup())

      expect(typeof result.current.openSmartMiniApp).toBe('function')
    })
  })

  // === openMiniAppKeepAlive ===

  describe('openMiniAppKeepAlive', () => {
    it('should add a new app to the keep-alive list and make it current', async () => {
      const app = createMiniApp('keep-alive-app')
      MockUseCacheUtils.setCacheValue(KEEP_ALIVE_KEY, [])
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.openMiniAppKeepAlive(app)
      })

      expect(isInKeepAlive('keep-alive-app')).toBe(true)
      expect(MockUseCacheUtils.getCacheValue('mini_app.current_id')).toBe('keep-alive-app')
    })

    it('should not duplicate an already-open app — switch and move it to the tail', async () => {
      const app = createMiniApp('existing-app')
      const other = createMiniApp('other')
      MockUseCacheUtils.setCacheValue(KEEP_ALIVE_KEY, [app, other])
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.openMiniAppKeepAlive(app)
      })

      const list = getKeepAlive()
      expect(list).toHaveLength(2)
      // 'existing-app' moved to tail (most recent)
      expect(list[list.length - 1].appId).toBe('existing-app')
      expect(MockUseCacheUtils.getCacheValue('mini_app.current_id')).toBe('existing-app')
    })

    it('should not write a new keep-alive array when the app is already at the tail (#kangfenmao keepalive regression)', async () => {
      // MiniAppPage's useEffect re-fires openMiniAppKeepAlive on every entry
      // to the route — e.g. when the AppShell tab system wakes the page.
      // If the app is already in keep-alive AND already at the tail, the
      // touch is a no-op semantically but used to write a fresh array
      // reference, which cascaded into MiniAppTabsPool re-rendering and
      // consumers reported as a webview reload. Skip the cache write in
      // that case.
      const other = createMiniApp('other')
      const app = createMiniApp('tail-app')
      const seeded = [other, app]
      MockUseCacheUtils.setCacheValue(KEEP_ALIVE_KEY, seeded)

      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.openMiniAppKeepAlive(app)
      })

      // Same items, same order: the hook must preserve the original array
      // reference so downstream `useCache` subscribers don't see a change.
      const after = MockUseCacheUtils.getCacheValue(KEEP_ALIVE_KEY)
      expect(after).toBe(seeded)
    })

    it('should reorder when the existing app is not at the tail (LRU touch still works for genuine switches)', async () => {
      // Sanity counterpart to the above: clicking back to a mini-app that's
      // currently mid-list should still promote it to the tail so it is the
      // last to be evicted under cap pressure.
      const app = createMiniApp('mid-app')
      const newer = createMiniApp('newer')
      MockUseCacheUtils.setCacheValue(KEEP_ALIVE_KEY, [app, newer])

      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.openMiniAppKeepAlive(app)
      })

      const list = getKeepAlive()
      expect(list.map((a) => a.appId)).toEqual(['newer', 'mid-app'])
    })
  })

  // === openSmartMiniApp ===

  describe('openSmartMiniApp', () => {
    it('should add to keep-alive + open a tab for a new app', async () => {
      MockUseCacheUtils.setCacheValue(KEEP_ALIVE_KEY, [])
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.openSmartMiniApp({
          appId: 'top-nav-app',
          name: 'Top Nav App',
          url: 'https://topnav.app',
          logo: 'icon'
        })
      })

      expect(isInKeepAlive('top-nav-app')).toBe(true)
      expect(MockUseCacheUtils.getCacheValue('mini_app.current_id')).toBe('top-nav-app')
      expect(mockTabs.openTab).toHaveBeenCalledWith('/app/mini-app/top-nav-app', {
        title: 'Top Nav App',
        icon: 'icon'
      })
    })

    it('should still activate the app tab when the keep-alive entry already exists', async () => {
      // `MiniAppTabsPool.shouldShow` keys off the active tab URL, not pool
      // membership. Every caller of `openSmartMiniApp` (AboutSettings, S3,
      // OpenClaw, etc.) sits on a non-mini-app route, so skipping `openTab`
      // when cached would leave the pool hidden and the user looking at a
      // settings page. Webview re-use stays correct: we don't recreate the
      // keep-alive entry or reset `src`, only the route activates.
      const existing = createMiniApp('cached-app')
      MockUseCacheUtils.setCacheValue(KEEP_ALIVE_KEY, [existing])
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.openSmartMiniApp({
          appId: 'cached-app',
          name: 'Cached App',
          url: 'https://cached.app',
          logo: 'icon'
        })
      })

      expect(MockUseCacheUtils.getCacheValue('mini_app.current_id')).toBe('cached-app')
      expect(mockTabs.openTab).toHaveBeenCalledWith('/app/mini-app/cached-app', {
        title: 'Cached App',
        icon: 'icon'
      })
    })

    it('should open http URLs externally without TabsProvider', async () => {
      mockTabs.hasContext = false
      MockUseCacheUtils.setCacheValue(KEEP_ALIVE_KEY, [])
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.openSmartMiniApp({
          appId: 'external-help',
          name: 'External Help',
          url: 'https://example.com/help',
          logo: 'icon'
        })
      })

      expect(mocks.request).toHaveBeenCalledWith('system.shell.open_website', 'https://example.com/help')
      expect(mocks.request).not.toHaveBeenCalledWith('system.shell.open_path', expect.anything())
      expect(mockTabs.openTab).not.toHaveBeenCalled()
      expect(getKeepAlive()).toEqual([])
    })

    it('should open file URLs externally with openPath without TabsProvider', async () => {
      mockTabs.hasContext = false
      MockUseCacheUtils.setCacheValue(KEEP_ALIVE_KEY, [])
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.openSmartMiniApp({
          appId: 'releases',
          name: 'Releases',
          url: 'file:///Applications/Cherry%20Studio/resources/releases.html?theme=dark',
          logo: 'icon'
        })
      })

      expect(mocks.request).toHaveBeenCalledWith(
        'system.shell.open_path',
        '/Applications/Cherry Studio/resources/releases.html'
      )
      expect(mocks.request).not.toHaveBeenCalledWith('system.shell.open_website', expect.anything())
      expect(mockTabs.openTab).not.toHaveBeenCalled()
      expect(getKeepAlive()).toEqual([])
    })
  })

  // === Eviction ===

  describe('eviction on overflow', () => {
    it('should call clearWebviewState when an app is evicted from the keep-alive list', async () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.max_keep_alive', 1)
      // Pre-seed with app1 — the mock useCache does not trigger re-renders on
      // setter call, so we exercise the eviction path with a single action.
      MockUseCacheUtils.setCacheValue(KEEP_ALIVE_KEY, [createMiniApp('evict-app1')])
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.openMiniAppKeepAlive(createMiniApp('evict-app2'))
      })

      expect(mockClearWebviewState).toHaveBeenCalledWith('evict-app1')
      expect(isInKeepAlive('evict-app1')).toBe(false)
      expect(isInKeepAlive('evict-app2')).toBe(true)
    })

    it('should update the keep-alive list when adding an app', async () => {
      MockUseCacheUtils.setCacheValue(KEEP_ALIVE_KEY, [])
      const { result } = renderHook(() => useTestMiniAppPopup())

      const app = createMiniApp('state-sync-app')
      await act(async () => {
        result.current.openMiniAppKeepAlive(app)
      })

      const list = getKeepAlive()
      expect(list).toHaveLength(1)
      expect(list[0].appId).toBe('state-sync-app')
    })

    it('should not evict keep-alive apps without TabsProvider', async () => {
      mockTabs.hasContext = false
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.max_keep_alive', 1)
      MockUseCacheUtils.setCacheValue(KEEP_ALIVE_KEY, [createMiniApp('existing')])
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.openMiniAppKeepAlive(createMiniApp('newcomer'))
      })

      expect(getKeepAlive().map((app) => app.appId)).toEqual(['existing', 'newcomer'])
      expect(mockClearWebviewState).not.toHaveBeenCalledWith('existing')
    })

    it('should trim the keep-alive list when max keep alive is decreased', async () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.max_keep_alive', 1)
      // Seed list larger than the cap and mount a fresh hook — the trim
      // effect runs once on mount when list.length > cap.
      const initial = [createMiniApp('a'), createMiniApp('b'), createMiniApp('c')]
      MockUseCacheUtils.setCacheValue(KEEP_ALIVE_KEY, initial)
      renderHook(() => useTestMiniAppPopup())

      const list = getKeepAlive()
      expect(list).toHaveLength(1)
      // The most recently added entry survives (tail of the list)
      expect(list[0].appId).toBe('c')
      expect(mockClearWebviewState).toHaveBeenCalledWith('a')
      expect(mockClearWebviewState).toHaveBeenCalledWith('b')
    })

    // Regression for https://github.com/CherryHQ/cherry-studio/pull/14049 —
    // before the fix, switching between miniapp tabs that the user had pinned
    // in the AppShell tab bar would still evict them from keep-alive (the
    // hook didn't know about pin status), so the side-bar mini-tab list
    // collapsed to whatever cap was. Pinning is the user explicitly saying
    // "keep this loaded"; the cap must respect that.
    describe('pinned-tab exemption', () => {
      it('should not evict a miniapp whose AppShell tab is pinned, even when over cap', async () => {
        MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.max_keep_alive', 3)
        const seeded = [createMiniApp('pinA'), createMiniApp('pinB'), createMiniApp('pinC')]
        MockUseCacheUtils.setCacheValue(KEEP_ALIVE_KEY, seeded)
        // All three existing apps are pinned in the AppShell tab bar; the
        // user is now opening a fourth. Old behavior shifted pinA out (oldest),
        // dropping the count to cap=3. Expected behavior: keep all four, since
        // pinA / pinB / pinC are pinned and exempt; the fourth fits even though
        // we're over cap because there's nothing evictable.
        mockTabs.tabs = [
          { id: 't1', type: 'route', url: '/app/mini-app/pinA', isPinned: true },
          { id: 't2', type: 'route', url: '/app/mini-app/pinB', isPinned: true },
          { id: 't3', type: 'route', url: '/app/mini-app/pinC', isPinned: true }
        ]

        const { result } = renderHook(() => useTestMiniAppPopup())

        await act(async () => {
          result.current.openMiniAppKeepAlive(createMiniApp('newcomer'))
        })

        const list = getKeepAlive()
        expect(list.map((a) => a.appId).sort()).toEqual(['newcomer', 'pinA', 'pinB', 'pinC'])
        expect(mockClearWebviewState).not.toHaveBeenCalledWith('pinA')
      })

      it('should evict the oldest non-pinned entry when over cap and at least one is unpinned', async () => {
        MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.max_keep_alive', 3)
        const seeded = [createMiniApp('pinA'), createMiniApp('floatB'), createMiniApp('pinC')]
        MockUseCacheUtils.setCacheValue(KEEP_ALIVE_KEY, seeded)
        // Only pinA and pinC are pinned. Opening newcomer pushes us to 4;
        // floatB is the only evictable entry, so it goes.
        mockTabs.tabs = [
          { id: 't1', type: 'route', url: '/app/mini-app/pinA', isPinned: true },
          { id: 't3', type: 'route', url: '/app/mini-app/pinC', isPinned: true }
        ]

        const { result } = renderHook(() => useTestMiniAppPopup())

        await act(async () => {
          result.current.openMiniAppKeepAlive(createMiniApp('newcomer'))
        })

        const list = getKeepAlive()
        expect(list.map((a) => a.appId).sort()).toEqual(['newcomer', 'pinA', 'pinC'])
        expect(mockClearWebviewState).toHaveBeenCalledWith('floatB')
      })

      it('should not trim pinned entries when the user lowers the cap', async () => {
        MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.max_keep_alive', 1)
        const initial = [createMiniApp('pinA'), createMiniApp('floatB'), createMiniApp('pinC')]
        MockUseCacheUtils.setCacheValue(KEEP_ALIVE_KEY, initial)
        mockTabs.tabs = [
          { id: 't1', type: 'route', url: '/app/mini-app/pinA', isPinned: true },
          { id: 't3', type: 'route', url: '/app/mini-app/pinC', isPinned: true }
        ]

        renderHook(() => useTestMiniAppPopup())

        // Lowering cap to 1 normally trims to one survivor; with pin
        // exemption the two pinned entries survive and floatB goes.
        const list = getKeepAlive()
        expect(list.map((a) => a.appId).sort()).toEqual(['pinA', 'pinC'])
        expect(mockClearWebviewState).toHaveBeenCalledWith('floatB')
        expect(mockClearWebviewState).not.toHaveBeenCalledWith('pinA')
        expect(mockClearWebviewState).not.toHaveBeenCalledWith('pinC')
      })
    })
  })
})
