import { vi } from 'vitest'

export const mockMemoryService = {
  open: vi.fn(() => ({ assertRuntimeSafe: vi.fn(async () => {}), dispose: vi.fn() })),
  onChanged: vi.fn(() => ({ dispose: vi.fn() })),
  onInvalidated: vi.fn(() => ({ dispose: vi.fn() })),
  prepareAgent: vi.fn(async () => true),
  pause: vi.fn(() => ({ dispose: vi.fn() })),
  drainInFlight: vi.fn(async () => ({ settled: true })),
  invalidateAll: vi.fn()
}
