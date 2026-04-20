import { vi } from 'vitest'

import { MockMainCacheServiceExport } from './CacheService'
import { MockMainDataApiServiceExport } from './DataApiService'
import { MockMainDbServiceExport } from './DbService'
import { MockMainMarkdownTaskServiceExport } from './MarkdownTaskService'
import { MockMainPreferenceServiceExport } from './PreferenceService'
import { MockMainTesseractRuntimeServiceExport } from './TesseractRuntimeService'

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

/** Default service instances from existing mock files */
export const defaultServiceInstances = {
  PreferenceService: MockMainPreferenceServiceExport.preferenceService,
  CacheService: MockMainCacheServiceExport.cacheService,
  DataApiService: MockMainDataApiServiceExport.dataApiService,
  DbService: MockMainDbServiceExport.dbService,
  MarkdownTaskService: MockMainMarkdownTaskServiceExport.markdownTaskService,
  TesseractRuntimeService: MockMainTesseractRuntimeServiceExport.tesseractRuntimeService,
  MainWindowService: mockMainWindowService,
  WindowManager: mockWindowManager
} as const

/** Type for per-service overrides */
export type ServiceOverrides = Partial<Record<keyof typeof defaultServiceInstances, unknown>>

/**
 * Create a mock application object with optional service overrides.
 * Services not overridden use the default mock from tests/__mocks__/main/.
 */
export function createMockApplication(overrides: ServiceOverrides = {}) {
  const serviceInstances = { ...defaultServiceInstances, ...overrides }

  return {
    get: vi.fn((name: string) => {
      if (name in serviceInstances) {
        return serviceInstances[name as keyof typeof serviceInstances]
      }
      throw new Error(`[MockApplication] Unknown service: ${name}`)
    }),
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
