import { vi } from 'vitest'

export const mockMemoryMigrationService = {
  isMigrated: vi.fn(() => true),
  withLegacyFactWrite: <T>(_agentId: string, write: () => Promise<T>) => write(),
  ensureAgent: vi.fn(async () => true),
  ensureSession: vi.fn(async () => true)
}
