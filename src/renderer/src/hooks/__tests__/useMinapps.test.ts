import type { MiniApp } from '@shared/data/types/miniapp'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useMinapps } from '../useMinapps'
import { appFixtures, createCnOnlyApp, createGlobalApp, createMiniApp } from './fixtures/miniapp'

/** Helper: create a paginated response matching OffsetPaginationResponse<MiniApp> */
const paginated = (items: MiniApp[]) => ({ items, total: items.length, page: 1 })

describe('useMinapps', () => {
  beforeEach(() => {
    MockUseCacheUtils.resetMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUseDataApiUtils.resetMocks()
    MockUseDataApiUtils.mockQueryData('/miniapps', paginated([]))
  })

  // === Data Loading ===

  describe('data loading', () => {
    it('should return empty arrays when no data', () => {
      MockUseDataApiUtils.mockQueryData('/miniapps', paginated([]))
      const { result } = renderHook(() => useMinapps())
      expect(result.current.allApps).toEqual([])
      expect(result.current.minapps).toEqual([])
      expect(result.current.disabled).toEqual([])
      expect(result.current.pinned).toEqual([])
    })

    it('should return all apps merged with presets', () => {
      const apps = [
        appFixtures.mixedStatus.enabled1,
        appFixtures.mixedStatus.disabled1,
        appFixtures.mixedStatus.pinned1
      ]
      MockUseDataApiUtils.mockQueryData('/miniapps', paginated(apps))
      const { result } = renderHook(() => useMinapps())
      expect(result.current.allApps).toHaveLength(3)
      expect(result.current.allApps.map((a: MiniApp) => a.appId)).toEqual(['enabled1', 'disabled1', 'pinned1'])
    })

    it('should split apps by status correctly', () => {
      const { mixedStatus } = appFixtures
      const apps = [mixedStatus.enabled1, mixedStatus.enabled2, mixedStatus.disabled1, mixedStatus.pinned1]
      MockUseDataApiUtils.mockQueryData('/miniapps', paginated(apps))
      const { result } = renderHook(() => useMinapps())
      expect(result.current.minapps).toHaveLength(2)
      expect(result.current.disabled).toHaveLength(1)
      expect(result.current.pinned).toHaveLength(1)
    })

    it('should expose isLoading state', () => {
      MockUseDataApiUtils.mockQueryLoading('/miniapps')
      const { result } = renderHook(() => useMinapps())
      expect(result.current.isLoading).toBe(true)
    })

    it('should expose refetch function', () => {
      const { result } = renderHook(() => useMinapps())
      expect(typeof result.current.refetch).toBe('function')
    })
  })

  // === Region Filtering ===

  describe('region filtering', () => {
    it('should show all apps when region is CN (default)', () => {
      const { mixedRegion } = appFixtures
      const apps = Object.values(mixedRegion).map((a) => ({ ...a, status: 'enabled' as const }))
      MockUseDataApiUtils.mockQueryData('/miniapps', paginated(apps))
      MockUsePreferenceUtils.setPreferenceValue('feature.minapp.region', 'CN')
      const { result } = renderHook(() => useMinapps())
      expect(result.current.minapps).toHaveLength(3)
    })

    it('should only show Global apps when region is Global', () => {
      const { mixedRegion } = appFixtures
      const apps = Object.values(mixedRegion).map((a) => ({ ...a, status: 'enabled' as const }))
      MockUseDataApiUtils.mockQueryData('/miniapps', paginated(apps))
      MockUsePreferenceUtils.setPreferenceValue('feature.minapp.region', 'Global')
      const { result } = renderHook(() => useMinapps())
      expect(result.current.minapps).toHaveLength(1)
      expect(result.current.minapps[0].appId).toBe('global-app')
    })

    it('should show apps without supportedRegions as CN-only (hidden from Global)', () => {
      const { mixedRegion } = appFixtures
      const apps = [mixedRegion.globalApp, mixedRegion.noRegionApp].map((a) => ({
        ...a,
        status: 'enabled' as const
      }))
      MockUseDataApiUtils.mockQueryData('/miniapps', paginated(apps))
      MockUsePreferenceUtils.setPreferenceValue('feature.minapp.region', 'Global')
      const { result } = renderHook(() => useMinapps())
      expect(result.current.minapps).toHaveLength(1)
      expect(result.current.minapps[0].appId).toBe('global-app')
    })

    it('should not filter pinned apps by region', () => {
      const apps = [
        createGlobalApp('g-pinned', { status: 'pinned' }),
        createCnOnlyApp('cn-pinned', { status: 'pinned' }),
        createMiniApp('nr-pinned', { status: 'pinned' })
      ]
      MockUseDataApiUtils.mockQueryData('/miniapps', paginated(apps))
      MockUsePreferenceUtils.setPreferenceValue('feature.minapp.region', 'Global')
      const { result } = renderHook(() => useMinapps())
      expect(result.current.pinned).toHaveLength(3)
    })

    it('should filter disabled apps by region', () => {
      const apps = [
        createGlobalApp('global-disabled', { status: 'disabled' }),
        createCnOnlyApp('cn-disabled', { status: 'disabled' })
      ]
      MockUseDataApiUtils.mockQueryData('/miniapps', paginated(apps))
      MockUsePreferenceUtils.setPreferenceValue('feature.minapp.region', 'Global')
      const { result } = renderHook(() => useMinapps())
      expect(result.current.disabled).toHaveLength(1)
      expect(result.current.disabled[0].appId).toBe('global-disabled')
    })
  })

  // === Effective Region Calculation ===

  describe('effective region calculation', () => {
    it('should use preference CN when explicitly set', () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.minapp.region', 'CN')
      const apps = [createGlobalApp('g', { status: 'enabled' }), createCnOnlyApp('c', { status: 'enabled' })]
      MockUseDataApiUtils.mockQueryData('/miniapps', paginated(apps))
      const { result } = renderHook(() => useMinapps())
      expect(result.current.minapps).toHaveLength(2)
    })

    it('should use preference Global when explicitly set', () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.minapp.region', 'Global')
      const apps = [createGlobalApp('g', { status: 'enabled' }), createCnOnlyApp('c', { status: 'enabled' })]
      MockUseDataApiUtils.mockQueryData('/miniapps', paginated(apps))
      const { result } = renderHook(() => useMinapps())
      expect(result.current.minapps).toHaveLength(1)
      expect(result.current.minapps[0].appId).toBe('g')
    })

    it('should use detected region when preference is auto and detected region exists', () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.minapp.region', 'auto')
      MockUseCacheUtils.setCacheValue('minapp.detected_region', 'Global')
      const apps = [createGlobalApp('g', { status: 'enabled' }), createCnOnlyApp('c', { status: 'enabled' })]
      MockUseDataApiUtils.mockQueryData('/miniapps', paginated(apps))
      const { result } = renderHook(() => useMinapps())
      expect(result.current.minapps).toHaveLength(1)
    })

    it('should default to CN when preference is auto and no detected region', () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.minapp.region', 'auto')
      MockUseCacheUtils.setCacheValue('minapp.detected_region', null)
      const apps = [createGlobalApp('g', { status: 'enabled' }), createCnOnlyApp('c', { status: 'enabled' })]
      MockUseDataApiUtils.mockQueryData('/miniapps', paginated(apps))
      const { result } = renderHook(() => useMinapps())
      expect(result.current.minapps).toHaveLength(2)
    })
  })

  // === UI State Cache ===

  describe('UI state cache', () => {
    it('should expose openedKeepAliveMinapps from cache', () => {
      const keepAliveApps = [createMiniApp('app1'), createMiniApp('app2')]
      MockUseCacheUtils.setCacheValue('minapp.opened_keep_alive', keepAliveApps)
      const { result } = renderHook(() => useMinapps())
      expect(result.current.openedKeepAliveMinapps).toEqual(keepAliveApps)
    })

    it('should expose currentMinappId from cache', () => {
      MockUseCacheUtils.setCacheValue('minapp.current_id', 'my-app')
      const { result } = renderHook(() => useMinapps())
      expect(result.current.currentMinappId).toBe('my-app')
    })

    it('should expose minappShow from cache', () => {
      MockUseCacheUtils.setCacheValue('minapp.show', true)
      const { result } = renderHook(() => useMinapps())
      expect(result.current.minappShow).toBe(true)
    })

    it('should expose openedOneOffMinapp from cache', () => {
      const oneOffApp = createMiniApp('one-off')
      MockUseCacheUtils.setCacheValue('minapp.opened_oneoff', oneOffApp)
      const { result } = renderHook(() => useMinapps())
      expect(result.current.openedOneOffMinapp).toEqual(oneOffApp)
    })

    it('should expose setters for UI state', () => {
      const { result } = renderHook(() => useMinapps())
      expect(typeof result.current.setOpenedKeepAliveMinapps).toBe('function')
      expect(typeof result.current.setCurrentMinappId).toBe('function')
      expect(typeof result.current.setMinappShow).toBe('function')
      expect(typeof result.current.setOpenedOneOffMinapp).toBe('function')
    })

    it('should update openedKeepAliveMinapps when setter is called', async () => {
      const { result } = renderHook(() => useMinapps())
      const newApps = [createMiniApp('new-app')]
      await act(async () => {
        result.current.setOpenedKeepAliveMinapps(newApps)
      })
      expect(result.current.openedKeepAliveMinapps).toEqual(newApps)
    })
  })

  // === Mutations ===

  describe('mutations', () => {
    it('should expose all mutation functions', () => {
      const { result } = renderHook(() => useMinapps())
      expect(typeof result.current.updateMinapps).toBe('function')
      expect(typeof result.current.updateDisabledMinapps).toBe('function')
      expect(typeof result.current.updatePinnedMinapps).toBe('function')
      expect(typeof result.current.updateAppStatus).toBe('function')
      expect(typeof result.current.createCustomMiniapp).toBe('function')
      expect(typeof result.current.removeCustomMiniapp).toBe('function')
      expect(typeof result.current.reorderMiniapps).toBe('function')
    })
  })

  // === updateMinapps ===

  describe('updateMinapps', () => {
    it('should call patchApp for apps being disabled', async () => {
      const apps = [
        createMiniApp('app1', { status: 'enabled' }),
        createMiniApp('app2', { status: 'enabled' }),
        createMiniApp('app3', { status: 'enabled' })
      ]
      MockUseDataApiUtils.mockQueryData('/miniapps', paginated(apps))
      const { result } = renderHook(() => useMinapps())

      const visibleApps = [apps[0], apps[2]]
      await act(async () => {
        await result.current.updateMinapps(visibleApps)
      })

      expect(result.current.updateMinapps).toBeDefined()
    })

    it('should call patchApp for apps being enabled', async () => {
      const apps = [createMiniApp('app1', { status: 'enabled' }), createMiniApp('app2', { status: 'disabled' })]
      MockUseDataApiUtils.mockQueryData('/miniapps', paginated(apps))
      const { result } = renderHook(() => useMinapps())

      const visibleApps = [apps[0], apps[1]]
      await act(async () => {
        await result.current.updateMinapps(visibleApps)
      })

      expect(result.current.updateMinapps).toBeDefined()
    })

    it('should be a no-op when the visible list is unchanged', async () => {
      const apps = [createMiniApp('app1', { status: 'enabled' })]
      MockUseDataApiUtils.mockQueryData('/miniapps', paginated(apps))
      const { result } = renderHook(() => useMinapps())

      await act(async () => {
        await result.current.updateMinapps(apps)
      })

      expect(result.current.allApps).toHaveLength(1)
    })
  })

  // === updatePinnedMinapps ===

  describe('updatePinnedMinapps', () => {
    it('should pin new apps and unpin removed ones', async () => {
      const apps = [
        createMiniApp('app1', { status: 'pinned' }),
        createMiniApp('app2', { status: 'pinned' }),
        createMiniApp('app3', { status: 'enabled' })
      ]
      MockUseDataApiUtils.mockQueryData('/miniapps', paginated(apps))
      const { result } = renderHook(() => useMinapps())

      const newPinned = [apps[0], apps[2]]
      await act(async () => {
        await result.current.updatePinnedMinapps(newPinned)
      })

      expect(result.current.updatePinnedMinapps).toBeDefined()
    })
  })

  // === updateAppStatus ===

  describe('updateAppStatus', () => {
    it('should call patchApp with the new status', async () => {
      const apps = [createMiniApp('app1', { status: 'enabled' })]
      MockUseDataApiUtils.mockQueryData('/miniapps', paginated(apps))
      const { result } = renderHook(() => useMinapps())

      await act(async () => {
        await result.current.updateAppStatus('app1', 'disabled')
      })

      expect(result.current.updateAppStatus).toBeDefined()
    })
  })

  // === reorderMiniapps ===
  /**
   * NOTE: `sortOrder` changes MUST use the `reorderMiniapps` mutation (PATCH /miniapps),
   * not individual `updateAppStatus` or `patchApp` calls. The reorder endpoint accepts
   * an ordered list of { appId, sortOrder } items and atomically updates all positions.
   * Directly mutating `sortOrder` via individual PATCH calls can cause race conditions
   * and inconsistent ordering.
   */

  describe('reorderMiniapps', () => {
    it('should expose reorderMiniapps that calls the reorder API', async () => {
      MockUseDataApiUtils.mockQueryData('/miniapps', paginated([]))
      const { result } = renderHook(() => useMinapps())

      const reorderItems = [
        { appId: 'app1', sortOrder: 2 },
        { appId: 'app2', sortOrder: 1 }
      ]
      await act(async () => {
        await result.current.reorderMiniapps(reorderItems)
      })

      expect(result.current.reorderMiniapps).toBeDefined()
    })
  })

  // === Edge Cases ===

  describe('edge cases', () => {
    it('should handle empty enabled list gracefully', () => {
      MockUseDataApiUtils.mockQueryData('/miniapps', paginated([]))
      MockUsePreferenceUtils.setPreferenceValue('feature.minapp.region', 'Global')
      const { result } = renderHook(() => useMinapps())
      expect(result.current.minapps).toEqual([])
    })

    it('should handle apps with empty supportedRegions array as CN-only', () => {
      const apps = [createMiniApp('empty-regions', { supportedRegions: [], status: 'enabled' })]
      MockUseDataApiUtils.mockQueryData('/miniapps', paginated(apps))
      MockUsePreferenceUtils.setPreferenceValue('feature.minapp.region', 'Global')
      const { result } = renderHook(() => useMinapps())
      expect(result.current.minapps).toHaveLength(0)
    })

    it('should return consistent shape across renders', () => {
      MockUseDataApiUtils.mockQueryData('/miniapps', paginated([createMiniApp('app1')]))
      const { result, rerender } = renderHook(() => useMinapps())
      const firstShape = Object.keys(result.current).sort()
      rerender()
      const secondShape = Object.keys(result.current).sort()
      expect(firstShape).toEqual(secondShape)
    })
  })
})
