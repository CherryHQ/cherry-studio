import { vi } from 'vitest'

export const mockMemoryDreamingService = {
  status: vi.fn(() => ({ status: 'idle' as const, pending: false })),
  request: vi.fn(),
  cancel: vi.fn()
}
