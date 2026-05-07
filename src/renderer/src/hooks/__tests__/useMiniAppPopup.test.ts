import type { MiniApp } from '@shared/data/types/miniApp'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock side-effect dependencies BEFORE importing the hook
vi.mock('@renderer/utils/webviewStateManager', () => ({
  clearWebviewState: vi.fn()
}))

vi.mock('@renderer/services/NavigationService', () => ({
  default: {
    navigate: vi.fn()
  }
}))

// useTabs is consumed by useMiniAppPopup to find AppShell tabs that pin a
// miniapp route — pinned tabs are exempt from keep-alive eviction. The test
// surface here doesn't exercise the AppShell tab system, so default to "no
// pinned tabs"; the pinned-exemption test below overrides this per-test.
const mockTabs = vi.hoisted(() => ({
  tabs: [] as Array<{ id: string; url: string; isPinned?: boolean; type: 'route' }>
}))
vi.mock('@renderer/hooks/useTabs', () => ({
  useTabs: () => ({ tabs: mockTabs.tabs })
}))

// Import mocked modules
import NavigationService from '@renderer/services/NavigationService'
import { clearWebviewState } from '@renderer/utils/webviewStateManager'

const mockClearWebviewState = vi.mocked(clearWebviewState)
const mockNavigate = vi.mocked(NavigationService.navigate)

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
  const miniapps = useMiniApps()
  return {
    ...popup,
    // State properties from useMiniApps
    miniAppShow: miniapps.miniAppShow,
    currentMiniAppId: miniapps.currentMiniAppId,
    openedKeepAliveMiniApps: miniapps.openedKeepAliveMiniApps,
    openedOneOffMiniApp: miniapps.openedOneOffMiniApp
  }
}

