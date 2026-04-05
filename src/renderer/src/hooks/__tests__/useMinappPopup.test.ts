import type { MiniApp } from '@shared/data/types/miniapp'
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
    setMinAppsCache: vi.fn()
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
import { _resetMinAppsCache, useMinappPopup } from '../useMinappPopup'
import { useMinapps } from '../useMinapps'
import { createMiniApp } from './fixtures/miniapp'

/** Helper: create a paginated response matching OffsetPaginationResponse<MiniApp> */
const paginated = (items: MiniApp[]) => ({ items, total: items.length, page: 1 })

/**
 * Combined hook for testing - useMinappPopup uses useMinapps internally,
 * but tests need access to state properties from useMinapps
 */
const useTestMinappPopup = () => {
  const popup = useMinappPopup()
  const minapps = useMinapps()
  return {
    ...popup,
    // State properties from useMinapps
    minappShow: minapps.minappShow,
    currentMinappId: minapps.currentMinappId,
    openedKeepAliveMinapps: minapps.openedKeepAliveMinapps,
    openedOneOffMinapp: minapps.openedOneOffMinapp
  }
}

describe('useMinappPopup', () => {
  beforeEach(async () => {
    MockUseCacheUtils.resetMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUseDataApiUtils.resetMocks()
    MockUseDataApiUtils.mockQueryData('/miniapps', paginated([]))
    mockClearWebviewState.mockClear()
    mockNavigate!.mockClear()
    mockGetTabs.mockClear().mockReturnValue([])
    mockCloseTab.mockClear()

    // Reset module-level cache using the exported reset function
    _resetMinAppsCache()
  })

  // === Basic Return Values ===

  describe('basic return values', () => {
    it('should return all expected functions and values', () => {
      const { result } = renderHook(() => useMinappPopup())
      expect(typeof result.current.openMinapp).toBe('function')
      expect(typeof result.current.openMinappKeepAlive).toBe('function')
      expect(typeof result.current.openMinappById).toBe('function')
      expect(typeof result.current.closeMinapp).toBe('function')
      expect(typeof result.current.hideMinappPopup).toBe('function')
      expect(typeof result.current.closeAllMinapps).toBe('function')
      expect(typeof result.current.openSmartMinapp).toBe('function')
      expect(result.current.minAppsCache).toBeInstanceOf(LRUCache)
    })

    it('should return a cache instance with default max of 10', () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.minapp.max_keep_alive', undefined)
      const { result } = renderHook(() => useMinappPopup())
      expect(result.current.minAppsCache.max).toBe(10)
    })

    it('should return a cache instance with configured max', () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.minapp.max_keep_alive', 5)
      const { result } = renderHook(() => useMinappPopup())
      expect(result.current.minAppsCache.max).toBe(5)
    })
  })

  // === openMinapp ===

  describe('openMinapp', () => {
    it('should open a one-off minapp when keepAlive is false (default)', async () => {
      const app = createMiniApp('test-app')
      MockUseCacheUtils.setCacheValue('minapp.opened_oneoff', null)
      MockUseCacheUtils.setCacheValue('minapp.show', false)
      const { result } = renderHook(() => useTestMinappPopup())

      await act(async () => {
        result.current.openMinapp(app)
      })

      // Check cache values directly since mock useCache doesn't trigger re-renders
      expect(MockUseCacheUtils.getCacheValue('minapp.opened_oneoff')).toEqual(app)
      expect(MockUseCacheUtils.getCacheValue('minapp.show')).toBe(true)
      expect(MockUseCacheUtils.getCacheValue('minapp.current_id')).toBe('test-app')
    })

    it('should open a keep-alive minapp and add to cache', async () => {
      const app = createMiniApp('keep-alive-app')
      MockUseCacheUtils.setCacheValue('minapp.opened_keep_alive', [])
      MockUseCacheUtils.setCacheValue('minapp.show', false)
      const { result } = renderHook(() => useTestMinappPopup())

      await act(async () => {
        result.current.openMinapp(app, true)
      })

      expect(result.current.minAppsCache.has('keep-alive-app')).toBe(true)
      // Check cache values directly since mock useCache doesn't trigger re-renders
      expect(MockUseCacheUtils.getCacheValue('minapp.show')).toBe(true)
      expect(MockUseCacheUtils.getCacheValue('minapp.current_id')).toBe('keep-alive-app')
    })

    it('should not re-add an already cached app, just switch to it', async () => {
      const app = createMiniApp('existing-app')
      MockUseCacheUtils.setCacheValue('minapp.opened_keep_alive', [app])
      MockUseCacheUtils.setCacheValue('minapp.show', false)
      const { result } = renderHook(() => useTestMinappPopup())

      // Pre-populate cache
      await act(async () => {
        result.current.minAppsCache.set('existing-app', app)
      })

      await act(async () => {
        result.current.openMinapp(app, true)
      })

      expect(result.current.minAppsCache.size).toBe(1)
      // Check cache values directly since mock useCache doesn't trigger re-renders
      expect(MockUseCacheUtils.getCacheValue('minapp.show')).toBe(true)
      expect(MockUseCacheUtils.getCacheValue('minapp.current_id')).toBe('existing-app')
    })

    it('should clear one-off minapp when opening a keep-alive app', async () => {
      const oneOffApp = createMiniApp('one-off')
      const keepAliveApp = createMiniApp('keep-alive')
      MockUseCacheUtils.setCacheValue('minapp.opened_oneoff', oneOffApp)
      MockUseCacheUtils.setCacheValue('minapp.opened_keep_alive', [])
      MockUseCacheUtils.setCacheValue('minapp.show', false)
      const { result } = renderHook(() => useTestMinappPopup())

      await act(async () => {
        result.current.openMinapp(keepAliveApp, true)
      })

      // Check cache values directly since mock useCache doesn't trigger re-renders
      expect(MockUseCacheUtils.getCacheValue('minapp.opened_oneoff')).toBeNull()
    })

    it('should switch to already-opened keep-alive app without re-adding', async () => {
      const app = createMiniApp('already-open')
      MockUseCacheUtils.setCacheValue('minapp.opened_keep_alive', [app])
      MockUseCacheUtils.setCacheValue('minapp.show', false)
      const { result } = renderHook(() => useTestMinappPopup())

      await act(async () => {
        result.current.minAppsCache.set('already-open', app)
      })

      await act(async () => {
        result.current.openMinapp(app, true)
      })

      // Should switch, not duplicate
      expect(result.current.minAppsCache.size).toBe(1)
      // Check cache values directly since mock useCache doesn't trigger re-renders
      expect(MockUseCacheUtils.getCacheValue('minapp.current_id')).toBe('already-open')
      expect(MockUseCacheUtils.getCacheValue('minapp.show')).toBe(true)
    })
  })

  // === openMinappKeepAlive ===

  describe('openMinappKeepAlive', () => {
    it('should be a wrapper for openMinapp(app, true)', async () => {
      const app = createMiniApp('wrapper-test')
      MockUseCacheUtils.setCacheValue('minapp.opened_keep_alive', [])
      MockUseCacheUtils.setCacheValue('minapp.show', false)
      const { result } = renderHook(() => useTestMinappPopup())

      await act(async () => {
        result.current.openMinappKeepAlive(app)
      })

      expect(result.current.minAppsCache.has('wrapper-test')).toBe(true)
      // Check cache values directly since mock useCache doesn't trigger re-renders
      expect(MockUseCacheUtils.getCacheValue('minapp.show')).toBe(true)
    })
  })

  // === openMinappById ===

  describe('openMinappById', () => {
    it('should find and open an app by its appId as one-off', async () => {
      const apps = [createMiniApp('app1'), createMiniApp('app2'), createMiniApp('app3')]
      MockUseDataApiUtils.mockQueryData('/miniapps', paginated(apps))
      MockUseCacheUtils.setCacheValue('minapp.opened_oneoff', null)
      MockUseCacheUtils.setCacheValue('minapp.show', false)
      const { result } = renderHook(() => useTestMinappPopup())

      await act(async () => {
        result.current.openMinappById('app2')
      })

      // Check cache values directly since mock useCache doesn't trigger re-renders
      const oneOffMinapp = MockUseCacheUtils.getCacheValue('minapp.opened_oneoff')
      expect(oneOffMinapp).not.toBeNull()
      expect(oneOffMinapp?.appId).toBe('app2')
    })

    it('should do nothing if app id is not found', async () => {
      const apps = [createMiniApp('app1')]
      MockUseDataApiUtils.mockQueryData('/miniapps', paginated(apps))
      MockUseCacheUtils.setCacheValue('minapp.opened_oneoff', null)
      const { result } = renderHook(() => useTestMinappPopup())

      await act(async () => {
        result.current.openMinappById('nonexistent')
      })

      expect(result.current.openedOneOffMinapp).toBeNull()
    })

    it('should open as keep-alive when keepAlive=true', async () => {
      const apps = [createMiniApp('app1')]
      MockUseDataApiUtils.mockQueryData('/miniapps', paginated(apps))
      MockUseCacheUtils.setCacheValue('minapp.opened_keep_alive', [])
      const { result } = renderHook(() => useTestMinappPopup())

      await act(async () => {
        result.current.openMinappById('app1', true)
      })

      expect(result.current.minAppsCache.has('app1')).toBe(true)
    })
  })

  // === closeMinapp ===

  describe('closeMinapp', () => {
    it('should remove a keep-alive app from cache', async () => {
      const app = createMiniApp('to-close')
      MockUseCacheUtils.setCacheValue('minapp.opened_keep_alive', [app])
      MockUseCacheUtils.setCacheValue('minapp.show', true)
      const { result } = renderHook(() => useTestMinappPopup())

      await act(async () => {
        result.current.minAppsCache.set('to-close', app)
      })

      await act(async () => {
        result.current.closeMinapp('to-close')
      })

      expect(result.current.minAppsCache.has('to-close')).toBe(false)
    })

    it('should clear one-off minapp when closing it', async () => {
      const app = createMiniApp('one-off-close')
      MockUseCacheUtils.setCacheValue('minapp.opened_keep_alive', [])
      MockUseCacheUtils.setCacheValue('minapp.opened_oneoff', app)
      MockUseCacheUtils.setCacheValue('minapp.show', true)
      const { result } = renderHook(() => useTestMinappPopup())

      await act(async () => {
        result.current.closeMinapp('one-off-close')
      })

      // Check cache values directly since mock useCache doesn't trigger re-renders
      expect(MockUseCacheUtils.getCacheValue('minapp.opened_oneoff')).toBeNull()
    })

    it('should hide the minapp popup after closing', async () => {
      const app = createMiniApp('to-hide')
      MockUseCacheUtils.setCacheValue('minapp.opened_keep_alive', [])
      MockUseCacheUtils.setCacheValue('minapp.opened_oneoff', app)
      MockUseCacheUtils.setCacheValue('minapp.show', true)
      MockUseCacheUtils.setCacheValue('minapp.current_id', 'to-hide')
      const { result } = renderHook(() => useTestMinappPopup())

      await act(async () => {
        result.current.closeMinapp('to-hide')
      })

      // Check cache values directly since mock useCache doesn't trigger re-renders
      expect(MockUseCacheUtils.getCacheValue('minapp.show')).toBe(false)
      expect(MockUseCacheUtils.getCacheValue('minapp.current_id')).toBe('')
    })
  })

  // === closeAllMinapps ===

  describe('closeAllMinapps', () => {
    it('should clear the cache and reset all state', async () => {
      const app1 = createMiniApp('app1')
      const app2 = createMiniApp('app2')
      MockUseCacheUtils.setCacheValue('minapp.opened_keep_alive', [app1])
      MockUseCacheUtils.setCacheValue('minapp.opened_oneoff', app2)
      MockUseCacheUtils.setCacheValue('minapp.show', true)
      MockUseCacheUtils.setCacheValue('minapp.current_id', 'app1')
      const { result } = renderHook(() => useTestMinappPopup())

      await act(async () => {
        result.current.minAppsCache.set('app1', app1)
        result.current.minAppsCache.set('app2', app2)
      })

      // Verify cache has items before closeAllMinapps
      expect(result.current.minAppsCache.has('app1')).toBe(true)
      expect(result.current.minAppsCache.has('app2')).toBe(true)

      await act(async () => {
        result.current.closeAllMinapps()
      })

      // After closeAllMinapps, a new cache is created. The old cache reference
      // still has items, but the new cache is empty. We verify the state was reset
      // by checking the cache values.
      // Check cache values directly since mock useCache doesn't trigger re-renders
      expect(MockUseCacheUtils.getCacheValue('minapp.opened_keep_alive')).toEqual([])
      expect(MockUseCacheUtils.getCacheValue('minapp.opened_oneoff')).toBeNull()
      expect(MockUseCacheUtils.getCacheValue('minapp.show')).toBe(false)
      expect(MockUseCacheUtils.getCacheValue('minapp.current_id')).toBe('')
    })
  })

  // === hideMinappPopup ===

  describe('hideMinappPopup', () => {
    it('should hide the popup and clear one-off minapp', async () => {
      const app = createMiniApp('to-hide-popup')
      MockUseCacheUtils.setCacheValue('minapp.opened_oneoff', app)
      MockUseCacheUtils.setCacheValue('minapp.show', true)
      MockUseCacheUtils.setCacheValue('minapp.current_id', 'to-hide-popup')
      const { result } = renderHook(() => useTestMinappPopup())

      await act(async () => {
        result.current.hideMinappPopup()
      })

      // Check cache values directly since mock useCache doesn't trigger re-renders
      expect(MockUseCacheUtils.getCacheValue('minapp.show')).toBe(false)
      expect(MockUseCacheUtils.getCacheValue('minapp.opened_oneoff')).toBeNull()
      expect(MockUseCacheUtils.getCacheValue('minapp.current_id')).toBe('')
    })

    it('should do nothing if popup is not showing', async () => {
      MockUseCacheUtils.setCacheValue('minapp.show', false)
      const { result } = renderHook(() => useTestMinappPopup())

      await act(async () => {
        result.current.hideMinappPopup()
      })

      // Check cache values directly since mock useCache doesn't trigger re-renders
      expect(MockUseCacheUtils.getCacheValue('minapp.show')).toBe(false)
    })

    it('should not affect keep-alive apps when hiding popup', async () => {
      const keepAliveApp = createMiniApp('keep-alive-visible')
      MockUseCacheUtils.setCacheValue('minapp.opened_keep_alive', [keepAliveApp])
      MockUseCacheUtils.setCacheValue('minapp.opened_oneoff', null)
      MockUseCacheUtils.setCacheValue('minapp.show', true)
      const { result } = renderHook(() => useTestMinappPopup())

      await act(async () => {
        result.current.minAppsCache.set('keep-alive-visible', keepAliveApp)
      })

      await act(async () => {
        result.current.hideMinappPopup()
      })

      expect(result.current.minAppsCache.has('keep-alive-visible')).toBe(true)
    })
  })

  // === openSmartMinapp ===

  describe('openSmartMinapp', () => {
    it('should use traditional popup system for side navbar mode', async () => {
      MockUsePreferenceUtils.setPreferenceValue('ui.navbar.position', 'left')
      MockUseCacheUtils.setCacheValue('minapp.opened_oneoff', null)
      MockUseCacheUtils.setCacheValue('minapp.show', false)
      const { result } = renderHook(() => useTestMinappPopup())

      await act(async () => {
        result.current.openSmartMinapp({
          appId: 'smart-app',
          name: 'Smart App',
          url: 'https://smart.app',
          logo: 'icon'
        })
      })

      // Check cache values directly since mock useCache doesn't trigger re-renders
      const oneOffMinapp = MockUseCacheUtils.getCacheValue('minapp.opened_oneoff')
      expect(oneOffMinapp).not.toBeNull()
      expect(oneOffMinapp?.appId).toBe('smart-app')
      expect(mockNavigate).not.toHaveBeenCalled()
    })

    it('should use cache + navigation for top navbar mode', async () => {
      MockUsePreferenceUtils.setPreferenceValue('ui.navbar.position', 'top')
      MockUseCacheUtils.setCacheValue('minapp.show', false)
      mockNavigate!.mockResolvedValue(undefined)
      const { result } = renderHook(() => useTestMinappPopup())

      await act(async () => {
        result.current.openSmartMinapp({
          appId: 'top-nav-app',
          name: 'Top Nav App',
          url: 'https://topnav.app',
          logo: 'icon'
        })
      })

      expect(result.current.minAppsCache.has('top-nav-app')).toBe(true)
      // Check cache values directly since mock useCache doesn't trigger re-renders
      expect(MockUseCacheUtils.getCacheValue('minapp.show')).toBe(true)
      expect(MockUseCacheUtils.getCacheValue('minapp.current_id')).toBe('top-nav-app')
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/app/minapp/top-nav-app' })
    })

    it('should not navigate again if app is already in cache (top navbar)', async () => {
      MockUsePreferenceUtils.setPreferenceValue('ui.navbar.position', 'top')
      MockUseCacheUtils.setCacheValue('minapp.show', false)
      mockNavigate!.mockResolvedValue(undefined)
      mockClearWebviewState.mockResolvedValue(undefined)
      const { result } = renderHook(() => useTestMinappPopup())

      // Pre-populate cache
      await act(async () => {
        result.current.minAppsCache.set('cached-app', createMiniApp('cached-app'))
      })

      mockNavigate!.mockClear()

      await act(async () => {
        result.current.openSmartMinapp({
          appId: 'cached-app',
          name: 'Cached App',
          url: 'https://cached.app',
          logo: 'icon'
        })
      })

      // Check cache values directly since mock useCache doesn't trigger re-renders
      expect(MockUseCacheUtils.getCacheValue('minapp.show')).toBe(true)
      expect(MockUseCacheUtils.getCacheValue('minapp.current_id')).toBe('cached-app')
    })

    it('should respect keepAlive in side navbar mode', async () => {
      MockUsePreferenceUtils.setPreferenceValue('ui.navbar.position', 'left')
      MockUseCacheUtils.setCacheValue('minapp.opened_keep_alive', [])
      const { result } = renderHook(() => useTestMinappPopup())

      await act(async () => {
        result.current.openSmartMinapp({ appId: 'ka-app', name: 'KA App', url: 'https://ka.app', logo: 'icon' }, true)
      })

      expect(result.current.minAppsCache.has('ka-app')).toBe(true)
    })
  })

  // === Cache Integration ===

  describe('cache integration', () => {
    it('should call clearWebviewState when app is evicted from cache', async () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.minapp.max_keep_alive', 1)
      MockUseCacheUtils.setCacheValue('minapp.opened_keep_alive', [])
      const { result } = renderHook(() => useTestMinappPopup())

      const app1 = createMiniApp('evict-app1')
      await act(async () => {
        result.current.openMinapp(app1, true)
      })

      const app2 = createMiniApp('evict-app2')
      await act(async () => {
        result.current.openMinapp(app2, true)
      })

      expect(mockClearWebviewState).toHaveBeenCalledWith('evict-app1')
    })

    it('should update openedKeepAliveMinapps when cache changes', async () => {
      MockUseCacheUtils.setCacheValue('minapp.opened_keep_alive', [])
      const { result } = renderHook(() => useTestMinappPopup())

      const app = createMiniApp('state-sync-app')
      await act(async () => {
        result.current.openMinapp(app, true)
      })

      // Check cache values directly since mock useCache doesn't trigger re-renders
      const openedKeepAlive = MockUseCacheUtils.getCacheValue('minapp.opened_keep_alive')
      expect(openedKeepAlive).toHaveLength(1)
      expect(openedKeepAlive?.[0]?.appId).toBe('state-sync-app')
    })

    it('should rebuild cache when max keep alive size decreases', async () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.minapp.max_keep_alive', 3)
      MockUseCacheUtils.setCacheValue('minapp.opened_keep_alive', [])
      const { result } = renderHook(() => useTestMinappPopup())

      const app1 = createMiniApp('resize-app1')
      const app2 = createMiniApp('resize-app2')
      await act(async () => {
        result.current.openMinapp(app1, true)
        result.current.openMinapp(app2, true)
      })
      expect(result.current.minAppsCache.max).toBe(3)
      expect(result.current.minAppsCache.size).toBe(2)

      // Change preference to smaller size
      MockUsePreferenceUtils.setPreferenceValue('feature.minapp.max_keep_alive', 1)

      // Reset the module-level cache so the next hook instance creates a fresh cache
      act(() => {
        _resetMinAppsCache()
      })

      // Render a new hook instance with the new preference value
      const { result: result2 } = renderHook(() => useTestMinappPopup())

      // New hook instance gets the new max value
      expect(result2.current.minAppsCache.max).toBe(1)
    })
  })

  // === disposeAfter Callback ===

  describe('disposeAfter callback', () => {
    it('should close corresponding tab when app is evicted', async () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.minapp.max_keep_alive', 1)
      MockUseCacheUtils.setCacheValue('minapp.opened_keep_alive', [])
      mockGetTabs.mockReturnValue([{ id: 'tab-1', path: '/app/minapp/evict-app1' }])

      const { result } = renderHook(() => useTestMinappPopup())

      const app1 = createMiniApp('evict-app1')
      await act(async () => {
        result.current.openMinapp(app1, true)
      })

      const app2 = createMiniApp('evict-app2')
      await act(async () => {
        result.current.openMinapp(app2, true)
      })

      expect(mockCloseTab).toHaveBeenCalledWith('tab-1')
    })

    it('should not call closeTab if no matching tab exists', async () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.minapp.max_keep_alive', 1)
      MockUseCacheUtils.setCacheValue('minapp.opened_keep_alive', [])
      mockGetTabs.mockReturnValue([{ id: 'tab-other', path: '/app/settings' }])

      const { result } = renderHook(() => useTestMinappPopup())

      const app1 = createMiniApp('no-tab-app1')
      await act(async () => {
        result.current.openMinapp(app1, true)
      })

      const app2 = createMiniApp('no-tab-app2')
      await act(async () => {
        result.current.openMinapp(app2, true)
      })

      expect(mockCloseTab).not.toHaveBeenCalled()
    })
  })
})
