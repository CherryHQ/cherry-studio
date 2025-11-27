/**
 * Vitest Setup File
 * Global test configuration and mocks for @cherrystudio/ai-core package
 */

import { vi } from 'vitest'

// Mock Vite SSR helper to avoid Node environment errors
;(globalThis as any).__vite_ssr_exportName__ = (_name: string, value: any) => value

// Global mock for @cherrystudio/ai-sdk-provider
// This prevents import errors when testing modules that import this package
vi.mock('@cherrystudio/ai-sdk-provider', () => ({
  createCherryIn: vi.fn(() => ({
    languageModel: vi.fn(),
    textEmbeddingModel: vi.fn()
  })),
  // Export empty type to satisfy TypeScript
  CherryInProviderSettings: {}
}))
