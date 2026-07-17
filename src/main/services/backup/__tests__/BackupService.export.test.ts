import { beforeEach, describe, expect, it, vi } from 'vitest'

const { exportBackup, getRegistry } = vi.hoisted(() => ({
  exportBackup: vi.fn(),
  getRegistry: vi.fn(() => ({ domains: [] }))
}))

vi.mock('../ExportOrchestrator', () => ({
  ExportOrchestrator: vi.fn().mockImplementation(() => ({
    exportBackup
  }))
}))

vi.mock('../contributors', () => ({
  contributorManager: {
    getRegistry
  }
}))

vi.mock('@main/data/db/restore/restoreJournal', () => ({
  readRestoreJournal: vi.fn(() => ({ kind: 'none' }))
}))

vi.mock('../ExcludedDomainStripper', () => ({
  SqliteBackupStripper: vi.fn()
}))

vi.mock('../ImportOrchestrator', () => ({
  ImportOrchestrator: vi
    .fn()
    .mockImplementation((deps: { quiesceWriters: (signal: AbortSignal) => Promise<void> }) => ({
      importBackup: async () => {
        await deps.quiesceWriters(new AbortController().signal)
      }
    }))
}))

vi.mock('../BackupRestoreJobQuiesce', () => ({
  BackupRestoreJobQuiesce: vi.fn()
}))

vi.mock('../admitArchive', () => ({
  admitArchive: vi.fn()
}))

vi.mock('../merge', () => ({
  MergeEngine: vi.fn()
}))

import { app } from 'electron'

import { BaseService } from '@main/core/lifecycle'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { BackupService } from '../BackupService'
import { ExportOrchestrator } from '../ExportOrchestrator'

describe('BackupService packaged export path', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    exportBackup.mockResolvedValue({ archivePath: '/tmp/out.cbu' })
    getRegistry.mockReturnValue({ domains: [] })
    Object.defineProperty(app, 'isPackaged', { configurable: true, value: true })
  })

  async function initPackagedService(): Promise<BackupService> {
    const service = new BackupService()
    vi.spyOn(service as never, 'performRestoreRecovery' as never).mockImplementation(() => undefined)
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

  it('startRestore still fail-closes in packaged while export path is live', async () => {
    const service = await initPackagedService()
    await expect(service.startRestore({ archivePath: '/tmp/in.cbu' })).rejects.toSatisfy((err: unknown) => {
      return err instanceof IpcError && err.code === 'BACKUP_RESTORE_QUIESCE_UNAVAILABLE'
    })
  })
})
