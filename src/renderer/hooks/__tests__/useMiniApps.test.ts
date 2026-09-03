import i18n from '@renderer/i18n/resolver'
import { clearWebviewState, setWebviewLoaded } from '@renderer/utils/webviewStateManager'
import type { MiniApp } from '@shared/data/types/miniApp'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUseDataApi, MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockTabs = vi.hoisted(() => ({
  tabs: [] as Array<{ id: string; url: string }>,
  hasContext: true,
  closeTab: vi.fn(),
  updateTab: vi.fn()
}))

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))

vi.mock('@renderer/hooks/tab', () => ({
  useOptionalTabsContext: () =>
    mockTabs.hasContext
      ? {
          tabs: mockTabs.tabs,
          closeTab: mockTabs.closeTab,
          updateTab: mockTabs.updateTab
        }
      : null
}))

vi.mock('@renderer/utils/webviewStateManager', () => ({
  clearWebviewState: vi.fn(),
  setWebviewLoaded: vi.fn()
}))

import { __resetRegionDetectionForTesting, useMiniApps } from '../useMiniApps'
import { appFixtures, createCnOnlyApp, createGlobalApp, createMiniApp } from './fixtures/miniApp'

/** Helper: return the array directly since list() now returns a bare MiniApp[] */
const paginated = (items: MiniApp[]) => items
const mockClearWebviewState = vi.mocked(clearWebviewState)
const mockSetWebviewLoaded = vi.mocked(setWebviewLoaded)

/** Control the `system.get_ip_country` route on the ipcApi facade for region-detection tests. */
const mockIpCountry = (result: string | Error) => {
  mocks.request.mockImplementation((route: string) => {
    if (route === 'system.get_ip_country') {
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
    }
    return Promise.resolve(undefined)
  })
}

