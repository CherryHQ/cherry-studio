import { MigrationIpcChannels, type MigrationProgress, type MigrationResult } from '@shared/data/migration/v2/types'
import { ipcMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Shared mock fns so each test can configure return values.
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
const windowSetQuitRequesterMock = vi.hoisted(() => vi.fn())
const windowClearCloseConfirmMock = vi.hoisted(() => vi.fn())

vi.mock('../../core/MigrationEngine', () => ({ migrationEngine: engineMock }))
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
  unregisterMigrationIpcHandlers
} from '../MigrationIpcHandler'

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

  beforeEach(() => {
    vi.resetAllMocks()
    resetMigrationData()
    registerMigrationIpcHandlers('/mock/userData')
    handlers = new Map(vi.mocked(ipcMain.handle).mock.calls.map(([channel, fn]) => [channel, fn as Handler]))
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
