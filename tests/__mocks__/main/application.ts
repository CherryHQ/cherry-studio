import { vi } from 'vitest'

import { MockMainCacheServiceExport } from './CacheService'
import { MockMainDataApiServiceExport } from './DataApiService'
import { MockMainDbServiceExport } from './DbService'
import { MockMainPreferenceServiceExport } from './PreferenceService'

/**
 * Unified mock application factory for main process testing.
 *
 * Usage in vi.mock():
 *   vi.mock('@application', async () => {
 *     const { mockApplicationFactory } = await import('@test-mocks/main/application')
 *     return mockApplicationFactory()
 *   })
 *
 * With service overrides:
 *   vi.mock('@application', async () => {
 *     const { mockApplicationFactory } = await import('@test-mocks/main/application')
 *     return mockApplicationFactory({
 *       DbService: { getDb: () => customMockDb }
 *     })
 *   })
 */

/** Minimal MainWindowService mock for tests that access application.get('MainWindowService') */
const mockMainWindowService = {
  getMainWindow: vi.fn(() => null),
  showMainWindow: vi.fn(),
  toggleMainWindow: vi.fn(),
  quoteToMainWindow: vi.fn()
}

/**
 * Minimal WindowManager mock — consumers that used to read
 * `application.get('MainWindowService').getMainWindow()?.webContents.send(...)`
 * now go through `WindowManager.broadcastToType(WindowType.Main, ...)`.
 * Tests can assert on these spies directly.
 */
const mockWindowManager = {
  broadcast: vi.fn(),
  broadcastToType: vi.fn(),
  getWindow: vi.fn(() => undefined),
  getWindowsByType: vi.fn(() => []),
  getAllWindows: vi.fn(() => []),
  getWindowInfo: vi.fn(() => undefined),
  getWindowId: vi.fn(() => undefined),
  getWindowIdByWebContents: vi.fn(() => undefined),
  open: vi.fn(() => 'mock-window-id'),
  close: vi.fn(() => true),
  show: vi.fn(() => true),
  hide: vi.fn(() => true),
  focus: vi.fn(() => true),
  onWindowCreated: vi.fn(() => ({ dispose: vi.fn() })),
  onWindowDestroyed: vi.fn(() => ({ dispose: vi.fn() })),
  onWindowCreatedByType: vi.fn(() => ({ dispose: vi.fn() })),
  onWindowDestroyedByType: vi.fn(() => ({ dispose: vi.fn() }))
}

/**
 * Minimal IpcApiService mock — services push main→renderer events via
 * `application.get('IpcApiService').send(windowId, event, payload)` (directed) or
 * `.broadcast(event, payload)` (all windows). Tests can assert on these spies.
 */
const mockIpcApiService = {
  send: vi.fn(),
  broadcast: vi.fn()
}

/** Default service instances from existing mock files */
export const defaultServiceInstances = {
  PreferenceService: MockMainPreferenceServiceExport.preferenceService,
  CacheService: MockMainCacheServiceExport.cacheService,
  DataApiService: MockMainDataApiServiceExport.dataApiService,
  DbService: MockMainDbServiceExport.dbService,
  MainWindowService: mockMainWindowService,
  WindowManager: mockWindowManager,
  IpcApiService: mockIpcApiService
} as const

/** Type for per-service overrides */
export type ServiceOverrides = Partial<Record<keyof typeof defaultServiceInstances, unknown>>

/**
 * Create a mock application object with optional service overrides.
 * Services not overridden use the default mock from tests/__mocks__/main/.
 */
export function createMockApplication(overrides: ServiceOverrides = {}) {
  const serviceInstances = { ...defaultServiceInstances, ...overrides }

  // Mirror production: `application.get(name)` delegates to `container.get(name)`
  // (Application.get → this.container.get) and `getContainer()` returns the SAME
  // instance. `get` lives on the prototype (class method), so code that
  // temporarily overrides `container.get` and restores it by deleting the own
  // property behaves exactly as it does against the real ServiceContainer.
  class MockServiceContainer {
    get(name: string) {
      if (name in serviceInstances) {
        return serviceInstances[name as keyof typeof serviceInstances]
      }
      throw new Error(`[MockApplication] Unknown service: ${name}`)
    }
    has(name: string) {
      return name in serviceInstances
    }
    register() {}
    setInstance() {}
  }
  const container = new MockServiceContainer()

  return {
    get: vi.fn((name: string) => container.get(name)),
    getContainer: vi.fn(() => container),
    // Deterministic stub for path lookups — returns "/mock/<key>" (or
    // "/mock/<key>/<filename>") so tests that instantiate services with
    // class field initializers like `application.getPath('feature.xxx')`
    // don't blow up. Override per-test with vi.spyOn if you need a
    // specific value.
    getPath: vi.fn((key: string, filename?: string) => (filename ? `/mock/${key}/${filename}` : `/mock/${key}`)),
    registerAll: vi.fn(),
    initPathRegistry: vi.fn(),
    bootstrap: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn(() => true),
    // Graceful quit entry point (real Application.quit()). Tests can assert it was called.
    quit: vi.fn(),
    // Tests can mutate `application.isQuitting = true` to exercise quit-aware code paths.
    isQuitting: false
  }
}

/**
 * Create the full mock module for vi.mock('@application', ...).
 * Returns { application, serviceList }.
 */
export function mockApplicationFactory(overrides: ServiceOverrides = {}) {
  return {
    application: createMockApplication(overrides),
    serviceList: []
  }
}
