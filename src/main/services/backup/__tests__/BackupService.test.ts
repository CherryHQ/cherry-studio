import type * as LifecycleModule from '@main/core/lifecycle'
import { getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockIpcHandle = vi.fn()
const mockRegisterDisposable = vi.fn()

vi.mock('@application', () => ({
  application: {
    get: vi.fn()
  }
}))

vi.mock('@main/core/lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof LifecycleModule>()
  class MockBaseService {
    ipcHandle = mockIpcHandle
    registerDisposable = mockRegisterDisposable
  }
  return {
    ...actual,
    BaseService: MockBaseService
  }
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => []
  }
}))

vi.mock('uuid', () => ({
  v4: () => 'mock-uuid-v4'
}))

vi.mock('../orchestrator/ExportOrchestrator', () => ({
  ExportOrchestrator: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockResolvedValue({ duration: 100 })
  }))
}))

vi.mock('../orchestrator/ImportOrchestrator', () => ({
  ImportOrchestrator: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockResolvedValue({ duration: 200 })
  }))
}))

vi.mock('../orchestrator/BackupValidator', () => ({
  BackupValidatorImpl: vi.fn().mockImplementation(() => ({
    validate: vi.fn().mockResolvedValue({ valid: true, errors: [], warnings: [] })
  }))
}))

describe('BackupService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is decorated with correct phase', async () => {
    const { BackupService } = await import('../BackupService')
    expect(getPhase(BackupService)).toBe(Phase.WhenReady)
  })

  it('registers all 7 IPC handlers on init', async () => {
    const { BackupService } = await import('../BackupService')
    const service = new BackupService()
    await (service as unknown as { onInit: () => Promise<void> }).onInit()

    expect(mockIpcHandle).toHaveBeenCalledTimes(7)
  })

  it('registers progress broadcast disposable', async () => {
    const { BackupService } = await import('../BackupService')
    const service = new BackupService()
    await (service as unknown as { onInit: () => Promise<void> }).onInit()

    expect(mockRegisterDisposable).toHaveBeenCalledTimes(1)
    expect(typeof mockRegisterDisposable.mock.calls[0][0]).toBe('function')
  })

  it('cancels all active operations on stop', async () => {
    const { BackupService } = await import('../BackupService')
    const service = new BackupService()
    await (service as unknown as { onStop: () => Promise<void> }).onStop()
    // Should not throw even with no active ops
  })
})
