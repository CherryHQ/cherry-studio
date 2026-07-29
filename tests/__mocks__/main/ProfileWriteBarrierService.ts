import { vi } from 'vitest'

async function runWriteDirectly<T>(_label: string, operation: () => T | Promise<T>): Promise<T> {
  return operation()
}

const mockRunWrite = vi.fn(runWriteDirectly)

const mockInstance = {
  runWrite: mockRunWrite,
  acquireWriteLease: vi.fn(async (label: string) => ({
    id: 'mock-profile-write',
    label,
    dispose: vi.fn()
  })),
  pause: vi.fn(() => ({ dispose: vi.fn() })),
  drainInFlight: vi.fn(async () => ({ stragglerIds: [] as string[] })),
  listActiveWork: vi.fn(() => [] as Array<{ id: string; summary: string }>),
  shutdown: vi.fn(),
  isWriteQuiesced: false
}

export const MockMainProfileWriteBarrierServiceExport = {
  profileWriteBarrierService: mockInstance
}

export const MockMainProfileWriteBarrierServiceUtils = {
  resetMocks: () => {
    for (const value of Object.values(mockInstance)) {
      if (vi.isMockFunction(value)) {
        value.mockClear()
      }
    }
    mockRunWrite.mockImplementation(runWriteDirectly)
    mockInstance.isWriteQuiesced = false
  }
}
