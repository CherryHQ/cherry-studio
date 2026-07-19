import { MigrationIpcChannels, type MigrationProgress, type MigrationResult } from '@shared/data/migration/v2/types'
import { clipboard, dialog, ipcMain, shell } from 'electron'
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
const windowSetWriteWaiterMock = vi.hoisted(() => vi.fn())
const windowClearCloseConfirmMock = vi.hoisted(() => vi.fn())
const migrationWebContents = vi.hoisted(() => ({ id: 'migration-web-contents' }))
const windowGetMock = vi.hoisted(() => vi.fn())
const diagnosticsStartMock = vi.hoisted(() => vi.fn())
const diagnosticsReportRendererExportFailureMock = vi.hoisted(() => vi.fn())
const diagnosticsSaveBundleMock = vi.hoisted(() => vi.fn())
const isSafeExternalUrlMock = vi.hoisted(() => vi.fn())
const electronMocks = vi.hoisted(() => ({
  app: { getLocale: vi.fn(), quit: vi.fn() },
  clipboard: { writeText: vi.fn() },
  dialog: { showMessageBox: vi.fn(), showSaveDialog: vi.fn() },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() }
}))

vi.mock('@main/utils/externalUrlSafety', () => ({ isSafeExternalUrl: isSafeExternalUrlMock }))
vi.mock('electron', () => electronMocks)

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
    setWriteWaiter: windowSetWriteWaiterMock,
    clearCloseConfirm: windowClearCloseConfirmMock,
    getWindow: windowGetMock
  }
}))

