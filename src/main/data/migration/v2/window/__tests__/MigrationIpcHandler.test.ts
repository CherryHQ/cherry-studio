import { application } from '@application'
import { MigrationIpcChannels, type MigrationProgress, type MigrationResult } from '@shared/data/migration/v2/types'
import { dialog, ipcMain, type IpcMainInvokeEvent, shell } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Shared mock fns so each test can configure return values.
const diagnosticModuleState = vi.hoisted(() => ({ loadCount: 0 }))
const diagnosticMocks = vi.hoisted(() => ({
  saveBundle: vi.fn(),
  validateSender: vi.fn()
}))
const engineMock = vi.hoisted(() => ({
  onProgress: vi.fn(),
  run: vi.fn(),
  needsMigration: vi.fn(),
  getLastError: vi.fn()
}))
const fsMock = vi.hoisted(() => ({
  access: vi.fn(),
  appendFile: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn()
}))
const windowSendMock = vi.hoisted(() => vi.fn())
const windowMinimizeMock = vi.hoisted(() => vi.fn())
const windowRequestCloseMock = vi.hoisted(() => vi.fn())
const windowSetStageMock = vi.hoisted(() => vi.fn())
const windowConfirmQuitMock = vi.hoisted(() => vi.fn())
const windowSetQuitRequesterMock = vi.hoisted(() => vi.fn())
const windowClearCloseConfirmMock = vi.hoisted(() => vi.fn())

vi.mock('@main/core/security/validateSender', () => ({ validateSender: diagnosticMocks.validateSender }))
vi.mock('../../migrationDiagnosticBundle', () => {
  diagnosticModuleState.loadCount += 1
  return { saveMigrationDiagnosticBundle: diagnosticMocks.saveBundle }
})
vi.mock('../../core/MigrationEngine', () => ({ migrationEngine: engineMock }))
vi.mock('fs/promises', () => ({ default: fsMock }))
vi.mock('../MigrationWindowManager', () => ({
  migrationWindowManager: {
    send: windowSendMock,
    close: vi.fn(),
    restartApp: vi.fn(),
    minimize: windowMinimizeMock,
    requestClose: windowRequestCloseMock,
    setStage: windowSetStageMock,
    confirmQuit: windowConfirmQuitMock,
    setQuitRequester: windowSetQuitRequesterMock,
    clearCloseConfirm: windowClearCloseConfirmMock
  }
}))

