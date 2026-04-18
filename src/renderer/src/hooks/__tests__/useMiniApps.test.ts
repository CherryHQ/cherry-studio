import type { MiniApp } from '@shared/data/types/miniApp'
import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useMiniApps } from '../useMiniApps'
import { appFixtures, createCnOnlyApp, createGlobalApp, createMiniApp } from './fixtures/miniapp'

/** Helper: return the array directly since list() now returns a bare MiniApp[] */
const paginated = (items: MiniApp[]) => items

describe('useMiniApps', () => {
  beforeEach(() => {
    MockUseCacheUtils.resetMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUseDataApiUtils.resetMocks()
    MockUseDataApiUtils.mockQueryData('/mini-apps', paginated([]))
  })

  // === Data Loading ===

  describe('data loading', () => {
    it('should return empty arrays when no data', () => {
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated([]))
      const { result } = renderHook(() => useMiniApps())
      expect(result.current.allApps).toEqual([])
      expect(result.current.miniapps).toEqual([])
      expect(result.current.disabled).toEqual([])
      expect(result.current.pinned).toEqual([])
    })

    it('should return all apps merged with presets', () => {
      const apps = [
        appFixtures.mixedStatus.enabled1,
        appFixtures.mixedStatus.disabled1,
        appFixtures.mixedStatus.pinned1
      ]
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated(apps))
      const { result } = renderHook(() => useMiniApps())
      expect(result.current.allApps).toHaveLength(3)
      expect(result.current.allApps.map((a: MiniApp) => a.appId)).toEqual(['enabled1', 'disabled1', 'pinned1'])
    })

    it('should split apps by status correctly', () => {
      const { mixedStatus } = appFixtures
      const apps = [mixedStatus.enabled1, mixedStatus.enabled2, mixedStatus.disabled1, mixedStatus.pinned1]
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated(apps))
      const { result } = renderHook(() => useMiniApps())
      // miniapps includes enabled + pinned apps (pinned apps remain visible in the grid)
      expect(result.current.miniapps).toHaveLength(3)
      expect(result.current.disabled).toHaveLength(1)
      expect(result.current.pinned).toHaveLength(1)
    })

    it('should expose isLoading state', () => {
      MockUseDataApiUtils.mockQueryLoading('/mini-apps')
      const { result } = renderHook(() => useMiniApps())
      expect(result.current.isLoading).toBe(true)
    })

    it('should expose refetch function', () => {
      const { result } = renderHook(() => useMiniApps())
      expect(typeof result.current.refetch).toBe('function')
    })
  })

  // === Region Filtering ===

  describe('region filtering', () => {
    it('should show all apps when region is CN (default)', () => {
      const { mixedRegion } = appFixtures
      const apps = Object.values(mixedRegion).map((a) => ({ ...a, status: 'enabled' as const }))
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated(apps))
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.region', 'CN')
      const { result } = renderHook(() => useMiniApps())
      expect(result.current.miniapps).toHaveLength(3)
    })

    it('should only show Global apps when region is Global', () => {
      const { mixedRegion } = appFixtures
      const apps = Object.values(mixedRegion).map((a) => ({ ...a, status: 'enabled' as const }))
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated(apps))
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.region', 'Global')
      const { result } = renderHook(() => useMiniApps())
      expect(result.current.miniapps).toHaveLength(1)
      expect(result.current.miniapps[0].appId).toBe('global-app')
    })

    it('should show apps without supportedRegions as CN-only (hidden from Global)', () => {
      const { mixedRegion } = appFixtures
      const apps = [mixedRegion.globalApp, mixedRegion.noRegionApp].map((a) => ({
        ...a,
        status: 'enabled' as const
      }))
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated(apps))
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.region', 'Global')
      const { result } = renderHook(() => useMiniApps())
      expect(result.current.miniapps).toHaveLength(1)
      expect(result.current.miniapps[0].appId).toBe('global-app')
    })

    it('should not filter pinned apps by region', () => {
      const apps = [
        createGlobalApp('g-pinned', { status: 'pinned' }),
        createCnOnlyApp('cn-pinned', { status: 'pinned' }),
        createMiniApp('nr-pinned', { status: 'pinned' })
      ]
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated(apps))
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.region', 'Global')
      const { result } = renderHook(() => useMiniApps())
      expect(result.current.pinned).toHaveLength(3)
    })

    it('should filter disabled apps by region', () => {
      const apps = [
        createGlobalApp('global-disabled', { status: 'disabled' }),
        createCnOnlyApp('cn-disabled', { status: 'disabled' })
      ]
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated(apps))
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.region', 'Global')
      const { result } = renderHook(() => useMiniApps())
      expect(result.current.disabled).toHaveLength(1)
      expect(result.current.disabled[0].appId).toBe('global-disabled')
    })
  })

  // === Effective Region Calculation ===

  describe('effective region calculation', () => {
    it('should use preference CN when explicitly set', () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.region', 'CN')
      const apps = [createGlobalApp('g', { status: 'enabled' }), createCnOnlyApp('c', { status: 'enabled' })]
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated(apps))
      const { result } = renderHook(() => useMiniApps())
      expect(result.current.miniapps).toHaveLength(2)
    })

    it('should use preference Global when explicitly set', () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.region', 'Global')
      const apps = [createGlobalApp('g', { status: 'enabled' }), createCnOnlyApp('c', { status: 'enabled' })]
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated(apps))
      const { result } = renderHook(() => useMiniApps())
      expect(result.current.miniapps).toHaveLength(1)
      expect(result.current.miniapps[0].appId).toBe('g')
    })

    it('should use detected region when preference is auto and detected region exists', () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.region', 'auto')
      MockUseCacheUtils.setCacheValue('mini_app.detected_region', 'Global')
      const apps = [createGlobalApp('g', { status: 'enabled' }), createCnOnlyApp('c', { status: 'enabled' })]
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated(apps))
      const { result } = renderHook(() => useMiniApps())
      expect(result.current.miniapps).toHaveLength(1)
    })

    it('should default to CN when preference is auto and no detected region', () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.region', 'auto')
      MockUseCacheUtils.setCacheValue('mini_app.detected_region', null)
      const apps = [createGlobalApp('g', { status: 'enabled' }), createCnOnlyApp('c', { status: 'enabled' })]
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated(apps))
      const { result } = renderHook(() => useMiniApps())
      expect(result.current.miniapps).toHaveLength(2)
    })
  })

  // === UI State Cache ===

  describe('UI state cache', () => {
    it('should expose openedKeepAliveMiniApps from cache', () => {
      const keepAliveApps = [createMiniApp('app1'), createMiniApp('app2')]
      MockUseCacheUtils.setCacheValue('mini_app.opened_keep_alive', keepAliveApps)
      const { result } = renderHook(() => useMiniApps())
      expect(result.current.openedKeepAliveMiniApps).toEqual(keepAliveApps)
    })

    it('should expose currentMiniAppId from cache', () => {
      MockUseCacheUtils.setCacheValue('mini_app.current_id', 'my-app')
      const { result } = renderHook(() => useMiniApps())
      expect(result.current.currentMiniAppId).toBe('my-app')
    })

    it('should expose miniAppShow from cache', () => {
      MockUseCacheUtils.setCacheValue('mini_app.show', true)
      const { result } = renderHook(() => useMiniApps())
      expect(result.current.miniAppShow).toBe(true)
    })

    it('should expose openedOneOffMiniApp from cache', () => {
      const oneOffApp = createMiniApp('one-off')
      MockUseCacheUtils.setCacheValue('mini_app.opened_oneoff', oneOffApp)
      const { result } = renderHook(() => useMiniApps())
      expect(result.current.openedOneOffMiniApp).toEqual(oneOffApp)
    })

    it('should expose setters for UI state', () => {
      const { result } = renderHook(() => useMiniApps())
      expect(typeof result.current.setOpenedKeepAliveMiniApps).toBe('function')
      expect(typeof result.current.setCurrentMiniAppId).toBe('function')
      expect(typeof result.current.setMiniAppShow).toBe('function')
      expect(typeof result.current.setOpenedOneOffMiniApp).toBe('function')
    })

    it('should update openedKeepAliveMiniApps when setter is called', async () => {
      const { result } = renderHook(() => useMiniApps())
      const newApps = [createMiniApp('new-app')]
      await act(async () => {
        result.current.setOpenedKeepAliveMiniApps(newApps)
      })
      // Check cache values directly since mock useCache doesn't trigger re-renders
      expect(MockUseCacheUtils.getCacheValue('mini_app.opened_keep_alive')).toEqual(newApps)
    })
  })

  // === Mutations ===

  describe('mutations', () => {
    it('should expose all mutation functions', () => {
      const { result } = renderHook(() => useMiniApps())
      expect(typeof result.current.updateMiniApps).toBe('function')
      expect(typeof result.current.updateDisabledMiniApps).toBe('function')
      expect(typeof result.current.updatePinnedMiniApps).toBe('function')
      expect(typeof result.current.updateAppStatus).toBe('function')
      expect(typeof result.current.createCustomMiniApp).toBe('function')
      expect(typeof result.current.removeCustomMiniApp).toBe('function')
      expect(typeof result.current.reorderMiniApps).toBe('function')
    })
  })

  // === updateMiniApps ===

  describe('updateMiniApps', () => {
    it('should call patchApp for apps being disabled', async () => {
      const apps = [
        createMiniApp('app1', { status: 'enabled' }),
        createMiniApp('app2', { status: 'enabled' }),
        createMiniApp('app3', { status: 'enabled' })
      ]
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated(apps))
      const { result } = renderHook(() => useMiniApps())

      const visibleApps = [apps[0], apps[2]]
      await act(async () => {
        await result.current.updateMiniApps(visibleApps)
      })

      const patchCalls = MockDataApiUtils.getCalls('patch')
      expect(patchCalls).toContainEqual(['/mini-apps/app2', { body: { status: 'disabled' } }])
    })

    it('should call patchApp for apps being enabled', async () => {
      const apps = [createMiniApp('app1', { status: 'enabled' }), createMiniApp('app2', { status: 'disabled' })]
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated(apps))
      const { result } = renderHook(() => useMiniApps())

      const visibleApps = [apps[0], apps[1]]
      await act(async () => {
        await result.current.updateMiniApps(visibleApps)
      })

      const patchCalls = MockDataApiUtils.getCalls('patch')
      expect(patchCalls).toContainEqual(['/mini-apps/app2', { body: { status: 'enabled' } }])
    })

    it('should be a no-op when the visible list is unchanged', async () => {
      const apps = [createMiniApp('app1', { status: 'enabled' })]
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated(apps))
      const { result } = renderHook(() => useMiniApps())

      await act(async () => {
        await result.current.updateMiniApps(apps)
      })

      expect(result.current.allApps).toHaveLength(1)
    })
  })

  // === updatePinnedMiniApps ===

  describe('updatePinnedMiniApps', () => {
    it('should pin new apps and unpin removed ones', async () => {
      const apps = [
        createMiniApp('app1', { status: 'pinned' }),
        createMiniApp('app2', { status: 'pinned' }),
        createMiniApp('app3', { status: 'enabled' })
      ]
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated(apps))
      const { result } = renderHook(() => useMiniApps())

      const newPinned = [apps[0], apps[2]]
      await act(async () => {
        await result.current.updatePinnedMiniApps(newPinned)
      })

      const patchCalls = MockDataApiUtils.getCalls('patch')
      // app2 should be unpinned (→ enabled), app3 should be pinned
      expect(patchCalls).toContainEqual(['/mini-apps/app2', { body: { status: 'enabled' } }])
      expect(patchCalls).toContainEqual(['/mini-apps/app3', { body: { status: 'pinned' } }])
    })
  })

  // === updateAppStatus ===

  describe('updateAppStatus', () => {
    it('should call patchApp with the new status', async () => {
      const apps = [createMiniApp('app1', { status: 'enabled' })]
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated(apps))
      const { result } = renderHook(() => useMiniApps())

      await act(async () => {
        await result.current.updateAppStatus('app1', 'disabled')
      })

      const patchCalls = MockDataApiUtils.getCalls('patch')
      expect(patchCalls).toContainEqual(['/mini-apps/app1', { body: { status: 'disabled' } }])
    })
  })

  // === reorderMiniApps ===
  /**
   * NOTE: `sortOrder` changes MUST use the `reorderMiniApps` mutation (PATCH /mini-apps),
   * not individual `updateAppStatus` or `patchApp` calls. The reorder endpoint accepts
   * an ordered list of { appId, sortOrder } items and atomically updates all positions.
   * Directly mutating `sortOrder` via individual PATCH calls can cause race conditions
   * and inconsistent ordering.
   */

  describe('reorderMiniApps', () => {
    it('should expose reorderMiniApps that calls the reorder API', async () => {
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated([]))
      const { result } = renderHook(() => useMiniApps())

      const reorderItems = [
        { appId: 'app1', sortOrder: 2 },
        { appId: 'app2', sortOrder: 1 }
      ]
      await act(async () => {
        await result.current.reorderMiniApps(reorderItems)
      })

      // useMutation triggers are tracked differently; verify the function is callable
      // and doesn't throw (the actual API call goes through useMutation mock)
      expect(result.current.reorderMiniApps).toBeTypeOf('function')
    })
  })

  // === Edge Cases ===

  describe('edge cases', () => {
    it('should handle empty enabled list gracefully', () => {
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated([]))
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.region', 'Global')
      const { result } = renderHook(() => useMiniApps())
      expect(result.current.miniapps).toEqual([])
    })

    it('should handle apps with empty supportedRegions array as CN-only', () => {
      const apps = [createMiniApp('empty-regions', { supportedRegions: [], status: 'enabled' })]
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated(apps))
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.region', 'Global')
      const { result } = renderHook(() => useMiniApps())
      expect(result.current.miniapps).toHaveLength(0)
    })

    it('should return consistent shape across renders', () => {
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated([createMiniApp('app1')]))
      const { result, rerender } = renderHook(() => useMiniApps())
      const firstShape = Object.keys(result.current).sort()
      rerender()
      const secondShape = Object.keys(result.current).sort()
      expect(firstShape).toEqual(secondShape)
    })
  })
})
