import { vi } from 'vitest'

export const mockMemoryService = {
  prepareAgent: vi.fn(async () => true),
  pause: vi.fn(() => ({ dispose: vi.fn() })),
  drainInFlight: vi.fn(async () => ({ settled: true })),
  invalidateAll: vi.fn()
}
