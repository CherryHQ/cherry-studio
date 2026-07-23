import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  exportBackup,
  getRegistry,
  importBackup,
  readRestoreJournalMock,
  clearRestoreJournalMock,
  jobManagerPause,
  drainInFlight
} = vi.hoisted(() => ({
  exportBackup: vi.fn(),
  getRegistry: vi.fn(() => ({ domains: [] })),
  importBackup: vi.fn(),
  readRestoreJournalMock: vi.fn(() => ({ kind: 'none' as const })),
  clearRestoreJournalMock: vi.fn(),
  jobManagerPause: vi.fn(() => ({ dispose: vi.fn() })),
  drainInFlight: vi.fn(async () => ({ stragglerIds: [] as string[], startupRecoveryPending: false }))
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

vi.mock('../contributors/ContributorManager', () => ({
  contributorManager: {
    getRegistry
  }
}))

vi.mock('../SqliteBackupStripper', () => ({
  SqliteBackupStripper: vi.fn()
}))

vi.mock('@main/data/db/restore/restoreJournal', () => ({
  readRestoreJournal: readRestoreJournalMock,
  clearRestoreJournal: clearRestoreJournalMock
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const mocked = mockApplicationFactory()
  const innerGet = mocked.application.get as ReturnType<typeof vi.fn>
  mocked.application.get = vi.fn((name: string) => {
    if (name === 'JobManager') {
      return { pause: jobManagerPause, drainInFlight }
    }
    return innerGet(name)
  })
  return mocked
})

import { BaseService } from '@main/core/lifecycle'
import { isBackupInProgress } from '@main/data/db/backup/quiesceGate'
import { backupErrorCodes } from '@shared/ipc/errors/backup'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { app } from 'electron'

import { BackupService } from '../BackupService'
import { ExportOrchestrator } from '../ExportOrchestrator'
import { ImportOrchestrator } from '../ImportOrchestrator'

describe('BackupService packaged export path', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    exportBackup.mockResolvedValue({ archivePath: '/tmp/out.cherrybackup' })
    getRegistry.mockReturnValue({ domains: [] })
    readRestoreJournalMock.mockReturnValue({ kind: 'none' })
    clearRestoreJournalMock.mockImplementation(() => {})
    // Map import-side failures through toIpcError (quiesce is JobManager.pause, not a throw stub).
    importBackup.mockRejectedValue(new IpcError(backupErrorCodes.ARCHIVE_CORRUPT, 'test corrupt archive'))
    jobManagerPause.mockReturnValue({ dispose: vi.fn() })
    drainInFlight.mockResolvedValue({ stragglerIds: [], startupRecoveryPending: false })
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
    const result = await service.startBackup({ preset, outputPath: `/tmp/${preset}.cherrybackup` })
    expect(result.archivePath).toBe('/tmp/out.cherrybackup')
    expect(exportBackup).toHaveBeenCalledWith(
      expect.objectContaining({
        preset,
        outputPath: `/tmp/${preset}.cherrybackup`
      })
    )
  })

  it('startRestore wires ImportOrchestrator and maps import errors', async () => {
    const service = await initPackagedService()
    await expect(service.startRestore({ archivePath: '/tmp/in.cherrybackup' })).rejects.toSatisfy(
      (err: unknown) => err instanceof IpcError && err.code === 'BACKUP_ARCHIVE_CORRUPT'
    )
    expect(ImportOrchestrator).toHaveBeenCalled()
    expect(importBackup).toHaveBeenCalledWith(
      expect.objectContaining({
        archivePath: '/tmp/in.cherrybackup'
      })
    )
  })

  it('clears BACKUP_IN_PROGRESS and releases the JobManager hold when a restore fails', async () => {
    // The quiesce gate must never stick after a failed restore — a leaked flag would
    // reject every IPC mutation until app restart. The finally in startRestore releases
    // both the module flag and the refcounted JobManager pause hold.
    const holdDispose = vi.fn()
    jobManagerPause.mockReturnValue({ dispose: holdDispose })
    // Fail AFTER quiesce ran: importBackup invokes the injected quiesceWriters first, then throws.
    importBackup.mockImplementation(async () => {
      const deps = (ImportOrchestrator as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as {
        quiesceWriters: () => Promise<void>
      }
      await deps.quiesceWriters()
      expect(isBackupInProgress()).toBe(true) // quiesce actually engaged before the failure
      throw new IpcError(backupErrorCodes.ARCHIVE_CORRUPT, 'boom after quiesce')
    })

    const service = await initPackagedService()
    await expect(service.startRestore({ archivePath: '/tmp/in.cherrybackup' })).rejects.toSatisfy(
      (err: unknown) => err instanceof IpcError && err.code === 'BACKUP_ARCHIVE_CORRUPT'
    )

    expect(isBackupInProgress()).toBe(false) // flag cleared — writes resume
    expect(holdDispose).toHaveBeenCalledTimes(1) // JobManager pause hold released
    // And a subsequent restore attempt is not blocked by a stale activeOperation.
    importBackup.mockRejectedValue(new IpcError(backupErrorCodes.ARCHIVE_CORRUPT, 'second attempt'))
    await expect(service.startRestore({ archivePath: '/tmp/in.cherrybackup' })).rejects.toSatisfy(
      (err: unknown) => err instanceof IpcError && err.code === 'BACKUP_ARCHIVE_CORRUPT'
    )
  })

  it('startRestore throws BACKUP_RESTORE_PENDING when a prior restore journal is present', async () => {
    // A pending/terminal journal must be reported/cleared before another restore — this
    // guard is the backstop behind the preboot promotion gate (#16884, one fixed journal file).
    readRestoreJournalMock.mockReturnValue({ kind: 'ok', journal: { state: 'staged' } } as never)
    const service = await initPackagedService()
    await expect(service.startRestore({ archivePath: '/tmp/in.cherrybackup' })).rejects.toSatisfy(
      (err: unknown) => err instanceof IpcError && err.code === 'BACKUP_RESTORE_PENDING'
    )
  })

  it('startRestore clears a corrupt prior journal and proceeds (belt — gate already quarantined)', async () => {
    readRestoreJournalMock.mockReturnValue({ kind: 'corrupt', error: 'bad' } as never)
    const service = await initPackagedService()
    // A corrupt prior journal is cleared (belt — the preboot gate already quarantined it) so a
    // corrupt leftover never locks the user out; startRestore proceeds to ImportOrchestrator,
    // which rejects here via the importBackup mock.
    await expect(service.startRestore({ archivePath: '/tmp/in.cherrybackup' })).rejects.toThrow()
    // Cleared twice: once by performRestoreRecovery at onInit (boot belt), once by the startRestore
    // guard — both belt paths, since the preboot gate already quarantined the corrupt journal.
    expect(clearRestoreJournalMock).toHaveBeenCalledTimes(2)
  })
})