describe('useMiniAppPopup', () => {
  beforeEach(async () => {
    MockUseCacheUtils.resetMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUseDataApiUtils.resetMocks()
    MockUseDataApiUtils.mockQueryData('/mini-apps', miniAppList([]))
    mockClearWebviewState.mockClear()
    mockNavigate!.mockClear()
    mockTabs.tabs = []
  })

  // === Basic Return Values ===

  describe('basic return values', () => {
    it('should return all expected functions', () => {
      const { result } = renderHook(() => useMiniAppPopup())
      expect(typeof result.current.openMiniApp).toBe('function')
      expect(typeof result.current.openMiniAppKeepAlive).toBe('function')
      expect(typeof result.current.openMiniAppById).toBe('function')
      expect(typeof result.current.closeMiniApp).toBe('function')
      expect(typeof result.current.hideMiniAppPopup).toBe('function')
      expect(typeof result.current.closeAllMiniApps).toBe('function')
      expect(typeof result.current.openSmartMiniApp).toBe('function')
    })
  })

  // === openMiniApp ===

  describe('openMiniApp', () => {
    it('should open a one-off miniapp when keepAlive is false (default)', async () => {
      const app = createMiniApp('test-app')
      MockUseCacheUtils.setCacheValue('mini_app.opened_oneoff', null)
      MockUseCacheUtils.setCacheValue('mini_app.show', false)
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.openMiniApp(app)
      })

      expect(MockUseCacheUtils.getCacheValue('mini_app.opened_oneoff')).toEqual(app)
      expect(MockUseCacheUtils.getCacheValue('mini_app.show')).toBe(true)
      expect(MockUseCacheUtils.getCacheValue('mini_app.current_id')).toBe('test-app')
    })

    it('should open a keep-alive miniapp and add to keep-alive list', async () => {
      const app = createMiniApp('keep-alive-app')
      MockUseCacheUtils.setCacheValue(KEEP_ALIVE_KEY, [])
      MockUseCacheUtils.setCacheValue('mini_app.show', false)
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.openMiniApp(app, true)
      })

      expect(isInKeepAlive('keep-alive-app')).toBe(true)
      expect(MockUseCacheUtils.getCacheValue('mini_app.show')).toBe(true)
      expect(MockUseCacheUtils.getCacheValue('mini_app.current_id')).toBe('keep-alive-app')
    })

    it('should not duplicate an already-open app — switch and move it to the tail', async () => {
      const app = createMiniApp('existing-app')
      const other = createMiniApp('other')
      MockUseCacheUtils.setCacheValue(KEEP_ALIVE_KEY, [app, other])
      MockUseCacheUtils.setCacheValue('mini_app.show', false)
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.openMiniApp(app, true)
      })

      const list = getKeepAlive()
      expect(list).toHaveLength(2)
      // 'existing-app' moved to tail (most recent)
      expect(list[list.length - 1].appId).toBe('existing-app')
      expect(MockUseCacheUtils.getCacheValue('mini_app.show')).toBe(true)
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
        result.current.openMiniApp(app, true)
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
        result.current.openMiniApp(app, true)
      })

      const list = getKeepAlive()
      expect(list.map((a) => a.appId)).toEqual(['newer', 'mid-app'])
    })

    it('should clear one-off miniapp when opening a keep-alive app', async () => {
      const oneOffApp = createMiniApp('one-off')
      const keepAliveApp = createMiniApp('keep-alive')
      MockUseCacheUtils.setCacheValue('mini_app.opened_oneoff', oneOffApp)
      MockUseCacheUtils.setCacheValue(KEEP_ALIVE_KEY, [])
      MockUseCacheUtils.setCacheValue('mini_app.show', false)
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.openMiniApp(keepAliveApp, true)
      })

      expect(MockUseCacheUtils.getCacheValue('mini_app.opened_oneoff')).toBeNull()
    })
  })

  // === openMiniAppKeepAlive ===

  describe('openMiniAppKeepAlive', () => {
    it('should be a wrapper for openMiniApp(app, true)', async () => {
      const app = createMiniApp('wrapper-test')
      MockUseCacheUtils.setCacheValue(KEEP_ALIVE_KEY, [])
      MockUseCacheUtils.setCacheValue('mini_app.show', false)
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.openMiniAppKeepAlive(app)
      })

      expect(isInKeepAlive('wrapper-test')).toBe(true)
      expect(MockUseCacheUtils.getCacheValue('mini_app.show')).toBe(true)
    })
  })

  // === openMiniAppById ===

  describe('openMiniAppById', () => {
    it('should find and open an app by its appId as one-off', async () => {
      const apps = [createMiniApp('app1'), createMiniApp('app2'), createMiniApp('app3')]
      MockUseDataApiUtils.mockQueryData('/mini-apps', miniAppList(apps))
      MockUseCacheUtils.setCacheValue('mini_app.opened_oneoff', null)
      MockUseCacheUtils.setCacheValue('mini_app.show', false)
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.openMiniAppById('app2')
      })

      const oneOffMiniApp = MockUseCacheUtils.getCacheValue('mini_app.opened_oneoff')
      expect(oneOffMiniApp).not.toBeNull()
      expect(oneOffMiniApp?.appId).toBe('app2')
    })

    it('should throw DataApiError when app id is not found', async () => {
      const apps = [createMiniApp('app1')]
      MockUseDataApiUtils.mockQueryData('/mini-apps', miniAppList(apps))
      MockUseCacheUtils.setCacheValue('mini_app.opened_oneoff', null)
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        expect(() => result.current.openMiniAppById('nonexistent')).toThrow()
      })
    })

    it('should open as keep-alive when keepAlive=true', async () => {
      const apps = [createMiniApp('app1')]
      MockUseDataApiUtils.mockQueryData('/mini-apps', miniAppList(apps))
      MockUseCacheUtils.setCacheValue(KEEP_ALIVE_KEY, [])
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.openMiniAppById('app1', true)
      })

      expect(isInKeepAlive('app1')).toBe(true)
    })
  })

  // === closeMiniApp ===

  describe('closeMiniApp', () => {
    it('should remove a keep-alive app from the list', async () => {
      const app = createMiniApp('to-close')
      MockUseCacheUtils.setCacheValue(KEEP_ALIVE_KEY, [app])
      MockUseCacheUtils.setCacheValue('mini_app.show', true)
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.closeMiniApp('to-close')
      })

      expect(isInKeepAlive('to-close')).toBe(false)
      expect(mockClearWebviewState).toHaveBeenCalledWith('to-close')
    })

    it('should clear one-off miniapp when closing it', async () => {
      const app = createMiniApp('one-off-close')
      MockUseCacheUtils.setCacheValue(KEEP_ALIVE_KEY, [])
      MockUseCacheUtils.setCacheValue('mini_app.opened_oneoff', app)
      MockUseCacheUtils.setCacheValue('mini_app.show', true)
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.closeMiniApp('one-off-close')
      })

      expect(MockUseCacheUtils.getCacheValue('mini_app.opened_oneoff')).toBeNull()
    })

    it('should hide the miniapp popup after closing', async () => {
      const app = createMiniApp('to-hide')
      MockUseCacheUtils.setCacheValue(KEEP_ALIVE_KEY, [])
      MockUseCacheUtils.setCacheValue('mini_app.opened_oneoff', app)
      MockUseCacheUtils.setCacheValue('mini_app.show', true)
      MockUseCacheUtils.setCacheValue('mini_app.current_id', 'to-hide')
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.closeMiniApp('to-hide')
      })

      expect(MockUseCacheUtils.getCacheValue('mini_app.show')).toBe(false)
      expect(MockUseCacheUtils.getCacheValue('mini_app.current_id')).toBe('')
    })
  })

  // === closeAllMiniApps ===

  describe('closeAllMiniApps', () => {
    it('should clear the keep-alive list, run cleanup per entry, and reset all state', async () => {
      const app1 = createMiniApp('app1')
      const app2 = createMiniApp('app2')
      MockUseCacheUtils.setCacheValue(KEEP_ALIVE_KEY, [app1, app2])
      MockUseCacheUtils.setCacheValue('mini_app.opened_oneoff', null)
      MockUseCacheUtils.setCacheValue('mini_app.show', true)
      MockUseCacheUtils.setCacheValue('mini_app.current_id', 'app1')
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.closeAllMiniApps()
      })

      expect(MockUseCacheUtils.getCacheValue(KEEP_ALIVE_KEY)).toEqual([])
      expect(MockUseCacheUtils.getCacheValue('mini_app.opened_oneoff')).toBeNull()
      expect(MockUseCacheUtils.getCacheValue('mini_app.show')).toBe(false)
      expect(MockUseCacheUtils.getCacheValue('mini_app.current_id')).toBe('')
      expect(mockClearWebviewState).toHaveBeenCalledWith('app1')
      expect(mockClearWebviewState).toHaveBeenCalledWith('app2')
    })
  })

  // === hideMiniAppPopup ===

  describe('hideMiniAppPopup', () => {
    it('should hide the popup and clear one-off miniapp', async () => {
      const app = createMiniApp('to-hide-popup')
      MockUseCacheUtils.setCacheValue('mini_app.opened_oneoff', app)
      MockUseCacheUtils.setCacheValue('mini_app.show', true)
      MockUseCacheUtils.setCacheValue('mini_app.current_id', 'to-hide-popup')
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.hideMiniAppPopup()
      })

      expect(MockUseCacheUtils.getCacheValue('mini_app.show')).toBe(false)
      expect(MockUseCacheUtils.getCacheValue('mini_app.opened_oneoff')).toBeNull()
      expect(MockUseCacheUtils.getCacheValue('mini_app.current_id')).toBe('')
    })

    it('should do nothing if popup is not showing', async () => {
      MockUseCacheUtils.setCacheValue('mini_app.show', false)
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.hideMiniAppPopup()
      })

      expect(MockUseCacheUtils.getCacheValue('mini_app.show')).toBe(false)
    })

    it('should not affect keep-alive apps when hiding popup', async () => {
      const keepAliveApp = createMiniApp('keep-alive-visible')
      MockUseCacheUtils.setCacheValue(KEEP_ALIVE_KEY, [keepAliveApp])
      MockUseCacheUtils.setCacheValue('mini_app.opened_oneoff', null)
      MockUseCacheUtils.setCacheValue('mini_app.show', true)
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.hideMiniAppPopup()
      })

      expect(isInKeepAlive('keep-alive-visible')).toBe(true)
    })
  })

  // === openSmartMiniApp ===

  describe('openSmartMiniApp', () => {
    it('should add to keep-alive + navigate for a new app', async () => {
      MockUseCacheUtils.setCacheValue(KEEP_ALIVE_KEY, [])
      MockUseCacheUtils.setCacheValue('mini_app.show', false)
      mockNavigate!.mockResolvedValue(undefined)
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
      expect(MockUseCacheUtils.getCacheValue('mini_app.show')).toBe(true)
      expect(MockUseCacheUtils.getCacheValue('mini_app.current_id')).toBe('top-nav-app')
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/app/mini-app/top-nav-app' })
    })

    it('should not navigate again if app is already in keep-alive', async () => {
      const existing = createMiniApp('cached-app')
      MockUseCacheUtils.setCacheValue(KEEP_ALIVE_KEY, [existing])
      MockUseCacheUtils.setCacheValue('mini_app.show', false)
      mockNavigate!.mockResolvedValue(undefined)
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.openSmartMiniApp({
          appId: 'cached-app',
          name: 'Cached App',
          url: 'https://cached.app',
          logo: 'icon'
        })
      })

      expect(MockUseCacheUtils.getCacheValue('mini_app.show')).toBe(true)
      expect(MockUseCacheUtils.getCacheValue('mini_app.current_id')).toBe('cached-app')
      expect(mockNavigate).not.toHaveBeenCalled()
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
        result.current.openMiniApp(createMiniApp('evict-app2'), true)
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
        result.current.openMiniApp(app, true)
      })

      const list = getKeepAlive()
      expect(list).toHaveLength(1)
      expect(list[0].appId).toBe('state-sync-app')
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
          result.current.openMiniApp(createMiniApp('newcomer'), true)
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
          result.current.openMiniApp(createMiniApp('newcomer'), true)
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
