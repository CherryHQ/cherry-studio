import type { MiniApp } from '@shared/data/types/miniApp'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { LRUCache } from 'lru-cache'
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

vi.mock('@renderer/services/TabsService', () => ({
  tabsService: {
    getTabs: vi.fn(() => []),
    closeTab: vi.fn(() => true),
    setMiniAppsCache: vi.fn()
  }
}))

// Import mocked modules
import NavigationService from '@renderer/services/NavigationService'
import { tabsService } from '@renderer/services/TabsService'
import { clearWebviewState } from '@renderer/utils/webviewStateManager'

const mockClearWebviewState = vi.mocked(clearWebviewState)
const mockNavigate = vi.mocked(NavigationService.navigate)
const mockGetTabs = vi.mocked(tabsService.getTabs)
const mockCloseTab = vi.mocked(tabsService.closeTab)

// Import hooks AFTER mocks
import { _resetMiniAppsCache, useMiniAppPopup } from '../useMiniAppPopup'
import { useMiniApps } from '../useMiniApps'
import { createMiniApp } from './fixtures/miniapp'

/** Helper: create a plain array response matching MiniApp[] */
const miniAppList = (items: MiniApp[]) => items

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
    mockGetTabs.mockClear().mockReturnValue([])
    mockCloseTab.mockClear()

    // Reset module-level cache using the exported reset function
    _resetMiniAppsCache()
  })

  // === Basic Return Values ===

  describe('basic return values', () => {
    it('should return all expected functions and values', () => {
      const { result } = renderHook(() => useMiniAppPopup())
      expect(typeof result.current.openMiniApp).toBe('function')
      expect(typeof result.current.openMiniAppKeepAlive).toBe('function')
      expect(typeof result.current.openMiniAppById).toBe('function')
      expect(typeof result.current.closeMiniApp).toBe('function')
      expect(typeof result.current.hideMiniAppPopup).toBe('function')
      expect(typeof result.current.closeAllMiniApps).toBe('function')
      expect(typeof result.current.openSmartMiniApp).toBe('function')
      expect(result.current.miniAppsCache).toBeInstanceOf(LRUCache)
    })

    it('should return a cache instance with default max of 10', () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.max_keep_alive', undefined)
      const { result } = renderHook(() => useMiniAppPopup())
      expect(result.current.miniAppsCache.max).toBe(10)
    })

    it('should return a cache instance with configured max', () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.max_keep_alive', 5)
      const { result } = renderHook(() => useMiniAppPopup())
      expect(result.current.miniAppsCache.max).toBe(5)
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

      // Check cache values directly since mock useCache doesn't trigger re-renders
      expect(MockUseCacheUtils.getCacheValue('mini_app.opened_oneoff')).toEqual(app)
      expect(MockUseCacheUtils.getCacheValue('mini_app.show')).toBe(true)
      expect(MockUseCacheUtils.getCacheValue('mini_app.current_id')).toBe('test-app')
    })

    it('should open a keep-alive miniapp and add to cache', async () => {
      const app = createMiniApp('keep-alive-app')
      MockUseCacheUtils.setCacheValue('mini_app.opened_keep_alive', [])
      MockUseCacheUtils.setCacheValue('mini_app.show', false)
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.openMiniApp(app, true)
      })

      expect(result.current.miniAppsCache.has('keep-alive-app')).toBe(true)
      // Check cache values directly since mock useCache doesn't trigger re-renders
      expect(MockUseCacheUtils.getCacheValue('mini_app.show')).toBe(true)
      expect(MockUseCacheUtils.getCacheValue('mini_app.current_id')).toBe('keep-alive-app')
    })

    it('should not re-add an already cached app, just switch to it', async () => {
      const app = createMiniApp('existing-app')
      MockUseCacheUtils.setCacheValue('mini_app.opened_keep_alive', [app])
      MockUseCacheUtils.setCacheValue('mini_app.show', false)
      const { result } = renderHook(() => useTestMiniAppPopup())

      // Pre-populate cache
      await act(async () => {
        result.current.miniAppsCache.set('existing-app', app)
      })

      await act(async () => {
        result.current.openMiniApp(app, true)
      })

      expect(result.current.miniAppsCache.size).toBe(1)
      // Check cache values directly since mock useCache doesn't trigger re-renders
      expect(MockUseCacheUtils.getCacheValue('mini_app.show')).toBe(true)
      expect(MockUseCacheUtils.getCacheValue('mini_app.current_id')).toBe('existing-app')
    })

    it('should clear one-off miniapp when opening a keep-alive app', async () => {
      const oneOffApp = createMiniApp('one-off')
      const keepAliveApp = createMiniApp('keep-alive')
      MockUseCacheUtils.setCacheValue('mini_app.opened_oneoff', oneOffApp)
      MockUseCacheUtils.setCacheValue('mini_app.opened_keep_alive', [])
      MockUseCacheUtils.setCacheValue('mini_app.show', false)
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.openMiniApp(keepAliveApp, true)
      })

      // Check cache values directly since mock useCache doesn't trigger re-renders
      expect(MockUseCacheUtils.getCacheValue('mini_app.opened_oneoff')).toBeNull()
    })

    it('should switch to already-opened keep-alive app without re-adding', async () => {
      const app = createMiniApp('already-open')
      MockUseCacheUtils.setCacheValue('mini_app.opened_keep_alive', [app])
      MockUseCacheUtils.setCacheValue('mini_app.show', false)
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.miniAppsCache.set('already-open', app)
      })

      await act(async () => {
        result.current.openMiniApp(app, true)
      })

      // Should switch, not duplicate
      expect(result.current.miniAppsCache.size).toBe(1)
      // Check cache values directly since mock useCache doesn't trigger re-renders
      expect(MockUseCacheUtils.getCacheValue('mini_app.current_id')).toBe('already-open')
      expect(MockUseCacheUtils.getCacheValue('mini_app.show')).toBe(true)
    })
  })

  // === openMiniAppKeepAlive ===

  describe('openMiniAppKeepAlive', () => {
    it('should be a wrapper for openMiniApp(app, true)', async () => {
      const app = createMiniApp('wrapper-test')
      MockUseCacheUtils.setCacheValue('mini_app.opened_keep_alive', [])
      MockUseCacheUtils.setCacheValue('mini_app.show', false)
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.openMiniAppKeepAlive(app)
      })

      expect(result.current.miniAppsCache.has('wrapper-test')).toBe(true)
      // Check cache values directly since mock useCache doesn't trigger re-renders
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

      // Check cache values directly since mock useCache doesn't trigger re-renders
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
      MockUseCacheUtils.setCacheValue('mini_app.opened_keep_alive', [])
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.openMiniAppById('app1', true)
      })

      expect(result.current.miniAppsCache.has('app1')).toBe(true)
    })
  })

  // === closeMiniApp ===

  describe('closeMiniApp', () => {
    it('should remove a keep-alive app from cache', async () => {
      const app = createMiniApp('to-close')
      MockUseCacheUtils.setCacheValue('mini_app.opened_keep_alive', [app])
      MockUseCacheUtils.setCacheValue('mini_app.show', true)
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.miniAppsCache.set('to-close', app)
      })

      await act(async () => {
        result.current.closeMiniApp('to-close')
      })

      expect(result.current.miniAppsCache.has('to-close')).toBe(false)
    })

    it('should clear one-off miniapp when closing it', async () => {
      const app = createMiniApp('one-off-close')
      MockUseCacheUtils.setCacheValue('mini_app.opened_keep_alive', [])
      MockUseCacheUtils.setCacheValue('mini_app.opened_oneoff', app)
      MockUseCacheUtils.setCacheValue('mini_app.show', true)
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.closeMiniApp('one-off-close')
      })

      // Check cache values directly since mock useCache doesn't trigger re-renders
      expect(MockUseCacheUtils.getCacheValue('mini_app.opened_oneoff')).toBeNull()
    })

    it('should hide the miniapp popup after closing', async () => {
      const app = createMiniApp('to-hide')
      MockUseCacheUtils.setCacheValue('mini_app.opened_keep_alive', [])
      MockUseCacheUtils.setCacheValue('mini_app.opened_oneoff', app)
      MockUseCacheUtils.setCacheValue('mini_app.show', true)
      MockUseCacheUtils.setCacheValue('mini_app.current_id', 'to-hide')
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.closeMiniApp('to-hide')
      })

      // Check cache values directly since mock useCache doesn't trigger re-renders
      expect(MockUseCacheUtils.getCacheValue('mini_app.show')).toBe(false)
      expect(MockUseCacheUtils.getCacheValue('mini_app.current_id')).toBe('')
    })
  })

  // === closeAllMiniApps ===

  describe('closeAllMiniApps', () => {
    it('should clear the cache and reset all state', async () => {
      const app1 = createMiniApp('app1')
      const app2 = createMiniApp('app2')
      MockUseCacheUtils.setCacheValue('mini_app.opened_keep_alive', [app1])
      MockUseCacheUtils.setCacheValue('mini_app.opened_oneoff', app2)
      MockUseCacheUtils.setCacheValue('mini_app.show', true)
      MockUseCacheUtils.setCacheValue('mini_app.current_id', 'app1')
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.miniAppsCache.set('app1', app1)
        result.current.miniAppsCache.set('app2', app2)
      })

      // Verify cache has items before closeAllMiniApps
      expect(result.current.miniAppsCache.has('app1')).toBe(true)
      expect(result.current.miniAppsCache.has('app2')).toBe(true)

      await act(async () => {
        result.current.closeAllMiniApps()
      })

      // After closeAllMiniApps, a new cache is created. The old cache reference
      // still has items, but the new cache is empty. We verify the state was reset
      // by checking the cache values.
      // Check cache values directly since mock useCache doesn't trigger re-renders
      expect(MockUseCacheUtils.getCacheValue('mini_app.opened_keep_alive')).toEqual([])
      expect(MockUseCacheUtils.getCacheValue('mini_app.opened_oneoff')).toBeNull()
      expect(MockUseCacheUtils.getCacheValue('mini_app.show')).toBe(false)
      expect(MockUseCacheUtils.getCacheValue('mini_app.current_id')).toBe('')
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

      // Check cache values directly since mock useCache doesn't trigger re-renders
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

      // Check cache values directly since mock useCache doesn't trigger re-renders
      expect(MockUseCacheUtils.getCacheValue('mini_app.show')).toBe(false)
    })

    it('should not affect keep-alive apps when hiding popup', async () => {
      const keepAliveApp = createMiniApp('keep-alive-visible')
      MockUseCacheUtils.setCacheValue('mini_app.opened_keep_alive', [keepAliveApp])
      MockUseCacheUtils.setCacheValue('mini_app.opened_oneoff', null)
      MockUseCacheUtils.setCacheValue('mini_app.show', true)
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.miniAppsCache.set('keep-alive-visible', keepAliveApp)
      })

      await act(async () => {
        result.current.hideMiniAppPopup()
      })

      expect(result.current.miniAppsCache.has('keep-alive-visible')).toBe(true)
    })
  })

  // === openSmartMiniApp ===

  describe('openSmartMiniApp', () => {
    it('should use traditional popup system for side navbar mode', async () => {
      MockUsePreferenceUtils.setPreferenceValue('ui.navbar.position', 'left')
      MockUseCacheUtils.setCacheValue('mini_app.opened_oneoff', null)
      MockUseCacheUtils.setCacheValue('mini_app.show', false)
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.openSmartMiniApp({
          appId: 'smart-app',
          name: 'Smart App',
          url: 'https://smart.app',
          logo: 'icon'
        })
      })

      // Check cache values directly since mock useCache doesn't trigger re-renders
      const oneOffMiniApp = MockUseCacheUtils.getCacheValue('mini_app.opened_oneoff')
      expect(oneOffMiniApp).not.toBeNull()
      expect(oneOffMiniApp?.appId).toBe('smart-app')
      expect(mockNavigate).not.toHaveBeenCalled()
    })

    it('should use cache + navigation for top navbar mode', async () => {
      MockUsePreferenceUtils.setPreferenceValue('ui.navbar.position', 'top')
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

      expect(result.current.miniAppsCache.has('top-nav-app')).toBe(true)
      // Check cache values directly since mock useCache doesn't trigger re-renders
      expect(MockUseCacheUtils.getCacheValue('mini_app.show')).toBe(true)
      expect(MockUseCacheUtils.getCacheValue('mini_app.current_id')).toBe('top-nav-app')
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/app/mini-app/top-nav-app' })
    })

    it('should not navigate again if app is already in cache (top navbar)', async () => {
      MockUsePreferenceUtils.setPreferenceValue('ui.navbar.position', 'top')
      MockUseCacheUtils.setCacheValue('mini_app.show', false)
      mockNavigate!.mockResolvedValue(undefined)
      mockClearWebviewState.mockResolvedValue(undefined)
      const { result } = renderHook(() => useTestMiniAppPopup())

      // Pre-populate cache
      await act(async () => {
        result.current.miniAppsCache.set('cached-app', createMiniApp('cached-app'))
      })

      mockNavigate!.mockClear()

      await act(async () => {
        result.current.openSmartMiniApp({
          appId: 'cached-app',
          name: 'Cached App',
          url: 'https://cached.app',
          logo: 'icon'
        })
      })

      // Check cache values directly since mock useCache doesn't trigger re-renders
      expect(MockUseCacheUtils.getCacheValue('mini_app.show')).toBe(true)
      expect(MockUseCacheUtils.getCacheValue('mini_app.current_id')).toBe('cached-app')
      expect(mockNavigate).not.toHaveBeenCalled()
    })

    it('should respect keepAlive in side navbar mode', async () => {
      MockUsePreferenceUtils.setPreferenceValue('ui.navbar.position', 'left')
      MockUseCacheUtils.setCacheValue('mini_app.opened_keep_alive', [])
      const { result } = renderHook(() => useTestMiniAppPopup())

      await act(async () => {
        result.current.openSmartMiniApp({ appId: 'ka-app', name: 'KA App', url: 'https://ka.app', logo: 'icon' }, true)
      })

      expect(result.current.miniAppsCache.has('ka-app')).toBe(true)
    })
  })

  // === Cache Integration ===

  describe('cache integration', () => {
    it('should call clearWebviewState when app is evicted from cache', async () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.max_keep_alive', 1)
      MockUseCacheUtils.setCacheValue('mini_app.opened_keep_alive', [])
      const { result } = renderHook(() => useTestMiniAppPopup())

      const app1 = createMiniApp('evict-app1')
      await act(async () => {
        result.current.openMiniApp(app1, true)
      })

      const app2 = createMiniApp('evict-app2')
      await act(async () => {
        result.current.openMiniApp(app2, true)
      })

      expect(mockClearWebviewState).toHaveBeenCalledWith('evict-app1')
    })

    it('should update openedKeepAliveMiniApps when cache changes', async () => {
      MockUseCacheUtils.setCacheValue('mini_app.opened_keep_alive', [])
      const { result } = renderHook(() => useTestMiniAppPopup())

      const app = createMiniApp('state-sync-app')
      await act(async () => {
        result.current.openMiniApp(app, true)
      })

      // Check cache values directly since mock useCache doesn't trigger re-renders
      const openedKeepAlive = MockUseCacheUtils.getCacheValue('mini_app.opened_keep_alive')
      expect(openedKeepAlive).toHaveLength(1)
      expect(openedKeepAlive?.[0]?.appId).toBe('state-sync-app')
    })

    it('should rebuild cache when max keep alive size decreases', async () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.max_keep_alive', 3)
      MockUseCacheUtils.setCacheValue('mini_app.opened_keep_alive', [])
      const { result } = renderHook(() => useTestMiniAppPopup())

      const app1 = createMiniApp('resize-app1')
      const app2 = createMiniApp('resize-app2')
      await act(async () => {
        result.current.openMiniApp(app1, true)
        result.current.openMiniApp(app2, true)
      })
      expect(result.current.miniAppsCache.max).toBe(3)
      expect(result.current.miniAppsCache.size).toBe(2)

      // Change preference to smaller size
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.max_keep_alive', 1)

      // Reset the module-level cache so the next hook instance creates a fresh cache
      act(() => {
        _resetMiniAppsCache()
      })

      // Render a new hook instance with the new preference value
      const { result: result2 } = renderHook(() => useTestMiniAppPopup())

      // New hook instance gets the new max value
      expect(result2.current.miniAppsCache.max).toBe(1)
    })
  })

  // === disposeAfter Callback ===

  describe('disposeAfter callback', () => {
    it('should close corresponding tab when app is evicted', async () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.max_keep_alive', 1)
      MockUseCacheUtils.setCacheValue('mini_app.opened_keep_alive', [])
      mockGetTabs.mockReturnValue([{ id: 'tab-1', path: '/app/mini-app/evict-app1' }])

      const { result } = renderHook(() => useTestMiniAppPopup())

      const app1 = createMiniApp('evict-app1')
      await act(async () => {
        result.current.openMiniApp(app1, true)
      })

      const app2 = createMiniApp('evict-app2')
      await act(async () => {
        result.current.openMiniApp(app2, true)
      })

      expect(mockCloseTab).toHaveBeenCalledWith('tab-1')
    })

    it('should not call closeTab if no matching tab exists', async () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.max_keep_alive', 1)
      MockUseCacheUtils.setCacheValue('mini_app.opened_keep_alive', [])
      mockGetTabs.mockReturnValue([{ id: 'tab-other', path: '/app/settings' }])

      const { result } = renderHook(() => useTestMiniAppPopup())

      const app1 = createMiniApp('no-tab-app1')
      await act(async () => {
        result.current.openMiniApp(app1, true)
      })

      const app2 = createMiniApp('no-tab-app2')
      await act(async () => {
        result.current.openMiniApp(app2, true)
      })

      expect(mockCloseTab).not.toHaveBeenCalled()
    })
  })
})