import {
  registerMigrationIpcHandlers,
  resetMigrationData,
  setDataLocationNotice,
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

  function invokeFrom(sender: unknown, channel: string, ...args: unknown[]) {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`No handler registered for ${channel}`)
    return Promise.resolve().then(() => handler({ sender }, ...args))
  }

  function invoke(channel: string, ...args: unknown[]) {
    return invokeFrom(migrationWebContents, channel, ...args)
  }

  beforeEach(() => {
    vi.resetAllMocks()
    electronMocks.app.getLocale.mockReturnValue('en-US')
    windowGetMock.mockReturnValue({ webContents: migrationWebContents })
    isSafeExternalUrlMock.mockReturnValue(true)
    diagnosticsStartMock.mockResolvedValue(undefined)
    diagnosticsReportRendererExportFailureMock.mockResolvedValue(undefined)
    diagnosticsSaveBundleMock.mockResolvedValue({ status: 'saved' })
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: '/main-selected/migration-diagnostics.zip'
    } as never)
    engineMock.run.mockResolvedValue({ success: true, totalDuration: 1, migratorResults: [] })
    resetMigrationData()
    registerMigrationIpcHandlers('/mock/userData', {
      start: diagnosticsStartMock,
      reportRendererExportFailure: diagnosticsReportRendererExportFailureMock,
      saveDiagnosticBundle: diagnosticsSaveBundleMock
    })
    handlers = new Map(vi.mocked(ipcMain.handle).mock.calls.map(([channel, fn]) => [channel, fn as Handler]))
  })

  it('uses the fixed strict-diagnostics channel names', () => {
    expect(MigrationIpcChannels).toMatchObject({
      Start: 'migration:start',
      SaveDiagnosticBundle: 'migration:save-diagnostic-bundle',
      OpenDiagnosticEmail: 'migration:open-diagnostic-email',
      ShowDiagnosticBundleInFolder: 'migration:show-diagnostic-bundle-in-folder',
      CopySupportEmail: 'migration:copy-support-email'
    })
  })

  it('starts renderer-export diagnostics without making StartMigration begin a second attempt', async () => {
    await invoke(MigrationIpcChannels.Start)
    await invoke(MigrationIpcChannels.StartMigration, { reduxData: {}, dexieExportPath: '/dexie' })

    expect(diagnosticsStartMock).toHaveBeenCalledTimes(1)
    expect(diagnosticsStartMock).toHaveBeenCalledWith()
  })

  it('reports renderer export failure through the narrow capability without forwarding the raw message', async () => {
    await invoke(MigrationIpcChannels.ReportError, 'Bearer canary-secret /Users/private')

    expect(diagnosticsReportRendererExportFailureMock).toHaveBeenCalledTimes(1)
    expect(diagnosticsReportRendererExportFailureMock).toHaveBeenCalledWith()
  })

  describe('strict diagnostics support actions', () => {
    it.each(['dialog_failed', 'snapshot_failed', 'archive_failed', 'publish_failed', 'save_in_progress'] as const)(
      'returns the stable %s save failure code',
      async (code) => {
        if (code === 'dialog_failed') {
          vi.mocked(dialog.showSaveDialog).mockRejectedValueOnce(new Error('native canary'))
        } else {
          diagnosticsSaveBundleMock.mockResolvedValueOnce({ status: 'failed', code })
        }

        await expect(invoke(MigrationIpcChannels.SaveDiagnosticBundle)).resolves.toEqual({ status: 'failed', code })
      }
    )

    it('returns canceled without invoking the bundle capability', async () => {
      vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: true, filePath: undefined } as never)

      await expect(invoke(MigrationIpcChannels.SaveDiagnosticBundle)).resolves.toEqual({ status: 'canceled' })
      expect(diagnosticsSaveBundleMock).not.toHaveBeenCalled()
    })

    it('uses only the Main-selected destination and returns the exact saved result', async () => {
      await expect(
        invoke(MigrationIpcChannels.SaveDiagnosticBundle, '/renderer-controlled/escape.zip', 'attacker@example.com')
      ).resolves.toEqual({ status: 'saved', outputCount: 1 })

      expect(diagnosticsSaveBundleMock).toHaveBeenCalledWith('/main-selected/migration-diagnostics.zip')
    })

    it('reveals only the most recent successful Main-selected destination', async () => {
      await invoke(MigrationIpcChannels.SaveDiagnosticBundle)
      vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({
        canceled: false,
        filePath: '/main-selected/replacement-diagnostics.zip'
      } as never)
      await invoke(MigrationIpcChannels.SaveDiagnosticBundle)
      await invoke(MigrationIpcChannels.ShowDiagnosticBundleInFolder, '/renderer-controlled/escape.zip')

      expect(shell.showItemInFolder).toHaveBeenCalledWith('/main-selected/replacement-diagnostics.zip')
      expect(shell.showItemInFolder).not.toHaveBeenCalledWith('/main-selected/migration-diagnostics.zip')
      expect(shell.showItemInFolder).not.toHaveBeenCalledWith('/renderer-controlled/escape.zip')
    })

    it.each([
      'canceled',
      'dialog_failed',
      'snapshot_failed',
      'archive_failed',
      'publish_failed',
      'save_in_progress'
    ] as const)('keeps the last successful destination after a later %s save outcome', async (outcome) => {
      await invoke(MigrationIpcChannels.SaveDiagnosticBundle)
      vi.mocked(shell.showItemInFolder).mockClear()

      if (outcome === 'canceled') {
        vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: true, filePath: undefined } as never)
      } else if (outcome === 'dialog_failed') {
        vi.mocked(dialog.showSaveDialog).mockRejectedValueOnce(new Error('native canary'))
      } else {
        diagnosticsSaveBundleMock.mockResolvedValueOnce({ status: 'failed', code: outcome })
      }
      await invoke(MigrationIpcChannels.SaveDiagnosticBundle)
      await invoke(MigrationIpcChannels.ShowDiagnosticBundleInFolder)

      expect(shell.showItemInFolder).toHaveBeenCalledWith('/main-selected/migration-diagnostics.zip')
    })

    it.each([
      'canceled',
      'dialog_failed',
      'snapshot_failed',
      'archive_failed',
      'publish_failed',
      'save_in_progress'
    ] as const)('has no reveal destination after an initial %s save outcome', async (outcome) => {
      if (outcome === 'canceled') {
        vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: true, filePath: undefined } as never)
      } else if (outcome === 'dialog_failed') {
        vi.mocked(dialog.showSaveDialog).mockRejectedValueOnce(new Error('native canary'))
      } else {
        diagnosticsSaveBundleMock.mockResolvedValueOnce({ status: 'failed', code: outcome })
      }
      await invoke(MigrationIpcChannels.SaveDiagnosticBundle)

      await expect(invoke(MigrationIpcChannels.ShowDiagnosticBundleInFolder)).rejects.toThrow(
        /saved diagnostic bundle/i
      )
      expect(shell.showItemInFolder).not.toHaveBeenCalled()
    })

    it('clears the reveal destination when handlers are unregistered and registered again', async () => {
      await invoke(MigrationIpcChannels.SaveDiagnosticBundle)
      unregisterMigrationIpcHandlers()
      registerMigrationIpcHandlers('/mock/userData', {
        start: diagnosticsStartMock,
        reportRendererExportFailure: diagnosticsReportRendererExportFailureMock,
        saveDiagnosticBundle: diagnosticsSaveBundleMock
      })
      handlers = new Map(vi.mocked(ipcMain.handle).mock.calls.map(([channel, fn]) => [channel, fn as Handler]))

      await expect(invoke(MigrationIpcChannels.ShowDiagnosticBundleInFolder)).rejects.toThrow(
        /saved diagnostic bundle/i
      )
    })

    it('ignores a saved result from an obsolete registration and lets the new registration publish its own path', async () => {
      let resolveOldSave!: (result: { status: 'saved' }) => void
      diagnosticsSaveBundleMock.mockImplementationOnce(
        () => new Promise<{ status: 'saved' }>((resolve) => (resolveOldSave = resolve))
      )
      const oldSave = invoke(MigrationIpcChannels.SaveDiagnosticBundle)
      await vi.waitFor(() => expect(diagnosticsSaveBundleMock).toHaveBeenCalledTimes(1))

      unregisterMigrationIpcHandlers()
      registerMigrationIpcHandlers('/mock/userData', {
        start: diagnosticsStartMock,
        reportRendererExportFailure: diagnosticsReportRendererExportFailureMock,
        saveDiagnosticBundle: diagnosticsSaveBundleMock
      })
      handlers = new Map(vi.mocked(ipcMain.handle).mock.calls.map(([channel, fn]) => [channel, fn as Handler]))

      resolveOldSave({ status: 'saved' })
      await expect(oldSave).resolves.toEqual({ status: 'saved', outputCount: 1 })
      await expect(invoke(MigrationIpcChannels.ShowDiagnosticBundleInFolder)).rejects.toThrow(
        /saved diagnostic bundle/i
      )

      vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({
        canceled: false,
        filePath: '/main-selected/new-registration.zip'
      } as never)
      await invoke(MigrationIpcChannels.SaveDiagnosticBundle)
      await invoke(MigrationIpcChannels.ShowDiagnosticBundleInFolder)
      expect(shell.showItemInFolder).toHaveBeenCalledWith('/main-selected/new-registration.zip')
    })

    it('invalidates a pending save on reset while allowing later saves from the current handlers', async () => {
      let resolveOldSave!: (result: { status: 'saved' }) => void
      diagnosticsSaveBundleMock.mockImplementationOnce(
        () => new Promise<{ status: 'saved' }>((resolve) => (resolveOldSave = resolve))
      )
      const oldSave = invoke(MigrationIpcChannels.SaveDiagnosticBundle)
      await vi.waitFor(() => expect(diagnosticsSaveBundleMock).toHaveBeenCalledTimes(1))

      resetMigrationData()
      resolveOldSave({ status: 'saved' })
      await expect(oldSave).resolves.toEqual({ status: 'saved', outputCount: 1 })
      await expect(invoke(MigrationIpcChannels.ShowDiagnosticBundleInFolder)).rejects.toThrow(
        /saved diagnostic bundle/i
      )

      vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({
        canceled: false,
        filePath: '/main-selected/after-reset.zip'
      } as never)
      await invoke(MigrationIpcChannels.SaveDiagnosticBundle)
      await invoke(MigrationIpcChannels.ShowDiagnosticBundleInFolder)
      expect(shell.showItemInFolder).toHaveBeenCalledWith('/main-selected/after-reset.zip')
    })

    it('returns save_in_progress from the coordinator capability without showing a second error dialog', async () => {
      diagnosticsSaveBundleMock.mockResolvedValueOnce({ status: 'failed', code: 'save_in_progress' })

      await expect(invoke(MigrationIpcChannels.SaveDiagnosticBundle)).resolves.toEqual({
        status: 'failed',
        code: 'save_in_progress'
      })
      expect(dialog.showMessageBox).not.toHaveBeenCalled()
    })

    it('opens a fixed, safely encoded English support mailto only after URL validation', async () => {
      await invoke(
        MigrationIpcChannels.OpenDiagnosticEmail,
        'attacker@example.com',
        'javascript:alert(1)',
        'Bearer canary'
      )

      const mailto = isSafeExternalUrlMock.mock.calls[0]?.[0] as string
      expect(mailto).toMatch(/^mailto:support@cherry-ai\.com\?/)
      const parsed = new URL(mailto)
      expect(parsed.searchParams.get('subject')).toBe('Cherry Studio migration diagnostics')
      expect(parsed.searchParams.get('body')).toBe(
        'Please describe the migration issue and manually attach the saved diagnostic ZIP.'
      )
      expect(isSafeExternalUrlMock).toHaveBeenCalledWith(mailto)
      expect(shell.openExternal).toHaveBeenCalledWith(mailto)
      expect(isSafeExternalUrlMock.mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(shell.openExternal).mock.invocationCallOrder[0]
      )
    })

    it('opens a fixed, safely encoded zh-CN support mailto from Main locale only', async () => {
      electronMocks.app.getLocale.mockReturnValueOnce('zh-CN')

      await invoke(MigrationIpcChannels.OpenDiagnosticEmail, 'attacker@example.com', 'renderer-controlled copy')

      const parsed = new URL(isSafeExternalUrlMock.mock.calls[0]?.[0] as string)
      expect(parsed.searchParams.get('subject')).toBe('Cherry Studio 迁移诊断')
      expect(parsed.searchParams.get('body')).toBe('请描述迁移问题，并手动附上已保存的诊断 ZIP 文件。')
      expect(shell.openExternal).toHaveBeenCalledWith(parsed.toString())
    })

    it('rejects an unsafe fixed mailto without opening it', async () => {
      isSafeExternalUrlMock.mockReturnValueOnce(false)

      await expect(invoke(MigrationIpcChannels.OpenDiagnosticEmail)).rejects.toThrow(/safe support email/i)
      expect(shell.openExternal).not.toHaveBeenCalled()
    })

    it('copies only the fixed support email address', async () => {
      await invoke(MigrationIpcChannels.CopySupportEmail, 'attacker@example.com')

      expect(clipboard.writeText).toHaveBeenCalledWith('support@cherry-ai.com')
    })
  })

  describe('sensitive sender identity', () => {
    it.each([
      MigrationIpcChannels.Start,
      MigrationIpcChannels.SaveDiagnosticBundle,
      MigrationIpcChannels.OpenDiagnosticEmail,
      MigrationIpcChannels.ShowDiagnosticBundleInFolder,
      MigrationIpcChannels.CopySupportEmail
    ])('rejects %s from any sender other than the migration window', async (channel) => {
      await expect(invokeFrom({ id: 'other-web-contents' }, channel)).rejects.toThrow(/migration window/i)
    })

    it('accepts all five sensitive channels from the migration window sender', async () => {
      await expect(invoke(MigrationIpcChannels.Start)).resolves.toBe(true)
      await expect(invoke(MigrationIpcChannels.SaveDiagnosticBundle)).resolves.toEqual({
        status: 'saved',
        outputCount: 1
      })
      await expect(invoke(MigrationIpcChannels.OpenDiagnosticEmail)).resolves.toBe(true)
      await expect(invoke(MigrationIpcChannels.ShowDiagnosticBundleInFolder)).resolves.toBe(true)
      await expect(invoke(MigrationIpcChannels.CopySupportEmail)).resolves.toBe(true)
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

  it('wires the native failure waiter to the same in-flight migration write', async () => {
    let release!: (result: MigrationResult) => void
    engineMock.run.mockImplementation(
      () =>
        new Promise<MigrationResult>((resolve) => {
          release = resolve
        })
    )
    const start = invoke(MigrationIpcChannels.StartMigration, { reduxData: {}, dexieExportPath: '/dexie' })
    await vi.waitFor(() => expect(engineMock.run).toHaveBeenCalledTimes(1))
    const waiter = windowSetWriteWaiterMock.mock.calls.at(-1)?.[0] as (() => Promise<void>) | undefined
    expect(waiter).toBeTypeOf('function')

    let waiterSettled = false
    const waiting = waiter!().then(() => {
      waiterSettled = true
    })
    await Promise.resolve()
    expect(waiterSettled).toBe(false)

    release({ success: true, totalDuration: 1, migratorResults: [] })
    await Promise.all([start, waiting])
    expect(waiterSettled).toBe(true)
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
