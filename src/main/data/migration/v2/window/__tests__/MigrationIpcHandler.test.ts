import { application } from '@application'
import { WindowType } from '@main/core/window/types'
import { MigrationIpcChannels, type MigrationProgress, type MigrationResult } from '@shared/data/migration/v2/types'
import { IpcChannel } from '@shared/IpcChannel'
import { createMockApplication } from '@test-mocks/main/application'
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
const windowMinimizeMock = vi.hoisted(() => vi.fn())
const windowRequestCloseMock = vi.hoisted(() => vi.fn())
const windowSetStageMock = vi.hoisted(() => vi.fn())
const windowConfirmQuitMock = vi.hoisted(() => vi.fn())

vi.mock('@main/services/LegacyBackupManager', () => ({
  default: class {
    backup = backupMock
  }
}))
vi.mock('../../core/MigrationEngine', () => ({ migrationEngine: engineMock }))
vi.mock('../MigrationWindowManager', () => ({
  migrationWindowManager: {
    send: windowSendMock,
    close: vi.fn(),
    restartApp: vi.fn(),
    minimize: windowMinimizeMock,
    requestClose: windowRequestCloseMock,
    setStage: windowSetStageMock,
    confirmQuit: windowConfirmQuitMock
  }
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
    // `vi.resetAllMocks()` clears the global @application mock's implementations.
    // The backup path now uses `application.getContainer()` (and `application.get`
    // delegates to `container.get`), so re-establish them from the unified factory.
    const mockApp = createMockApplication()
    vi.mocked(application.getContainer).mockImplementation(mockApp.getContainer as never)
    vi.mocked(application.get).mockImplementation(mockApp.get as never)
    resetMigrationData()
    registerMigrationIpcHandlers('/mock/userData')
    handlers = new Map(vi.mocked(ipcMain.handle).mock.calls.map(([channel, fn]) => [channel, fn as Handler]))
  })

  it('proceeds to backup_required and broadcasts the authoritative progress', async () => {
    const result = await invoke(MigrationIpcChannels.ProceedToBackup)

    expect(result).toBe(true)
    expect(lastProgress()).toMatchObject({
      stage: 'backup_required',
      overallProgress: 0,
      currentMessage: 'Data backup is required before migration can proceed',
      migrators: []
    })
    expect(windowSetStageMock).toHaveBeenCalledWith('backup_required')
  })

  it('returns from backup_required to introduction through IPC', async () => {
    await invoke(MigrationIpcChannels.ProceedToBackup)

    const result = await invoke(MigrationIpcChannels.ReturnToIntroduction)

    expect(result).toBe(true)
    expect(lastProgress()).toMatchObject({
      stage: 'introduction',
      overallProgress: 0,
      currentMessage: 'Ready to start data migration',
      migrators: []
    })
    expect(windowSetStageMock).toHaveBeenCalledWith('introduction')
  })

  it('returns an existing-backup acknowledgement to backup_required through IPC', async () => {
    await invoke(MigrationIpcChannels.BackupCompleted)

    const result = await invoke(MigrationIpcChannels.ReturnToBackupChoice)

    expect(result).toBe(true)
    const progress = lastProgress()
    expect(progress).toMatchObject({
      stage: 'backup_required',
      overallProgress: 0,
      currentMessage: 'Data backup is required before migration can proceed',
      migrators: []
    })
    expect(progress.backupInfo).toBeUndefined()
    expect(windowSetStageMock).toHaveBeenCalledWith('backup_required')
  })

  it('rebroadcasts backup_confirmed with backupInfo when returning from an app-created backup checkpoint', async () => {
    await createBackup('/real/backups/v1.zip')

    const result = await invoke(MigrationIpcChannels.ReturnToBackupChoice)

    expect(result).toBe(true)
    expect(lastProgress()).toMatchObject({
      stage: 'backup_confirmed',
      backupInfo: { createdBackupPath: '/real/backups/v1.zip' }
    })
  })

  it('attaches the created backup path to backupInfo on backup_confirmed', async () => {
    await createBackup('/real/backups/v1.zip')

    const progress = lastProgress()
    expect(progress.stage).toBe('backup_confirmed')
    expect(progress.backupInfo).toEqual({ createdBackupPath: '/real/backups/v1.zip' })
  })

  it('stays on backup_required while the save dialog is open', async () => {
    await invoke(MigrationIpcChannels.ProceedToBackup)
    expect(lastProgress().stage).toBe('backup_required')

    let resolveDialog!: (value: { canceled: true }) => void
    vi.mocked(dialog.showSaveDialog).mockReturnValue(
      new Promise((resolve) => {
        resolveDialog = resolve
      }) as never
    )

    const backupPromise = invoke(MigrationIpcChannels.ShowBackupDialog)
    await Promise.resolve()

    expect(lastProgress().stage).toBe('backup_required')

    resolveDialog({ canceled: true })
    await backupPromise
  })

  it('marks backup path selection cancellation without reporting a backup failure', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true } as never)

    const result = await invoke(MigrationIpcChannels.ShowBackupDialog)

    expect(result).toEqual({ success: false, canceled: true })
    expect(lastProgress().stage).toBe('backup_required')
    expect(lastProgress().currentMessage).not.toContain('failed')
  })

  it('returns to backup_required with the backup error when backup creation fails', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: '/tmp/b.zip' } as never)
    backupMock.mockRejectedValue(new Error('Disk full'))

    const result = await invoke(MigrationIpcChannels.ShowBackupDialog)

    expect(result).toEqual({ success: false, error: 'Disk full' })
    const progress = lastProgress()
    expect(progress.stage).toBe('backup_required')
    expect(progress.currentMessage).toBe('Backup failed: Disk full')
    expect(progress.error).toBeUndefined()
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
    expect(progress.stage).toBe('completed')
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

  it('preserves backupInfo when retrying migration after a created backup', async () => {
    await createBackup('/real/backups/v1.zip')

    await invoke(MigrationIpcChannels.Retry)

    const progress = lastProgress()
    expect(progress.stage).toBe('backup_confirmed')
    expect(progress.backupInfo).toEqual({ createdBackupPath: '/real/backups/v1.zip' })
  })

  it('forwards real backup progress to the migration window as backup_progress', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: '/tmp/b.zip' } as never)
    // Emit a tick through the exact seam LegacyBackupManager uses, while the
    // scoped container.get override is active inside performBackupToFile.
    backupMock.mockImplementation(async () => {
      application.get('WindowManager').broadcastToType(WindowType.Main, IpcChannel.BackupProgress, {
        stage: 'copying_files',
        progress: 42,
        total: 100
      })
      return '/real/backups/v1.zip'
    })

    await invoke(MigrationIpcChannels.ShowBackupDialog)

    // The handler continues to backup_confirmed after the tick, so the forwarded
    // tick lives inside the broadcast history, not at the tail.
    expect(progressBroadcasts()).toContainEqual(
      expect.objectContaining({ stage: 'backup_progress', overallProgress: 42 })
    )
    // Seed precedes any tick.
    expect(progressBroadcasts()).toContainEqual(
      expect.objectContaining({ stage: 'backup_progress', overallProgress: 0 })
    )
    expect(lastProgress().stage).toBe('backup_confirmed')
    // No residue: the scoped override was deleted, restoring the prototype get.
    expect(Object.prototype.hasOwnProperty.call(application.getContainer(), 'get')).toBe(false)
  })

  it('labels the compressing stage distinctly from other backup stages', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: '/tmp/b.zip' } as never)
    backupMock.mockImplementation(async () => {
      const wm = application.get('WindowManager')
      wm.broadcastToType(WindowType.Main, IpcChannel.BackupProgress, {
        stage: 'copying_files',
        progress: 60,
        total: 100
      })
      wm.broadcastToType(WindowType.Main, IpcChannel.BackupProgress, { stage: 'compressing', progress: 80, total: 100 })
      return '/real/backups/v1.zip'
    })

    await invoke(MigrationIpcChannels.ShowBackupDialog)

    const ticks = progressBroadcasts().filter((p) => p.stage === 'backup_progress')
    expect(ticks).toContainEqual(
      expect.objectContaining({
        overallProgress: 60,
        i18nMessage: { key: 'migration.backup_progress.description' },
        isCompressing: false
      })
    )
    expect(ticks).toContainEqual(
      expect.objectContaining({
        overallProgress: 80,
        i18nMessage: { key: 'migration.backup_progress.compressing' },
        isCompressing: true
      })
    )
  })

  it('normalizes and clamps backup progress into 0-100', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: '/tmp/b.zip' } as never)
    backupMock.mockImplementation(async () => {
      const wm = application.get('WindowManager')
      // total: 0 must not divide-by-zero; out-of-range progress clamps.
      wm.broadcastToType(WindowType.Main, IpcChannel.BackupProgress, { stage: 'preparing', progress: 250, total: 0 })
      return '/real/backups/v1.zip'
    })

    await invoke(MigrationIpcChannels.ShowBackupDialog)

    const backupTicks = progressBroadcasts().filter((p) => p.stage === 'backup_progress')
    for (const tick of backupTicks) {
      expect(tick.overallProgress).toBeGreaterThanOrEqual(0)
      expect(tick.overallProgress).toBeLessThanOrEqual(100)
    }
    expect(backupTicks).toContainEqual(expect.objectContaining({ overallProgress: 100 }))
  })

  it('ignores non-backup-progress channels (e.g. restore progress)', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: '/tmp/b.zip' } as never)
    backupMock.mockImplementation(async () => {
      application
        .get('WindowManager')
        .broadcastToType(WindowType.Main, IpcChannel.RestoreProgress, { stage: 'restoring', progress: 70, total: 100 })
      return '/real/backups/v1.zip'
    })

    await invoke(MigrationIpcChannels.ShowBackupDialog)

    // Only the seed (0) is present; the restore tick produced no backup_progress.
    const backupTicks = progressBroadcasts().filter((p) => p.stage === 'backup_progress')
    expect(backupTicks).toEqual([expect.objectContaining({ overallProgress: 0 })])
  })

  it('rejects a concurrent backup dialog request while one is in flight', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: '/tmp/b.zip' } as never)
    let resolveBackup!: (path: string) => void
    backupMock.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveBackup = resolve
        })
    )

    const first = invoke(MigrationIpcChannels.ShowBackupDialog)
    // backupInFlight is set synchronously at handler entry, so the second call is
    // rejected without opening another save dialog.
    const second = await invoke(MigrationIpcChannels.ShowBackupDialog)
    expect(second).toEqual({ success: false, error: 'Backup already in progress' })

    // Let the first call advance through the dialog into the (pending) backup.
    await Promise.resolve()
    expect(vi.mocked(dialog.showSaveDialog)).toHaveBeenCalledTimes(1)

    resolveBackup('/real/backups/v1.zip')
    await first
    expect(backupMock).toHaveBeenCalledTimes(1)
  })

  describe('window controls', () => {
    it('forwards a minimize request to the window manager', async () => {
      await invoke(MigrationIpcChannels.Minimize)
      expect(windowMinimizeMock).toHaveBeenCalledTimes(1)
    })

    it('routes a close-window request through the window manager', async () => {
      await invoke(MigrationIpcChannels.CloseWindow)
      expect(windowRequestCloseMock).toHaveBeenCalledTimes(1)
    })

    it('forwards a confirmed quit to the window manager', async () => {
      await invoke(MigrationIpcChannels.ConfirmQuit)
      expect(windowConfirmQuitMock).toHaveBeenCalledTimes(1)
    })

    it('pushes the live stage to the window manager on progress updates', async () => {
      await invoke(MigrationIpcChannels.ProceedToBackup)
      expect(windowSetStageMock).toHaveBeenCalledWith('backup_required')
    })
  })

  describe('quit guard', () => {
    // Let queued microtasks + the trailing setTimeout(0) drain so the deferred
    // Promise.allSettled(...).then(confirmQuit) has a chance to run.
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

    it('quits immediately when no backup or migration write is in flight', async () => {
      const quitting = await invoke(MigrationIpcChannels.ConfirmQuit)

      expect(quitting).toBe(true)
      expect(windowConfirmQuitMock).toHaveBeenCalledTimes(1)
    })

    it('defers quit while a backup write is in flight, then quits once it settles', async () => {
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: '/tmp/b.zip' } as never)
      let resolveBackup!: (path: string) => void
      backupMock.mockImplementation(() => new Promise<string>((resolve) => (resolveBackup = resolve)))

      const backupFlow = invoke(MigrationIpcChannels.ShowBackupDialog)
      // Advance past the save dialog so the handler reaches the (pending) backup write.
      await Promise.resolve()
      await Promise.resolve()

      const quitting = await invoke(MigrationIpcChannels.ConfirmQuit)
      expect(quitting).toBe(false)
      expect(windowConfirmQuitMock).not.toHaveBeenCalled()

      resolveBackup('/real/backups/v1.zip')
      await backupFlow
      await tick()

      expect(windowConfirmQuitMock).toHaveBeenCalledTimes(1)
    })

    it('defers quit while a migration is in flight, then quits once it settles', async () => {
      let resolveRun!: (result: MigrationResult) => void
      engineMock.run.mockImplementation(() => new Promise<MigrationResult>((resolve) => (resolveRun = resolve)))

      const migrationFlow = invoke(MigrationIpcChannels.StartMigration, { reduxData: {}, dexieExportPath: '/dexie' })
      await Promise.resolve()

      const quitting = await invoke(MigrationIpcChannels.ConfirmQuit)
      expect(quitting).toBe(false)
      expect(windowConfirmQuitMock).not.toHaveBeenCalled()

      resolveRun({ success: true, totalDuration: 1, migratorResults: [] })
      await migrationFlow
      await tick()

      expect(windowConfirmQuitMock).toHaveBeenCalledTimes(1)
    })

    it('does not register a second deferred quit on repeated confirmation', async () => {
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: '/tmp/b.zip' } as never)
      let resolveBackup!: (path: string) => void
      backupMock.mockImplementation(() => new Promise<string>((resolve) => (resolveBackup = resolve)))

      const backupFlow = invoke(MigrationIpcChannels.ShowBackupDialog)
      await Promise.resolve()
      await Promise.resolve()

      expect(await invoke(MigrationIpcChannels.ConfirmQuit)).toBe(false)
      expect(await invoke(MigrationIpcChannels.ConfirmQuit)).toBe(false)

      resolveBackup('/real/backups/v1.zip')
      await backupFlow
      await tick()

      expect(windowConfirmQuitMock).toHaveBeenCalledTimes(1)
    })
  })
})
