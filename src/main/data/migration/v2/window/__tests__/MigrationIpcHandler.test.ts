import { MigrationIpcChannels, type MigrationProgress, type MigrationResult } from '@shared/data/migration/v2/types'
import { dialog, ipcMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Shared mock fns so each test can configure return values.
const backupMock = vi.hoisted(() => vi.fn())
const engineMock = vi.hoisted(() => ({
  onProgress: vi.fn(),
  run: vi.fn(),
  needsMigration: vi.fn(),
  getLastError: vi.fn()
}))
const windowSendMock = vi.hoisted(() => vi.fn())

vi.mock('@main/services/LegacyBackupManager', () => ({
  default: class {
    backup = backupMock
  }
}))
vi.mock('../../core/MigrationEngine', () => ({ migrationEngine: engineMock }))
vi.mock('../MigrationWindowManager', () => ({
  migrationWindowManager: { send: windowSendMock, close: vi.fn(), restartApp: vi.fn() }
}))

import { registerMigrationIpcHandlers, resetMigrationData } from '../MigrationIpcHandler'

type Handler = (...args: unknown[]) => unknown

describe('MigrationIpcHandler', () => {
  let handlers: Map<string, Handler>

  /** All `MigrationIpcChannels.Progress` payloads broadcast to the window, in order. */
  function progressBroadcasts(): MigrationProgress[] {
    return windowSendMock.mock.calls
      .filter(([channel]) => channel === MigrationIpcChannels.Progress)
      .map(([, payload]) => payload as MigrationProgress)
  }

  function lastProgress(): MigrationProgress {
    const all = progressBroadcasts()
    return all[all.length - 1]
  }

  function invoke(channel: string, ...args: unknown[]) {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`No handler registered for ${channel}`)
    return handler({}, ...args)
  }

  /** Create a real V1 backup so subsequent progress carries backupInfo. */
  async function createBackup(backupPath = '/real/backups/v1_2026.zip') {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: '/tmp/b.zip' } as never)
    backupMock.mockResolvedValue(backupPath)
    await invoke(MigrationIpcChannels.ShowBackupDialog)
  }

  beforeEach(() => {
    vi.resetAllMocks()
    resetMigrationData()
    registerMigrationIpcHandlers('/mock/userData')
    handlers = new Map(vi.mocked(ipcMain.handle).mock.calls.map(([channel, fn]) => [channel as string, fn as Handler]))
  })

  it('attaches the created backup path to backupInfo on backup_confirmed', async () => {
    await createBackup('/real/backups/v1.zip')

    const progress = lastProgress()
    expect(progress.stage).toBe('backup_confirmed')
    expect(progress.backupInfo).toEqual({ createdBackupPath: '/real/backups/v1.zip' })
  })

  it('does not set backupInfo for the existing-backup (BackupCompleted) path', async () => {
    await invoke(MigrationIpcChannels.BackupCompleted)

    const progress = lastProgress()
    expect(progress.stage).toBe('backup_confirmed')
    expect(progress.backupInfo).toBeUndefined()
  })

  it('derives summary and preserves backupInfo + warnings on successful completion', async () => {
    await createBackup('/real/backups/v1.zip')

    const result: MigrationResult = {
      success: true,
      totalDuration: 4200,
      migratorResults: [
        { migratorId: 'a', migratorName: 'A', success: true, recordsProcessed: 10, duration: 1000, warnings: ['w1'] },
        { migratorId: 'b', migratorName: 'B', success: true, recordsProcessed: 5, duration: 3200 }
      ]
    }
    engineMock.run.mockResolvedValue(result)

    await invoke(MigrationIpcChannels.StartMigration, { reduxData: {}, dexieExportPath: '/dexie' })

    const progress = lastProgress()
    expect(progress.stage).toBe('migration_completed')
    expect(progress.summary).toEqual({
      completedMigrators: 2,
      totalMigrators: 2,
      itemsProcessed: 15,
      durationMs: 4200
    })
    expect(progress.backupInfo).toEqual({ createdBackupPath: '/real/backups/v1.zip' })
    expect(progress.warnings).toEqual(['w1'])
  })

  it('preserves backupInfo across engine progress ticks', async () => {
    await createBackup('/real/backups/v1.zip')

    let engineTick: ((progress: MigrationProgress) => void) | undefined
    engineMock.onProgress.mockImplementation((cb: (progress: MigrationProgress) => void) => {
      engineTick = cb
    })
    engineMock.run.mockImplementation(async () => {
      engineTick?.({
        stage: 'migration',
        overallProgress: 50,
        currentMessage: 'Migrating…',
        migrators: [{ id: 'a', name: 'A', status: 'running' }]
      })
      return {
        success: true,
        totalDuration: 100,
        migratorResults: [{ migratorId: 'a', migratorName: 'A', success: true, recordsProcessed: 1, duration: 100 }]
      } satisfies MigrationResult
    })

    await invoke(MigrationIpcChannels.StartMigration, { reduxData: {}, dexieExportPath: '/dexie' })

    const tick = progressBroadcasts().find((p) => p.stage === 'migration')
    expect(tick?.backupInfo).toEqual({ createdBackupPath: '/real/backups/v1.zip' })
  })
})
