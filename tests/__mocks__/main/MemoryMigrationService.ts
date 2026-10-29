import { vi } from 'vitest'

export const mockMemoryMigrationService = {
  isMigrated: vi.fn(() => true),
  ensureAgent: vi.fn(async () => true),
  ensureSession: vi.fn(async () => true),
  retryFromEditor: vi.fn()
}