import {
  registerMigrationIpcHandlers,
  resetMigrationData,
  setDataLocationNotice,
  setVersionIncompatible,
  unregisterMigrationIpcHandlers
} from '../MigrationIpcHandler'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
const event = {} as IpcMainInvokeEvent
const savePayload = { dialogTitle: 'Save diagnostics', logDate: '2026-07-23' }

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

  function invokeWithEvent(invokeEvent: IpcMainInvokeEvent, channel: string, ...args: unknown[]) {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`No handler registered for ${channel}`)
    return handler(invokeEvent, ...args)
  }

  const invoke = (channel: string, ...args: unknown[]) => invokeWithEvent(event, channel, ...args)
  const choosePath = (filePath: string) =>
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath } as never)

  beforeEach(() => {
    vi.resetAllMocks()
    diagnosticMocks.validateSender.mockReturnValue(true)
    diagnosticMocks.saveBundle.mockResolvedValue('included')
    vi.mocked(application.getPath).mockImplementation((key: string, fileName?: string) =>
      fileName ? `/mock/${key}/${fileName}` : `/mock/${key}`
    )
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: undefined } as never)
    resetMigrationData()
    registerMigrationIpcHandlers('/mock/userData')
    handlers = new Map(vi.mocked(ipcMain.handle).mock.calls.map(([channel, fn]) => [channel, fn as Handler]))
  })

  describe('diagnostic bundle actions', () => {
    beforeEach(() => {
      invoke(MigrationIpcChannels.ReportError, 'diagnostic test failure')
    })

    it('rejects save requests outside the error and version-incompatible stages', async () => {
      await invoke(MigrationIpcChannels.Retry)

      await expect(invoke(MigrationIpcChannels.SaveDiagnosticBundle, savePayload)).rejects.toThrow(
        'Invalid migration diagnostic stage.'
      )
      expect(dialog.showSaveDialog).not.toHaveBeenCalled()
      expect(diagnosticMocks.saveBundle).not.toHaveBeenCalled()
    })

    it('returns canceled without invoking the builder', async () => {
      await expect(invoke(MigrationIpcChannels.SaveDiagnosticBundle, savePayload)).resolves.toEqual({
        status: 'canceled'
      })
      expect(diagnosticMocks.saveBundle).not.toHaveBeenCalled()
      expect(diagnosticModuleState.loadCount).toBe(0)
    })

    it('rejects an untrusted sender before opening the save dialog', async () => {
      diagnosticMocks.validateSender.mockReturnValue(false)

      await expect(invoke(MigrationIpcChannels.SaveDiagnosticBundle, savePayload)).rejects.toThrow('Unauthorized')
      await expect(invoke(MigrationIpcChannels.ShowDiagnosticBundleInFolder)).rejects.toThrow('Unauthorized')
      expect(dialog.showSaveDialog).not.toHaveBeenCalled()
    })

    it('rejects malformed save payloads at the IPC boundary', async () => {
      for (const payload of [null, {}, { ...savePayload, dialogTitle: 1 }, { ...savePayload, logDate: 1 }]) {
        await expect(invoke(MigrationIpcChannels.SaveDiagnosticBundle, payload)).rejects.toThrow(
          'Invalid migration diagnostic save payload.'
        )
      }
      expect(dialog.showSaveDialog).not.toHaveBeenCalled()
      expect(diagnosticMocks.saveBundle).not.toHaveBeenCalled()
    })

    it('rejects blank or over-120-character dialog titles', async () => {
      for (const dialogTitle of ['  ', 'x'.repeat(121)]) {
        await expect(
          invoke(MigrationIpcChannels.SaveDiagnosticBundle, { ...savePayload, dialogTitle })
        ).rejects.toThrow()
      }
      expect(dialog.showSaveDialog).not.toHaveBeenCalled()
    })

    it('rejects an invalid local log date', async () => {
      for (const logDate of ['2026-02-31', '2026-2-03', ['2026-07-23']]) {
        await expect(invoke(MigrationIpcChannels.SaveDiagnosticBundle, { ...savePayload, logDate })).rejects.toThrow()
      }
      expect(dialog.showSaveDialog).not.toHaveBeenCalled()
      expect(diagnosticMocks.saveBundle).not.toHaveBeenCalled()
    })

    it('uses the validated renderer-localized save dialog title', async () => {
      await invoke(MigrationIpcChannels.SaveDiagnosticBundle, { ...savePayload, dialogTitle: '  保存诊断包  ' })

      expect(dialog.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ title: '保存诊断包' }))
    })

    it('uses a filename-only default path and zip filter', async () => {
      await invoke(MigrationIpcChannels.SaveDiagnosticBundle, savePayload)

      expect(application.getPath).not.toHaveBeenCalled()
      expect(dialog.showSaveDialog).toHaveBeenCalledWith({
        title: 'Save diagnostics',
        defaultPath: 'cherry-studio-migration-diagnostics.zip',
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation']
      })
    })

    it('does not load the bundle module before the user confirms a destination', async () => {
      await invoke(MigrationIpcChannels.SaveDiagnosticBundle, savePayload)

      expect(diagnosticModuleState.loadCount).toBe(0)
    })

    it('captures the failure stage before waiting for the save dialog', async () => {
      let resolveDialog: (value: { canceled: boolean; filePath: string }) => void = () => undefined
      vi.mocked(dialog.showSaveDialog).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveDialog = resolve
          }) as never
      )

      const savePromise = invoke(MigrationIpcChannels.SaveDiagnosticBundle, savePayload)
      await vi.waitFor(() => expect(dialog.showSaveDialog).toHaveBeenCalledOnce())
      await invoke(MigrationIpcChannels.Retry)
      resolveDialog({ canceled: false, filePath: '/chosen/diagnostics.zip' })
      await savePromise

      expect(diagnosticMocks.saveBundle).toHaveBeenCalledWith({
        destination: '/chosen/diagnostics.zip',
        stage: 'error',
        logDate: '2026-07-23'
      })
    })

    it('passes the dialog-selected path without adding a custom extension rule', async () => {
      choosePath('/chosen/diagnostics.data')

      await invoke(MigrationIpcChannels.SaveDiagnosticBundle, savePayload)

      expect(diagnosticMocks.saveBundle).toHaveBeenCalledWith({
        destination: '/chosen/diagnostics.data',
        stage: 'error',
        logDate: '2026-07-23'
      })
    })

    it('stores the latest path only after a successful save', async () => {
      choosePath('/chosen/saved.zip')
      await invoke(MigrationIpcChannels.SaveDiagnosticBundle, savePayload)
      choosePath('/chosen/failed.zip')
      diagnosticMocks.saveBundle.mockResolvedValueOnce(false)
      await invoke(MigrationIpcChannels.SaveDiagnosticBundle, savePayload)

      await invoke(MigrationIpcChannels.ShowDiagnosticBundleInFolder)
      expect(shell.showItemInFolder).toHaveBeenCalledWith('/chosen/saved.zip')
    })

    it('rejects a second save while the first save is still in flight', async () => {
      let resolveFirstSave: (result: 'included') => void = () => undefined
      vi.mocked(dialog.showSaveDialog)
        .mockResolvedValueOnce({ canceled: false, filePath: '/chosen/first.zip' } as never)
        .mockResolvedValueOnce({ canceled: false, filePath: '/chosen/second.zip' } as never)
      diagnosticMocks.saveBundle
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirstSave = resolve
            })
        )
        .mockResolvedValueOnce('included')

      const firstSave = invoke(MigrationIpcChannels.SaveDiagnosticBundle, savePayload)
      await vi.waitFor(() => expect(diagnosticMocks.saveBundle).toHaveBeenCalledOnce())
      await invoke(MigrationIpcChannels.Retry)
      invoke(MigrationIpcChannels.ReportError, 'second diagnostic test failure')

      await expect(invoke(MigrationIpcChannels.SaveDiagnosticBundle, savePayload)).resolves.toEqual({
        status: 'failed'
      })
      expect(dialog.showSaveDialog).toHaveBeenCalledOnce()
      expect(diagnosticMocks.saveBundle).toHaveBeenCalledOnce()

      resolveFirstSave('included')
      await expect(firstSave).resolves.toEqual({ status: 'saved', logs: 'included' })
      await invoke(MigrationIpcChannels.ShowDiagnosticBundleInFolder)
      expect(shell.showItemInFolder).toHaveBeenCalledWith('/chosen/first.zip')
    })

    it('returns the included or not_included result from the builder', async () => {
      choosePath('/chosen/diagnostics.zip')
      diagnosticMocks.saveBundle.mockResolvedValueOnce('included').mockResolvedValueOnce('not_included')

      await expect(invoke(MigrationIpcChannels.SaveDiagnosticBundle, savePayload)).resolves.toEqual({
        status: 'saved',
        logs: 'included'
      })
      await expect(invoke(MigrationIpcChannels.SaveDiagnosticBundle, savePayload)).resolves.toEqual({
        status: 'saved',
        logs: 'not_included'
      })
    })

    it('returns failed when the builder fails', async () => {
      choosePath('/chosen/diagnostics.zip')
      const progress = await invoke(MigrationIpcChannels.GetProgress)
      diagnosticMocks.saveBundle.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('write failed'))

      await expect(invoke(MigrationIpcChannels.SaveDiagnosticBundle, savePayload)).resolves.toEqual({
        status: 'failed'
      })
      await expect(invoke(MigrationIpcChannels.SaveDiagnosticBundle, savePayload)).resolves.toEqual({
        status: 'failed'
      })
      expect(invoke(MigrationIpcChannels.GetProgress)).toEqual(progress)
    })

    it('reveals the latest successfully saved bundle', async () => {
      choosePath('/chosen/diagnostics.zip')
      await invoke(MigrationIpcChannels.SaveDiagnosticBundle, savePayload)

      await expect(invoke(MigrationIpcChannels.ShowDiagnosticBundleInFolder)).resolves.toBe(true)
      expect(shell.showItemInFolder).toHaveBeenCalledWith('/chosen/diagnostics.zip')
    })

    it('returns false when the saved bundle no longer exists', async () => {
      choosePath('/chosen/diagnostics.zip')
      await invoke(MigrationIpcChannels.SaveDiagnosticBundle, savePayload)
      fsMock.access.mockRejectedValueOnce(new Error('ENOENT'))

      await expect(invoke(MigrationIpcChannels.ShowDiagnosticBundleInFolder)).resolves.toBe(false)
      expect(fsMock.access).toHaveBeenCalledWith('/chosen/diagnostics.zip')
      expect(shell.showItemInFolder).not.toHaveBeenCalled()
    })

    it('returns false when no successful bundle has been saved', async () => {
      await expect(invoke(MigrationIpcChannels.ShowDiagnosticBundleInFolder)).resolves.toBe(false)
      expect(shell.showItemInFolder).not.toHaveBeenCalled()
    })

    it('forgets the latest saved path when migration data is reset', async () => {
      choosePath('/chosen/diagnostics.zip')
      await invoke(MigrationIpcChannels.SaveDiagnosticBundle, savePayload)

      resetMigrationData()
      await expect(invoke(MigrationIpcChannels.ShowDiagnosticBundleInFolder)).resolves.toBe(false)
      expect(shell.showItemInFolder).not.toHaveBeenCalled()
    })
  })

  it('saves diagnostics from the version-incompatible stage', async () => {
    unregisterMigrationIpcHandlers()
    resetMigrationData()
    vi.mocked(ipcMain.handle).mockClear()
    setVersionIncompatible('v1_too_old', { currentVersion: '1.9.0', minimumVersion: '1.9.12' })
    registerMigrationIpcHandlers('/mock/userData')
    handlers = new Map(vi.mocked(ipcMain.handle).mock.calls.map(([channel, fn]) => [channel, fn as Handler]))
    choosePath('/chosen/diagnostics.zip')

    await expect(invoke(MigrationIpcChannels.SaveDiagnosticBundle, savePayload)).resolves.toEqual({
      status: 'saved',
      logs: 'included'
    })
    expect(diagnosticMocks.saveBundle).toHaveBeenCalledWith({
      destination: '/chosen/diagnostics.zip',
      stage: 'version_incompatible',
      logDate: '2026-07-23'
    })
  })

  describe('export file writes', () => {
    it('overwrites export files by default for existing callers', async () => {
      await invoke(MigrationIpcChannels.WriteExportFile, '/export', 'localStorage', '[]')

      expect(fsMock.mkdir).toHaveBeenCalledWith('/export', { recursive: true })
      expect(fsMock.writeFile).toHaveBeenCalledWith('/export/localStorage.json', '[]', 'utf-8')
      expect(fsMock.appendFile).not.toHaveBeenCalled()
    })

    it('appends an export chunk when requested', async () => {
      await invoke(MigrationIpcChannels.WriteExportFile, '/export', 'message_blocks', '{"id":"b1"}', 'append')

      expect(fsMock.appendFile).toHaveBeenCalledWith('/export/message_blocks.json', '{"id":"b1"}', 'utf-8')
      expect(fsMock.writeFile).not.toHaveBeenCalled()
    })

    it('propagates append failures to the renderer', async () => {
      fsMock.appendFile.mockRejectedValueOnce(new Error('disk full'))

      await expect(
        invoke(MigrationIpcChannels.WriteExportFile, '/export', 'message_blocks', 'chunk', 'append')
      ).rejects.toThrow('disk full')
    })
  })

  it('flips to the protected migration stage before running the engine', async () => {
    // Regression: the engine's run() synchronously clears all v2 tables before emitting its first
    // progress tick. The handler must move the stage to `migration` BEFORE calling run(), so that
    // destructive clear happens under the close-confirm/write-deferral guard rather than on the
    // unprotected `introduction` stage.
    let stageAtRunStart: string | undefined
    engineMock.run.mockImplementation(async () => {
      stageAtRunStart = lastProgress().stage
      return { success: true, totalDuration: 1, migratorResults: [] }
    })

    await invoke(MigrationIpcChannels.StartMigration, { reduxData: {}, dexieExportPath: '/dexie' })

    expect(stageAtRunStart).toBe('migration')
    expect(windowSetStageMock).toHaveBeenCalledWith('migration')
  })

  it('resets to the introduction stage on retry so the user can re-trigger migration', async () => {
    const result = await invoke(MigrationIpcChannels.Retry)

    expect(result).toBe(true)
    expect(lastProgress()).toMatchObject({
      stage: 'introduction',
      overallProgress: 0,
      currentMessage: 'Ready to retry migration',
      migrators: []
    })
    expect(windowSetStageMock).toHaveBeenCalledWith('introduction')
  })

  it('derives summary and warnings on successful completion', async () => {
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
    expect(progress.warnings).toEqual(['w1'])
  })

  it('uses the live migrator count for totalMigrators, distinct from completedMigrators', async () => {
    // A progress tick exposes three migrators; the result only carries two. totalMigrators
    // must come from the live progress (3) and completedMigrators from the result (2), so
    // the `|| result.migratorResults.length` fallback is NOT exercised here — a field swap
    // or a dropped fallback would now fail instead of coincidentally passing at 2/2.
    let engineTick: ((progress: MigrationProgress) => void) | undefined
    engineMock.onProgress.mockImplementation((cb: (progress: MigrationProgress) => void) => {
      engineTick = cb
    })
    engineMock.run.mockImplementation(async () => {
      engineTick?.({
        stage: 'migration',
        overallProgress: 66,
        currentMessage: 'Migrating…',
        migrators: [
          { id: 'a', name: 'A', status: 'completed' },
          { id: 'b', name: 'B', status: 'completed' },
          { id: 'c', name: 'C', status: 'failed', error: 'boom' }
        ]
      })
      return {
        success: true,
        totalDuration: 1234,
        migratorResults: [
          { migratorId: 'a', migratorName: 'A', success: true, recordsProcessed: 4, duration: 100 },
          { migratorId: 'b', migratorName: 'B', success: true, recordsProcessed: 6, duration: 200 }
        ]
      } satisfies MigrationResult
    })

    await invoke(MigrationIpcChannels.StartMigration, { reduxData: {}, dexieExportPath: '/dexie' })

    const progress = lastProgress()
    expect(progress.stage).toBe('completed')
    expect(progress.summary).toMatchObject({
      completedMigrators: 2,
      totalMigrators: 3,
      itemsProcessed: 10,
      durationMs: 1234
    })
  })

  it('falls back to the result migrator count for totalMigrators when no progress ticked', async () => {
    engineMock.run.mockResolvedValue({
      success: true,
      totalDuration: 500,
      migratorResults: [
        { migratorId: 'a', migratorName: 'A', success: true, recordsProcessed: 1, duration: 100 },
        { migratorId: 'b', migratorName: 'B', success: true, recordsProcessed: 2, duration: 200 }
      ]
    } satisfies MigrationResult)

    await invoke(MigrationIpcChannels.StartMigration, { reduxData: {}, dexieExportPath: '/dexie' })

    // No tick → currentProgress.migrators is [], so totalMigrators uses the result-length
    // fallback and matches completedMigrators.
    expect(lastProgress().summary).toMatchObject({ completedMigrators: 2, totalMigrators: 2 })
  })

  describe('migration failure', () => {
    it('broadcasts the error stage with carried migrators/progress when the run reports failure', async () => {
      let engineTick: ((progress: MigrationProgress) => void) | undefined
      engineMock.onProgress.mockImplementation((cb: (progress: MigrationProgress) => void) => {
        engineTick = cb
      })
      engineMock.run.mockImplementation(async () => {
        // Error broadcast must preserve the last live progress tick.
        engineTick?.({
          stage: 'migration',
          overallProgress: 65,
          currentMessage: 'Migrating…',
          migrators: [{ id: 'a', name: 'A', status: 'failed', error: 'boom' }]
        })
        return { success: false, error: 'Validation failed', totalDuration: 1200, migratorResults: [] }
      })

      const result = await invoke(MigrationIpcChannels.StartMigration, { reduxData: {}, dexieExportPath: '/dexie' })

      expect(result).toMatchObject({ success: false, error: 'Validation failed' })
      const progress = lastProgress()
      expect(progress.stage).toBe('error')
      expect(progress.error).toBe('Validation failed')
      expect(progress.currentMessage).toBe('Validation failed')
      expect(progress.overallProgress).toBe(65)
      expect(progress.migrators).toEqual([{ id: 'a', name: 'A', status: 'failed', error: 'boom' }])
      expect(windowSetStageMock).toHaveBeenCalledWith('error')
    })

    it('broadcasts the error stage when the run rejects, then frees the in-flight guard so a retry is not blocked', async () => {
      engineMock.run.mockRejectedValueOnce(new Error('Engine exploded'))

      await expect(
        invoke(MigrationIpcChannels.StartMigration, { reduxData: {}, dexieExportPath: '/dexie' })
      ).rejects.toThrow('Engine exploded')

      const failure = lastProgress()
      expect(failure.stage).toBe('error')
      expect(failure.error).toBe('Engine exploded')
      expect(windowSetStageMock).toHaveBeenCalledWith('error')

      engineMock.run.mockResolvedValueOnce({ success: true, totalDuration: 1, migratorResults: [] })
      const retry = await invoke(MigrationIpcChannels.StartMigration, { reduxData: {}, dexieExportPath: '/dexie' })

      expect(retry).toMatchObject({ success: true })
      expect(lastProgress().stage).toBe('completed')
    })

    it('transitions main to the terminal error stage when the renderer reports a pre-handoff failure', async () => {
      const result = await invoke(MigrationIpcChannels.ReportError, 'Dexie export failed')

      expect(result).toBe(true)
      const progress = lastProgress()
      expect(progress.stage).toBe('error')
      expect(progress.error).toBe('Dexie export failed')
      expect(progress.currentMessage).toBe('Dexie export failed')
      expect(windowSetStageMock).toHaveBeenCalledWith('error')
    })
  })

  describe('data-location notice', () => {
    it('retains the recovered data location across Retry so it does not vanish after a failed run', async () => {
      setDataLocationNotice('/Volumes/Data/CherryStudio')

      await invoke(MigrationIpcChannels.Retry)

      expect(lastProgress()).toMatchObject({
        stage: 'introduction',
        dataLocation: '/Volumes/Data/CherryStudio'
      })
    })

    it('drops the notice after resetMigrationData so a later Retry carries no stale location', async () => {
      setDataLocationNotice('/Volumes/Data/CherryStudio')
      resetMigrationData()

      await invoke(MigrationIpcChannels.Retry)

      expect(lastProgress().dataLocation).toBeUndefined()
    })
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

    it('wires the force-quit requester on registration', () => {
      expect(windowSetQuitRequesterMock).toHaveBeenCalledWith(expect.any(Function))
    })

    it('clears the force-quit requester on unregister', () => {
      windowSetQuitRequesterMock.mockClear()
      unregisterMigrationIpcHandlers()
      expect(windowSetQuitRequesterMock).toHaveBeenCalledWith(null)
    })

    it('clears the pending close when the renderer cancels the close dialog', async () => {
      const result = await invoke(MigrationIpcChannels.CancelClose)
      expect(result).toBe(true)
      expect(windowClearCloseConfirmMock).toHaveBeenCalledTimes(1)
    })

    it('forwards a confirmed quit to the window manager', async () => {
      await invoke(MigrationIpcChannels.ConfirmQuit)
      expect(windowConfirmQuitMock).toHaveBeenCalledTimes(1)
    })

    it('pushes the live stage to the window manager on progress updates', async () => {
      await invoke(MigrationIpcChannels.ReportError, 'boom')
      expect(windowSetStageMock).toHaveBeenCalledWith('error')
    })
  })

  describe('quit guard', () => {
    // Let queued microtasks + the trailing setTimeout(0) drain so the deferred
    // Promise.allSettled(...).then(confirmQuit) has a chance to run.
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

    it('quits immediately when no migration write is in flight', async () => {
      const quitting = await invoke(MigrationIpcChannels.ConfirmQuit)

      expect(quitting).toBe(true)
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
      let resolveRun!: (result: MigrationResult) => void
      engineMock.run.mockImplementation(() => new Promise<MigrationResult>((resolve) => (resolveRun = resolve)))

      const migrationFlow = invoke(MigrationIpcChannels.StartMigration, { reduxData: {}, dexieExportPath: '/dexie' })
      await Promise.resolve()

      expect(await invoke(MigrationIpcChannels.ConfirmQuit)).toBe(false)
      expect(await invoke(MigrationIpcChannels.ConfirmQuit)).toBe(false)

      resolveRun({ success: true, totalDuration: 1, migratorResults: [] })
      await migrationFlow
      await tick()

      expect(windowConfirmQuitMock).toHaveBeenCalledTimes(1)
    })

    it('defers a force-quit requested via the escape hatch while a migration is in flight', async () => {
      // The window manager's crash/hang/repeat-close paths call the wired requester, which must
      // share the ConfirmQuit deferral so it never terminates mid-write.
      const requestQuit = windowSetQuitRequesterMock.mock.calls.at(-1)?.[0] as () => boolean
      expect(requestQuit).toBeTypeOf('function')

      let resolveRun!: (result: MigrationResult) => void
      engineMock.run.mockImplementation(() => new Promise<MigrationResult>((resolve) => (resolveRun = resolve)))

      const migrationFlow = invoke(MigrationIpcChannels.StartMigration, { reduxData: {}, dexieExportPath: '/dexie' })
      await Promise.resolve()

      expect(requestQuit()).toBe(false)
      expect(windowConfirmQuitMock).not.toHaveBeenCalled()

      resolveRun({ success: true, totalDuration: 1, migratorResults: [] })
      await migrationFlow
      await tick()

      expect(windowConfirmQuitMock).toHaveBeenCalledTimes(1)
    })
  })
})
