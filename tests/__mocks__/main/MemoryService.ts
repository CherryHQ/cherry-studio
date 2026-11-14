import { vi } from 'vitest'

export const mockMemoryService = {
  pause: vi.fn(() => ({ dispose: vi.fn() })),
  drainInFlight: vi.fn(async () => ({ settled: true })),
  invalidateAll: vi.fn()
}
