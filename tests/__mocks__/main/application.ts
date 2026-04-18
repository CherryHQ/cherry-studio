import { vi } from 'vitest'

import { MockMainCacheServiceExport } from './CacheService'
import { MockMainDataApiServiceExport } from './DataApiService'
import { MockMainDbServiceExport } from './DbService'
import { MockMainDoc2xRuntimeServiceExport } from './Doc2xRuntimeService'
import { MockMainFileProcessingRuntimeServiceExport } from './FileProcessingRuntimeService'
import { MockMainOpenMineruRuntimeServiceExport } from './OpenMineruRuntimeService'
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

/** Minimal WindowService mock for tests that access application.get('WindowService') */
const mockWindowService = {
  getMainWindow: vi.fn(() => null),
  showMainWindow: vi.fn()
}

/** Default service instances from existing mock files */
export const defaultServiceInstances = {
  PreferenceService: MockMainPreferenceServiceExport.preferenceService,
  CacheService: MockMainCacheServiceExport.cacheService,
  DataApiService: MockMainDataApiServiceExport.dataApiService,
  DbService: MockMainDbServiceExport.dbService,
  FileProcessingRuntimeService: MockMainFileProcessingRuntimeServiceExport.fileProcessingRuntimeService,
  Doc2xRuntimeService: MockMainDoc2xRuntimeServiceExport.doc2xRuntimeService,
  TesseractRuntimeService: MockMainTesseractRuntimeServiceExport.tesseractRuntimeService,
  OpenMineruRuntimeService: MockMainOpenMineruRuntimeServiceExport.openMineruRuntimeService,
  WindowService: mockWindowService
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
