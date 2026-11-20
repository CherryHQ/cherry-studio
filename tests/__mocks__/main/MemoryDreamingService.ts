import { vi } from 'vitest'

export const mockMemoryDreamingService = {
  status: vi.fn(() => ({ status: 'idle' as const, pending: false })),
  authorizeSubmission: vi.fn(),
  request: vi.fn(),
  cancel: vi.fn()
}