describe('useMiniApps', () => {
  beforeEach(() => {
    MockUseCacheUtils.resetMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUseDataApiUtils.resetMocks()
    MockUseDataApiUtils.mockQueryData('/mini-apps', paginated([]))

    mocks.request.mockReset()
    mockIpCountry('CN')

    // Reset module-level regionDetectionPromise to ensure fresh detection in each test
    __resetRegionDetectionForTesting()
    mockTabs.tabs = []
    mockTabs.hasContext = true
    mockTabs.closeTab.mockClear()
    mockTabs.updateTab.mockClear()
    mockClearWebviewState.mockClear()
    mockSetWebviewLoaded.mockClear()
  })

  describe('display name', () => {
    it('re-resolves a local app name when the UI language changes', async () => {
      // Main resolves `name` for the language at query time and the query is cached, so
      // a language switch left every installed app under its old name until some
      // unrelated write refreshed the list.
      const app = {
        kind: 'app',
        appId: 'com.example.a',
        name: 'Alpha',
        nameI18n: { en: 'Alpha', zh: '阿尔法' },
        url: 'cherry-miniapp://com.example.a/index.html',
        presetMiniAppId: null,
        status: 'enabled',
        orderKey: 'a0',
        version: '1.0.0',
        aiModelId: null,
        aiQuickModelId: null
      } as MiniApp
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated([app]))
      const { result } = renderHook(() => useMiniApps())
      try {
        await act(() => i18n.changeLanguage('zh-CN'))
        expect(result.current.allApps[0].name).toBe('阿尔法')
        await act(() => i18n.changeLanguage('en-US'))
        expect(result.current.allApps[0].name).toBe('Alpha')
      } finally {
        await act(() => i18n.changeLanguage('en-US'))
      }
    })
  })

  // === Data Loading ===

  describe('data loading', () => {
    it('keeps the catalog and region detection inactive when no consumer needs mini apps', () => {
      renderHook(() => useMiniApps({ enabled: false }))

      expect(MockUseDataApi.useQuery).toHaveBeenCalledWith('/mini-apps', { enabled: false })
      expect(mocks.request).not.toHaveBeenCalled()
    })

    it('should return empty arrays when no data', () => {
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated([]))
      const { result } = renderHook(() => useMiniApps())
      expect(result.current.allApps).toEqual([])
      expect(result.current.miniApps).toEqual([])
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
      // miniApps includes enabled + pinned apps (pinned apps remain visible in the grid)
      expect(result.current.miniApps).toHaveLength(3)
      expect(result.current.disabled).toHaveLength(1)
      expect(result.current.pinned).toHaveLength(1)
    })

    it('should expose isLoading state', () => {
      MockUseDataApiUtils.mockQueryLoading('/mini-apps')
      const { result } = renderHook(() => useMiniApps())
      expect(result.current.isLoading).toBe(true)
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
      expect(result.current.miniApps).toHaveLength(3)
    })

    it('should only show Global apps when region is Global', () => {
      const { mixedRegion } = appFixtures
      const apps = Object.values(mixedRegion).map((a) => ({ ...a, status: 'enabled' as const }))
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated(apps))
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.region', 'Global')
      const { result } = renderHook(() => useMiniApps())
      expect(result.current.miniApps).toHaveLength(1)
      expect(result.current.miniApps[0].appId).toBe('global-app')
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
      expect(result.current.miniApps).toHaveLength(1)
      expect(result.current.miniApps[0].appId).toBe('global-app')
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
      expect(result.current.miniApps).toHaveLength(2)
    })

    it('should use preference Global when explicitly set', () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.region', 'Global')
      const apps = [createGlobalApp('g', { status: 'enabled' }), createCnOnlyApp('c', { status: 'enabled' })]
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated(apps))
      const { result } = renderHook(() => useMiniApps())
      expect(result.current.miniApps).toHaveLength(1)
      expect(result.current.miniApps[0].appId).toBe('g')
    })

    it('should use detected region when preference is auto and detected region exists', () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.region', 'auto')
      MockUseCacheUtils.setCacheValue('mini_app.detected_region', 'Global')
      const apps = [createGlobalApp('g', { status: 'enabled' }), createCnOnlyApp('c', { status: 'enabled' })]
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated(apps))
      const { result } = renderHook(() => useMiniApps())
      expect(result.current.miniApps).toHaveLength(1)
    })

    it('should default to CN when preference is auto and no detected region', () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.region', 'auto')
      MockUseCacheUtils.setCacheValue('mini_app.detected_region', null)
      const apps = [createGlobalApp('g', { status: 'enabled' }), createCnOnlyApp('c', { status: 'enabled' })]
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated(apps))
      const { result } = renderHook(() => useMiniApps())
      expect(result.current.miniApps).toHaveLength(2)
    })
  })

  // === UI State Cache ===

  describe('UI state cache', () => {
    it('should expose miniapp UI state from cache', () => {
      const keepAliveApps = [createMiniApp('app1'), createMiniApp('app2')]
      const oneOffApp = createMiniApp('one-off')
      MockUseCacheUtils.setCacheValue('mini_app.opened_keep_alive', keepAliveApps)
      MockUseCacheUtils.setCacheValue('mini_app.current_id', 'my-app')
      MockUseCacheUtils.setCacheValue('mini_app.show', true)
      MockUseCacheUtils.setCacheValue('mini_app.opened_oneoff', oneOffApp)

      const { result } = renderHook(() => useMiniApps())

      expect(result.current.openedKeepAliveMiniApps).toEqual(keepAliveApps)
      expect(result.current.currentMiniAppId).toBe('my-app')
      expect(result.current.miniAppShow).toBe(true)
      expect(result.current.openedOneOffMiniApp).toEqual(oneOffApp)
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
    it('should sync opened cache, tab metadata, and webview state after updating a custom miniapp', async () => {
      const existing = createMiniApp('custom-app', {
        name: 'Old App',
        url: 'https://old.example.com',
        logo: 'old-logo',
        presetMiniAppId: null
      })
      const other = createMiniApp('other-app')
      const updated = {
        ...existing,
        name: 'New App',
        url: 'https://new.example.com',
        logo: 'new-logo'
      }
      const trigger = vi.fn().mockResolvedValue(updated)
      MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/mini-apps/:appId', trigger)
      MockUseCacheUtils.setCacheValue('mini_app.opened_keep_alive', [other, existing])
      MockUseCacheUtils.setCacheValue('mini_app.opened_oneoff', existing)
      mockTabs.tabs = [
        { id: 'tab-1', url: '/app/mini-app/custom-app' },
        { id: 'tab-2', url: '/app/mini-app/custom-app-extra' }
      ]

      const { result } = renderHook(() => useMiniApps())

      await act(async () => {
        await result.current.updateCustomMiniApp('custom-app', {
          name: 'New App',
          url: 'https://new.example.com'
        })
      })

      // Logo edits go through the `mini_app.settings.set_logo` command, not this PATCH;
      // the tab icon still resolves from the service's returned `logo`.
      expect(trigger).toHaveBeenCalledWith({
        params: { appId: 'custom-app' },
        body: {
          name: 'New App',
          url: 'https://new.example.com'
        }
      })
      expect(MockUseCacheUtils.getCacheValue('mini_app.opened_keep_alive')).toEqual([other, updated])
      expect(MockUseCacheUtils.getCacheValue('mini_app.opened_oneoff')).toEqual(updated)
      expect(mockSetWebviewLoaded).toHaveBeenCalledWith('custom-app', false)
      expect(mockTabs.updateTab).toHaveBeenCalledWith('tab-1', { title: 'New App', icon: 'new-logo' })
      expect(mockTabs.updateTab).not.toHaveBeenCalledWith('tab-2', expect.anything())
    })

    it('uses the service-resolved logoSrc as the file:// tab icon when syncing', async () => {
      const storedId = '0190f3c4-1a2b-7c3d-8e4f-5a6b7c8d9e0f'
      const existing = createMiniApp('custom-app', { presetMiniAppId: null })
      // The service returns an uploaded logo pre-resolved onto `logoSrc`.
      const updated = { ...existing, name: 'New App', logoSrc: `file:///files/${storedId}.webp` }
      const trigger = vi.fn().mockResolvedValue(updated)
      MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/mini-apps/:appId', trigger)
      mockTabs.tabs = [{ id: 'tab-1', url: '/app/mini-app/custom-app' }]

      const { result } = renderHook(() => useMiniApps())

      await act(async () => {
        await result.current.updateCustomMiniApp('custom-app', {
          name: 'New App'
        })
      })

      expect(trigger).toHaveBeenCalledWith({
        params: { appId: 'custom-app' },
        body: { name: 'New App' }
      })
      expect(mockTabs.updateTab).toHaveBeenCalledWith('tab-1', {
        title: 'New App',
        icon: `file:///files/${storedId}.webp`
      })
    })

    it('should clean opened cache, tabs, and webview state after removing a custom miniapp', async () => {
      const existing = createMiniApp('custom-app', { presetMiniAppId: null })
      const other = createMiniApp('other-app')
      const trigger = vi.fn().mockResolvedValue(undefined)
      MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/mini-apps/:appId', trigger)
      MockUseCacheUtils.setCacheValue('mini_app.opened_keep_alive', [existing, other])
      MockUseCacheUtils.setCacheValue('mini_app.opened_oneoff', existing)
      MockUseCacheUtils.setCacheValue('mini_app.current_id', 'custom-app')
      MockUseCacheUtils.setCacheValue('mini_app.show', true)
      mockTabs.tabs = [
        { id: 'tab-1', url: '/app/mini-app/custom-app' },
        { id: 'tab-2', url: '/app/mini-app/custom-app-extra' }
      ]

      const { result } = renderHook(() => useMiniApps())

      await act(async () => {
        await result.current.removeCustomMiniApp('custom-app')
      })

      expect(trigger).toHaveBeenCalledWith({ params: { appId: 'custom-app' } })
      expect(MockUseCacheUtils.getCacheValue('mini_app.opened_keep_alive')).toEqual([other])
      expect(MockUseCacheUtils.getCacheValue('mini_app.opened_oneoff')).toBeNull()
      expect(MockUseCacheUtils.getCacheValue('mini_app.current_id')).toBe('')
      expect(MockUseCacheUtils.getCacheValue('mini_app.show')).toBe(false)
      expect(mockClearWebviewState).toHaveBeenCalledWith('custom-app')
      expect(mockTabs.closeTab).toHaveBeenCalledWith('tab-1')
      expect(mockTabs.closeTab).not.toHaveBeenCalledWith('tab-2')
    })

    it('should collapse the split pane when the deleted custom miniapp is the one in it', async () => {
      const existing = createMiniApp('custom-app', { presetMiniAppId: null })
      const trigger = vi.fn().mockResolvedValue(undefined)
      MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/mini-apps/:appId', trigger)
      MockUseCacheUtils.setCacheValue('mini_app.opened_keep_alive', [existing])
      MockUseCacheUtils.setCacheValue('mini_app.split_open', true)
      MockUseCacheUtils.setCacheValue('mini_app.split_id', 'custom-app')

      const { result } = renderHook(() => useMiniApps())

      await act(async () => {
        await result.current.removeCustomMiniApp('custom-app')
      })

      // The deleted app can never fill the pane again, so a still-open split
      // just replaces it with a picker the user never asked for.
      expect(MockUseCacheUtils.getCacheValue('mini_app.split_id')).toBe('')
      expect(MockUseCacheUtils.getCacheValue('mini_app.split_open')).toBe(false)
    })

    it('should keep the split pane when the deleted custom miniapp is not the one in it', async () => {
      const trigger = vi.fn().mockResolvedValue(undefined)
      MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/mini-apps/:appId', trigger)
      MockUseCacheUtils.setCacheValue('mini_app.split_open', true)
      MockUseCacheUtils.setCacheValue('mini_app.split_id', 'other-app')

      const { result } = renderHook(() => useMiniApps())

      await act(async () => {
        await result.current.removeCustomMiniApp('custom-app')
      })

      expect(MockUseCacheUtils.getCacheValue('mini_app.split_id')).toBe('other-app')
      expect(MockUseCacheUtils.getCacheValue('mini_app.split_open')).toBe(true)
    })

    it('should remove deleted custom miniapps from sidebar favorites', async () => {
      const trigger = vi.fn().mockResolvedValue(undefined)
      MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/mini-apps/:appId', trigger)
      MockUsePreferenceUtils.setPreferenceValue('ui.sidebar.favorites', [
        { type: 'app', id: 'assistants' },
        { type: 'mini_app', id: 'custom-app' },
        { type: 'mini_app', id: 'other-app' }
      ])

      const { result } = renderHook(() => useMiniApps())

      await act(async () => {
        await result.current.removeCustomMiniApp('custom-app')
      })

      expect(trigger).toHaveBeenCalledWith({ params: { appId: 'custom-app' } })
      expect(MockUsePreferenceUtils.getPreferenceValue('ui.sidebar.favorites')).toEqual([
        { type: 'app', id: 'assistants' },
        { type: 'mini_app', id: 'other-app' }
      ])
    })
  })

  // === setAppStatusBulk ===

  describe('setAppStatusBulk', () => {
    it('submits every requested status change as one atomic batch', async () => {
      const apps = [createMiniApp('a', { status: 'enabled' }), createMiniApp('b', { status: 'disabled' })]
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated(apps))
      const trigger = vi.fn().mockResolvedValue(undefined)
      MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/mini-apps/status:batch', trigger)
      const { result } = renderHook(() => useMiniApps())
      const updates = [
        { appId: 'a', status: 'disabled' as const },
        { appId: 'b', status: 'enabled' as const }
      ]

      await act(async () => {
        await result.current.setAppStatusBulk(updates)
      })

      expect(trigger).toHaveBeenCalledExactlyOnceWith({ body: { updates } })
    })

    it('does not touch rows the caller never names — region-hidden apps stay put', async () => {
      // Replaces the legacy "updateMiniApps under Global mode disables CN apps"
      // bug. With the command-style API the caller only PATCHes what it names.
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.region', 'Global')
      const globalApp = createGlobalApp('globalA', { status: 'enabled' })
      const cnOnly = createCnOnlyApp('cnOnly', { status: 'enabled' })
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated([globalApp, cnOnly]))
      const trigger = vi.fn().mockResolvedValue(undefined)
      MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/mini-apps/status:batch', trigger)

      const { result } = renderHook(() => useMiniApps())

      // Hide the only visible Global app — should produce one PATCH for it,
      // never sweep the region-hidden CN app into disabled.
      await act(async () => {
        await result.current.setAppStatusBulk([{ appId: 'globalA', status: 'disabled' }])
      })

      expect(trigger).toHaveBeenCalledExactlyOnceWith({
        body: { updates: [{ appId: 'globalA', status: 'disabled' }] }
      })
    })

    it('returns immediately for an empty update list (no PATCH calls)', async () => {
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated([]))
      const trigger = vi.fn().mockResolvedValue(undefined)
      MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/mini-apps/status:batch', trigger)
      const { result } = renderHook(() => useMiniApps())

      await act(async () => {
        await result.current.setAppStatusBulk([])
      })

      expect(trigger).not.toHaveBeenCalled()
    })

    it('refreshes the mini-app list after a rejected batch', async () => {
      const trigger = vi.fn().mockRejectedValue(new Error('batch failed'))
      const invalidate = vi.fn().mockResolvedValue(undefined)
      MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/mini-apps/status:batch', trigger)
      MockUseDataApi.useInvalidateCache.mockReturnValueOnce(invalidate)
      const { result } = renderHook(() => useMiniApps())

      await act(async () => {
        await expect(result.current.setAppStatusBulk([{ appId: 'app1', status: 'enabled' }])).rejects.toThrow()
      })

      expect(invalidate).toHaveBeenCalledWith('/mini-apps')
    })
  })

  // === updateAppStatus ===

  describe('updateAppStatus', () => {
    it('should call the patch mutation trigger with the new status', async () => {
      const mockTrigger = vi.fn().mockResolvedValue({ success: true })
      const { mockUseMutation } = await import('@test-mocks/renderer/useDataApi')
      mockUseMutation.mockImplementation((method: string, path: string) => {
        if (method === 'PATCH' && path === '/mini-apps/:appId') {
          return { trigger: mockTrigger, isLoading: false, error: undefined }
        }
        return { trigger: vi.fn().mockResolvedValue({ success: true }), isLoading: false, error: undefined }
      })

      const apps = [createMiniApp('app1', { status: 'enabled' })]
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated(apps))
      const { result } = renderHook(() => useMiniApps())

      await act(async () => {
        await result.current.updateAppStatus('app1', 'disabled')
      })

      expect(mockTrigger).toHaveBeenCalledWith({ params: { appId: 'app1' }, body: { status: 'disabled' } })
    })

    it('should pass target placement with the status update', async () => {
      const mockTrigger = vi.fn().mockResolvedValue({ success: true })
      MockUseDataApi.useMutation.mockImplementation((method, path) => {
        if (method === 'PATCH' && path === '/mini-apps/:appId') {
          return { trigger: mockTrigger, isLoading: false, error: undefined }
        }
        return { trigger: vi.fn().mockResolvedValue({ success: true }), isLoading: false, error: undefined }
      })

      const { result } = renderHook(() => useMiniApps())

      await act(async () => {
        await result.current.updateAppStatus('app1', 'enabled', { before: 'anchor' })
      })

      expect(mockTrigger).toHaveBeenCalledWith({
        params: { appId: 'app1' },
        body: { status: 'enabled', order: { before: 'anchor' } }
      })
    })

    it('refreshes the mini-app list after a rejected status update', async () => {
      const trigger = vi.fn().mockRejectedValue(new Error('update failed'))
      const invalidate = vi.fn().mockResolvedValue(undefined)
      MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/mini-apps/:appId', trigger)
      MockUseDataApi.useInvalidateCache.mockReturnValueOnce(invalidate)
      const { result } = renderHook(() => useMiniApps())

      await act(async () => {
        await expect(result.current.updateAppStatus('app1', 'disabled')).rejects.toThrow()
      })

      expect(invalidate).toHaveBeenCalledWith('/mini-apps')
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
    it('should reorder visible apps against the displayed subset orderKey baseline', async () => {
      const patchOrderTrigger = vi.fn().mockResolvedValue(undefined)
      const patchBatchTrigger = vi.fn().mockResolvedValue(undefined)
      MockUseDataApi.useMutation.mockImplementation((method, path) => {
        if (method === 'PATCH' && path === '/mini-apps/:id/order') {
          return { trigger: patchOrderTrigger, isLoading: false, error: undefined }
        }
        if (method === 'PATCH' && path === '/mini-apps/order:batch') {
          return { trigger: patchBatchTrigger, isLoading: false, error: undefined }
        }
        return { trigger: vi.fn().mockResolvedValue({ success: true }), isLoading: false, error: undefined }
      })

      const enabled = createGlobalApp('enabled', { status: 'enabled', orderKey: 'a0' })
      const regionHidden = createCnOnlyApp('region-hidden', { status: 'enabled', orderKey: 'a1' })
      const pinned = createGlobalApp('pinned', { status: 'pinned', orderKey: 'b0' })
      const hidden = createMiniApp('hidden', { status: 'disabled', orderKey: 'a0' })
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated([pinned, enabled, regionHidden, hidden]))
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.region', 'Global')

      const { result } = renderHook(() => useMiniApps())

      expect(result.current.miniApps.map((app) => app.appId)).toEqual(['enabled', 'pinned'])

      await act(async () => {
        await result.current.reorderMiniAppsByStatus('visible', [pinned, enabled])
      })

      expect(patchOrderTrigger).toHaveBeenCalledWith({ params: { id: 'pinned' }, body: { position: 'first' } })
      expect(patchBatchTrigger).not.toHaveBeenCalled()
    })

    it('reorders against post-refresh cache membership, not the stale render snapshot', async () => {
      const patchOrderTrigger = vi.fn().mockResolvedValue(undefined)
      const patchBatchTrigger = vi.fn().mockResolvedValue(undefined)
      MockUseDataApi.useMutation.mockImplementation((method, path) => {
        if (method === 'PATCH' && path === '/mini-apps/:id/order') {
          return { trigger: patchOrderTrigger, isLoading: false, error: undefined }
        }
        if (method === 'PATCH' && path === '/mini-apps/order:batch') {
          return { trigger: patchBatchTrigger, isLoading: false, error: undefined }
        }
        return { trigger: vi.fn().mockResolvedValue({ success: true }), isLoading: false, error: undefined }
      })

      const chatgptDisabled = createMiniApp('chatgpt', { status: 'disabled', orderKey: 'a0' })
      const claude = createMiniApp('claude', { status: 'enabled', orderKey: 'a1' })
      const chatgptEnabledTail = createMiniApp('chatgpt', { status: 'enabled', orderKey: 'a2' })

      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated([chatgptDisabled, claude]))
      MockUseDataApiUtils.seedCache('/mini-apps', paginated([chatgptDisabled, claude]))

      const { result } = renderHook(() => useMiniApps())
      expect(result.current.allApps.find((app) => app.appId === 'chatgpt')?.status).toBe('disabled')

      // Status PATCH + refresh already wrote SWR; React has not re-rendered.
      MockUseDataApiUtils.seedCache('/mini-apps', paginated([claude, chatgptEnabledTail]))

      await act(async () => {
        await result.current.reorderMiniAppsByStatus('visible', [chatgptEnabledTail, claude])
      })

      expect(patchOrderTrigger).toHaveBeenCalledWith({ params: { id: 'chatgpt' }, body: { position: 'first' } })
      expect(patchBatchTrigger).not.toHaveBeenCalled()
    })

    it('serializes overlapping partition reorders and reads the refreshed baseline for the second request', async () => {
      const firstRequest = Promise.withResolvers<void>()
      const patchOrderTrigger = vi
        .fn()
        .mockImplementationOnce(() => firstRequest.promise)
        .mockResolvedValueOnce(undefined)
      MockUseDataApi.useMutation.mockImplementation((method, path) => {
        if (method === 'PATCH' && path === '/mini-apps/:id/order') {
          return { trigger: patchOrderTrigger, isLoading: false, error: undefined }
        }
        return { trigger: vi.fn().mockResolvedValue({ success: true }), isLoading: false, error: undefined }
      })

      const a = createMiniApp('a', { status: 'disabled', orderKey: 'a0' })
      const b = createMiniApp('b', { status: 'disabled', orderKey: 'a1' })
      const c = createMiniApp('c', { status: 'disabled', orderKey: 'a2' })
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated([a, b, c]))
      MockUseDataApiUtils.seedCache('/mini-apps', paginated([a, b, c]))
      const { result } = renderHook(() => useMiniApps())

      let firstReorder!: Promise<void>
      let secondReorder!: Promise<void>
      act(() => {
        firstReorder = result.current.reorderMiniAppsByStatus('disabled', [c, a, b])
        secondReorder = result.current.reorderMiniAppsByStatus('disabled', [b, c, a])
      })

      await vi.waitFor(() => expect(patchOrderTrigger).toHaveBeenCalledTimes(1))
      expect(patchOrderTrigger).toHaveBeenNthCalledWith(1, { params: { id: 'c' }, body: { position: 'first' } })

      MockUseDataApiUtils.seedCache(
        '/mini-apps',
        paginated([
          { ...c, orderKey: 'a0' },
          { ...a, orderKey: 'a1' },
          { ...b, orderKey: 'a2' }
        ])
      )
      firstRequest.resolve()
      await act(async () => Promise.all([firstReorder, secondReorder]))

      expect(patchOrderTrigger).toHaveBeenCalledTimes(2)
      expect(patchOrderTrigger).toHaveBeenNthCalledWith(2, { params: { id: 'b' }, body: { position: 'first' } })
    })
  })

  // === Edge Cases ===

  describe('edge cases', () => {
    it('should handle preset apps with empty supportedRegions array as CN-only', () => {
      const apps = [createMiniApp('empty-regions', { supportedRegions: [], status: 'enabled' })]
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated(apps))
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.region', 'Global')
      const { result } = renderHook(() => useMiniApps())
      expect(result.current.miniApps).toHaveLength(0)
    })

    it('should treat custom apps without supportedRegions as visible everywhere', () => {
      // Custom rows (presetMiniAppId === null) without region info come from
      // migrated v1 data or hand-added apps. Defaulting them to CN-only would
      // hide a user's own app under Global.
      const apps = [createMiniApp('mine', { presetMiniAppId: null, status: 'enabled' })]
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated(apps))
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.region', 'Global')
      const { result } = renderHook(() => useMiniApps())
      expect(result.current.miniApps).toHaveLength(1)
    })
  })

  // === Region Auto-Detection ===

  describe('region auto-detection', () => {
    beforeEach(() => {
      // Reset the module-level promise between tests
      // We need to re-import the module or access the internal state
      // Since regionDetectionPromise is module-scoped, we test via the hook's useEffect
    })

    it('should call setDetectedRegion with CN when IP resolves to CN', async () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.region', 'auto')
      MockUseCacheUtils.setCacheValue('mini_app.detected_region', null)
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated([]))

      mockIpCountry('CN')

      renderHook(() => useMiniApps())

      // Wait for the async detection to complete
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      expect(MockUseCacheUtils.getCacheValue('mini_app.detected_region')).toBe('CN')
    })

    it('should call setDetectedRegion with Global when IP resolves to US', async () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.region', 'auto')
      MockUseCacheUtils.setCacheValue('mini_app.detected_region', null)
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated([]))

      mockIpCountry('US')

      renderHook(() => useMiniApps())

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      expect(MockUseCacheUtils.getCacheValue('mini_app.detected_region')).toBe('Global')
    })

    it('should fallback to CN when IP detection rejects', async () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.region', 'auto')
      MockUseCacheUtils.setCacheValue('mini_app.detected_region', null)
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated([]))

      mockIpCountry(new Error('Network error'))

      renderHook(() => useMiniApps())

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      expect(MockUseCacheUtils.getCacheValue('mini_app.detected_region')).toBe('CN')
    })

    it('should not call detectUserRegion when region is explicitly set', async () => {
      MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.region', 'Global')
      MockUseCacheUtils.setCacheValue('mini_app.detected_region', null)
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated([]))

      mockIpCountry('US')

      renderHook(() => useMiniApps())

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      // IP detection should not be called when region is explicitly set
      expect(mocks.request).not.toHaveBeenCalledWith('system.get_ip_country')
    })
  })

  describe('setAppStatusBulk failure', () => {
    it('surfaces a rejected atomic batch', async () => {
      const apps = [createMiniApp('app1', { status: 'disabled' }), createMiniApp('app2', { status: 'disabled' })]
      MockUseDataApiUtils.mockQueryData('/mini-apps', paginated(apps))
      const trigger = vi.fn().mockRejectedValue(new Error('Server error'))
      MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/mini-apps/status:batch', trigger)

      const { result } = renderHook(() => useMiniApps())

      await act(async () => {
        await expect(
          result.current.setAppStatusBulk([
            { appId: 'app1', status: 'enabled' },
            { appId: 'app2', status: 'enabled' }
          ])
        ).rejects.toThrow()
      })
    })
  })
})
