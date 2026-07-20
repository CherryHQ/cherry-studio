import { beforeEach, describe, expect, it, vi } from 'vitest'

const { exportBackup, getRegistry, importBackup, readRestoreJournalMock, jobManagerPause } = vi.hoisted(() => ({
  exportBackup: vi.fn(),
  getRegistry: vi.fn(() => ({ domains: [] })),
  importBackup: vi.fn(),
  readRestoreJournalMock: vi.fn(() => ({ kind: 'none' as const })),
  jobManagerPause: vi.fn(() => ({ dispose: vi.fn() }))
}))

vi.mock('../ExportOrchestrator', () => ({
  ExportOrchestrator: vi.fn().mockImplementation(() => ({
    exportBackup
  }))
}))

vi.mock('../ImportOrchestrator', () => ({
  ImportOrchestrator: vi.fn().mockImplementation(() => ({
    importBackup
  }))
}))

vi.mock('../contributors', () => ({
  contributorManager: {
    getRegistry
  }
}))

vi.mock('../ExcludedDomainStripper', () => ({
  SqliteBackupStripper: vi.fn()
}))

vi.mock('@main/data/db/restore/restoreJournal', () => ({
  readRestoreJournal: readRestoreJournalMock
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const mocked = mockApplicationFactory()
  const innerGet = mocked.application.get as ReturnType<typeof vi.fn>
  mocked.application.get = vi.fn((name: string) => {
    if (name === 'JobManager') {
      return { pause: jobManagerPause }
    }
    return innerGet(name)
  })
  return mocked
})

import { BaseService } from '@main/core/lifecycle'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { app } from 'electron'

import { BackupService } from '../BackupService'
import { ExportOrchestrator } from '../ExportOrchestrator'
import { ImportOrchestrator } from '../ImportOrchestrator'

describe('BackupService packaged export path', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    exportBackup.mockResolvedValue({ archivePath: '/tmp/out.cbu' })
    getRegistry.mockReturnValue({ domains: [] })
    readRestoreJournalMock.mockReturnValue({ kind: 'none' })
    // Map import-side failures through toIpcError (quiesce is JobManager.pause, not a throw stub).
    importBackup.mockRejectedValue(new IpcError('BACKUP_ARCHIVE_CORRUPT', 'test corrupt archive'))
    jobManagerPause.mockReturnValue({ dispose: vi.fn() })
    Object.defineProperty(app, 'isPackaged', { configurable: true, value: true })
  })

  async function initPackagedService(): Promise<BackupService> {
    const service = new BackupService()
    vi.spyOn(service as never, 'readSchemaMigrationId' as never).mockReturnValue('migration-1')
    vi.spyOn(service as never, 'validateOutputPath' as never).mockImplementation(() => undefined)
    vi.spyOn(service as never, 'preflightDisk' as never).mockResolvedValue(undefined)
    vi.spyOn(service as never, 'resolveNotesRoot' as never).mockReturnValue(undefined)
    await service._doInit()
    return service
  }

  it('finalizes registry + ExportOrchestrator when app.isPackaged=true', async () => {
    await initPackagedService()
    expect(getRegistry).toHaveBeenCalledTimes(1)
    expect(ExportOrchestrator).toHaveBeenCalledTimes(1)
  })

  it.each(['lite', 'full'] as const)('startBackup(%s) works when packaged', async (preset) => {
    const service = await initPackagedService()
    const result = await service.startBackup({ preset, outputPath: `/tmp/${preset}.cbu` })
    expect(result.archivePath).toBe('/tmp/out.cbu')
    expect(exportBackup).toHaveBeenCalledWith(
      expect.objectContaining({
        preset,
        outputPath: `/tmp/${preset}.cbu`
      })
    )
  })

  it('startRestore wires ImportOrchestrator and maps import errors', async () => {
    const service = await initPackagedService()
    await expect(service.startRestore({ archivePath: '/tmp/in.cbu' })).rejects.toSatisfy(
      (err: unknown) => err instanceof IpcError && err.code === 'BACKUP_ARCHIVE_CORRUPT'
    )
    expect(ImportOrchestrator).toHaveBeenCalled()
    expect(importBackup).toHaveBeenCalledWith(
      expect.objectContaining({
        archivePath: '/tmp/in.cbu'
      })
    )
  })
})
