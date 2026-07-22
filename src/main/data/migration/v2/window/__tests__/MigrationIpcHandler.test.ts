import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MigrationIpcChannels, type MigrationProgress, type MigrationResult } from '@shared/data/migration/v2/types'
import { clipboard, ipcMain, shell } from 'electron'
import StreamZip from 'node-stream-zip'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Shared mock fns so each test can configure return values.
const electronMock = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  ipcRemoveHandler: vi.fn(),
  appQuit: vi.fn(),
  appGetVersion: vi.fn(() => '2.0.0-test'),
  openExternal: vi.fn(),
  showItemInFolder: vi.fn(),
  clipboardWriteText: vi.fn()
}))
const engineMock = vi.hoisted(() => ({
  onProgress: vi.fn(),
  run: vi.fn(),
  writeExportFile: vi.fn(),
  needsMigration: vi.fn(),
  getLastError: vi.fn(),
  getLastDiagnosticFailure: vi.fn()
}))
const windowSendMock = vi.hoisted(() => vi.fn())
const windowMinimizeMock = vi.hoisted(() => vi.fn())
const windowRequestCloseMock = vi.hoisted(() => vi.fn())
const windowSetStageMock = vi.hoisted(() => vi.fn())
const windowConfirmQuitMock = vi.hoisted(() => vi.fn())
const windowSetQuitRequesterMock = vi.hoisted(() => vi.fn())
const windowClearCloseConfirmMock = vi.hoisted(() => vi.fn())
const diagnosticSaveDialogMock = vi.hoisted(() => vi.fn())
const diagnosticEmailUrlMock = vi.hoisted(() => vi.fn(() => 'mailto:support@cherry-ai.com?subject=diagnostics'))
const diagnosticI18nMock = vi.hoisted(() => vi.fn(async (locale: string) => ({ locale, t: vi.fn() })))
const validateSenderMock = vi.hoisted(() => vi.fn(() => true))
const isSafeExternalUrlMock = vi.hoisted(() => vi.fn(() => true))

vi.mock('electron', () => ({
  app: {
    quit: electronMock.appQuit,
    getVersion: electronMock.appGetVersion
  },
  ipcMain: {
    handle: electronMock.ipcHandle,
    removeHandler: electronMock.ipcRemoveHandler
  },
  shell: {
    openExternal: electronMock.openExternal,
    showItemInFolder: electronMock.showItemInFolder
  },
  clipboard: { writeText: electronMock.clipboardWriteText }
}))

vi.mock('../../core/MigrationEngine', () => ({ migrationEngine: engineMock }))
vi.mock('@main/core/security/validateSender', () => ({ validateSender: validateSenderMock }))
vi.mock('@main/utils/externalUrlSafety', () => ({ isSafeExternalUrl: isSafeExternalUrlMock }))
vi.mock('../migrationDiagnosticDialogs', () => ({
  saveMigrationDiagnosticBundleWithDialog: diagnosticSaveDialogMock
}))
vi.mock('../migrationDiagnosticEmail', () => ({
  createMigrationDiagnosticEmailUrl: diagnosticEmailUrlMock,
  MIGRATION_DIAGNOSTIC_SUPPORT_EMAIL: 'support@cherry-ai.com'
}))
vi.mock('../migrationDiagnosticNativeI18n', () => ({
  createMigrationDiagnosticNativeI18n: diagnosticI18nMock
}))
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

import { MigrationDiagnosticBundleBuilder } from '../../diagnostics'
import {
  registerMigrationIpcHandlers,
  resetMigrationData,
  setDataLocationNotice,
  setVersionIncompatible,
  unregisterMigrationIpcHandlers
} from '../MigrationIpcHandler'

type Handler = (...args: unknown[]) => unknown

describe('MigrationIpcHandler', () => {
  const RUN_ID = 'run-current'
  const migrationPaths = {
    userData: '/mock/userData',
    migrationTempDir: '/mock/userData/migration_temp',
    dexieExportDir: '/mock/userData/migration_temp/dexie_export',
    localStorageExportFile: '/mock/userData/migration_temp/localstorage_export/localStorage.json'
  }
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

  function startMigration(payload: Record<string, unknown>) {
    invoke(MigrationIpcChannels.BeginRun, { runId: RUN_ID })
    return invoke(MigrationIpcChannels.StartMigration, { ...payload, runId: RUN_ID })
  }

  function saveDiagnostics(locale = 'en-US', extra: Record<string, unknown> = {}) {
    return invoke(MigrationIpcChannels.SaveDiagnosticBundle, { locale, ...extra })
  }

  function rendererFailure(error: { name: string; message: string; stack?: string }) {
    return {
      runId: RUN_ID,
      failure: {
        code: 'dexie_export_failed',
        origin: 'renderer',
        operation: 'export_dexie',
        error
      }
    }
  }

  beforeEach(() => {
    vi.resetAllMocks()
    validateSenderMock.mockReturnValue(true)
    isSafeExternalUrlMock.mockReturnValue(true)
    electronMock.appGetVersion.mockReturnValue('2.0.0-test')
    diagnosticEmailUrlMock.mockReturnValue('mailto:support@cherry-ai.com?subject=diagnostics')
    diagnosticI18nMock.mockImplementation(async (locale: string) => ({ locale, t: vi.fn() }))
    engineMock.getLastDiagnosticFailure.mockReturnValue(undefined)
    engineMock.writeExportFile.mockResolvedValue({ ok: true })
    resetMigrationData()
    registerMigrationIpcHandlers(migrationPaths as any)
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

    await startMigration({ reduxData: {} })

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

  it('rejects StartMigration unless a non-empty matching run was begun', async () => {
    await expect(invoke(MigrationIpcChannels.StartMigration, { reduxData: {} })).rejects.toThrow(
      'Stale or missing migration run.'
    )
    expect(engineMock.run).not.toHaveBeenCalled()
  })

  it('rejects a renderer failure reported by an old run after Retry starts a new run', async () => {
    await invoke(MigrationIpcChannels.BeginRun, { runId: 'run-old' })
    await invoke(MigrationIpcChannels.Retry)
    await invoke(MigrationIpcChannels.BeginRun, { runId: 'run-new' })

    const accepted = await invoke(MigrationIpcChannels.ReportError, {
      runId: 'run-old',
      failure: {
        code: 'dexie_export_failed',
        origin: 'renderer',
        operation: 'export_dexie',
        error: { name: 'Error', message: 'old failure' }
      }
    })

    expect(accepted).toBe(false)
    expect(lastProgress().stage).toBe('introduction')
  })

  it('returns and records a Main directory-create failure without Electron error flattening', async () => {
    await invoke(MigrationIpcChannels.BeginRun, { runId: 'run-write' })
    const mkdirError = Object.assign(new Error('not a directory'), {
      code: 'ENOTDIR',
      syscall: 'mkdir',
      path: '/mock/userData/migration_temp'
    })
    engineMock.writeExportFile.mockResolvedValueOnce({
      ok: false,
      operation: 'create_export_directory',
      targetPath: migrationPaths.dexieExportDir,
      error: mkdirError
    })

    const result = await invoke(MigrationIpcChannels.WriteExportFile, {
      target: 'dexie',
      tableName: 'topics',
      jsonData: '[]'
    })

    expect(result).toEqual({
      ok: false,
      failure: {
        code: 'export_directory_create_failed',
        origin: 'main',
        operation: 'create_export_directory',
        targetPath: '/mock/userData/migration_temp/dexie_export',
        error: {
          name: 'Error',
          message: 'not a directory',
          stack: expect.any(String),
          code: 'ENOTDIR',
          syscall: 'mkdir',
          path: '/mock/userData/migration_temp'
        }
      }
    })
    expect(engineMock.writeExportFile).toHaveBeenCalledWith({ target: 'dexie', tableName: 'topics', jsonData: '[]' })
  })

  it('distinguishes a Main export-file write failure from directory creation', async () => {
    await invoke(MigrationIpcChannels.BeginRun, { runId: 'run-write' })
    const writeError = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
      syscall: 'open'
    })
    engineMock.writeExportFile.mockResolvedValueOnce({
      ok: false,
      operation: 'write_export_file',
      targetPath: `${migrationPaths.dexieExportDir}/topics.json`,
      error: writeError
    })

    const result = await invoke(MigrationIpcChannels.WriteExportFile, {
      target: 'dexie',
      tableName: 'topics',
      jsonData: '[]'
    })

    expect(result).toMatchObject({
      ok: false,
      failure: {
        code: 'export_file_write_failed',
        origin: 'main',
        operation: 'write_export_file',
        targetPath: '/mock/userData/migration_temp/dexie_export/topics.json',
        error: {
          message: 'permission denied',
          code: 'EACCES',
          syscall: 'open',
          path: '/mock/userData/migration_temp/dexie_export/topics.json'
        }
      }
    })
  })

  it('saves the Main export failure as the current error summary in the diagnostic JSON', async () => {
    const workDirectory = await mkdtemp(join(tmpdir(), 'migration-ipc-diagnostic-'))
    const logsDirectory = join(workDirectory, 'logs')
    const destination = join(workDirectory, 'diagnostics.zip')
    await mkdir(logsDirectory)

    try {
      await invoke(MigrationIpcChannels.BeginRun, { runId: 'run-write' })
      const writeError = Object.assign(new Error('permission denied'), {
        code: 'EACCES',
        syscall: 'open'
      })
      engineMock.writeExportFile.mockResolvedValueOnce({
        ok: false,
        operation: 'write_export_file',
        targetPath: `${migrationPaths.dexieExportDir}/topics.json`,
        error: writeError
      })
      diagnosticSaveDialogMock.mockImplementationOnce(async (context) => {
        const result = await new MigrationDiagnosticBundleBuilder({
          clock: () => new Date('2026-07-22T12:00:00.000Z'),
          applicationMetadata: { version: '2.0.0-test', platform: 'darwin', arch: 'arm64' }
        }).save({ destination, logsDirectory, context })
        return { result, destination }
      })

      await invoke(MigrationIpcChannels.WriteExportFile, {
        target: 'dexie',
        tableName: 'topics',
        jsonData: '[]'
      })
      await saveDiagnostics()

      const zip = new StreamZip.async({ file: destination })
      try {
        const document = JSON.parse((await zip.entryData('migration-diagnostics.json')).toString('utf8'))
        expect(document.migration).toMatchObject({
          stage: 'error',
          errorSummary: 'permission denied',
          failure: {
            code: 'export_file_write_failed',
            error: { message: 'permission denied' }
          }
        })
        expect(document.migration).not.toHaveProperty('failureCode')
        expect(document.migration).not.toHaveProperty('error')
      } finally {
        await zip.close()
      }
    } finally {
      await rm(workDirectory, { recursive: true, force: true })
    }
  })

  it('rejects unknown Dexie tables before the engine can write', async () => {
    await invoke(MigrationIpcChannels.BeginRun, { runId: 'run-write' })

    await expect(
      invoke(MigrationIpcChannels.WriteExportFile, {
        target: 'dexie',
        tableName: '../outside',
        jsonData: '[]'
      })
    ).rejects.toThrow('Invalid migration export payload')
    expect(engineMock.writeExportFile).not.toHaveBeenCalled()
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

    await startMigration({ reduxData: {} })

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

    await startMigration({ reduxData: {} })

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

    await startMigration({ reduxData: {} })

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

      const result = await startMigration({ reduxData: {} })

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

      await expect(startMigration({ reduxData: {} })).rejects.toThrow('Engine exploded')

      const failure = lastProgress()
      expect(failure.stage).toBe('error')
      expect(failure.error).toBe('Engine exploded')
      expect(windowSetStageMock).toHaveBeenCalledWith('error')

      engineMock.run.mockResolvedValueOnce({ success: true, totalDuration: 1, migratorResults: [] })
      const retry = await startMigration({ reduxData: {} })

      expect(retry).toMatchObject({ success: true })
      expect(lastProgress().stage).toBe('completed')
    })

    it('transitions main to the terminal error stage when the renderer reports a pre-handoff failure', async () => {
      const error = {
        name: 'Error',
        message: 'Dexie export failed',
        stack: 'Error: Dexie export failed\n    at exportAll (/app/renderer.js:12:3)'
      }
      invoke(MigrationIpcChannels.BeginRun, { runId: RUN_ID })
      const result = await invoke(MigrationIpcChannels.ReportError, rendererFailure(error))

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

  describe('diagnostic support actions', () => {
    it('records complete version diagnostics before the incompatible-version window opens', async () => {
      diagnosticSaveDialogMock.mockResolvedValue({ result: { status: 'canceled' } })
      setVersionIncompatible(
        'v1_too_old',
        { previousVersion: '1.5.0', requiredVersion: '1.9.0' },
        {
          currentVersion: '2.0.0-test',
          previousVersion: '1.5.0',
          versionLogExists: true,
          versionLogPath: '/mock/userData/version.log'
        }
      )

      await saveDiagnostics('zh-CN')

      expect(diagnosticSaveDialogMock).toHaveBeenCalledWith(
        expect.objectContaining({
          failure: {
            code: 'v1_too_old',
            origin: 'main',
            operation: 'evaluate_version',
            targetPath: '/mock/userData/version.log',
            version: {
              reason: 'v1_too_old',
              currentVersion: '2.0.0-test',
              previousVersion: '1.5.0',
              requiredVersion: '1.9.0',
              versionLogExists: true
            }
          }
        }),
        { locale: 'zh-CN', userDataPath: '/mock/userData' }
      )
    })

    it('rejects an unsupported Renderer locale before opening the save dialog', async () => {
      await expect(saveDiagnostics('fr-FR')).rejects.toThrow('Unsupported migration diagnostic locale.')

      expect(diagnosticSaveDialogMock).not.toHaveBeenCalled()
    })

    it('builds a renderer context in Main and ignores a caller-supplied destination', async () => {
      let engineTick: ((progress: MigrationProgress) => void) | undefined
      engineMock.onProgress.mockImplementation((callback: (progress: MigrationProgress) => void) => {
        engineTick = callback
      })
      engineMock.run.mockImplementation(async () => {
        engineTick?.({
          stage: 'migration',
          overallProgress: 65,
          currentMessage: 'Migrating…',
          migrators: [
            { id: 'settings', name: 'Settings', status: 'completed' },
            { id: 'messages', name: 'Messages', status: 'failed', error: 'boom' }
          ]
        })
        return { success: false, error: 'Validation failed', totalDuration: 1, migratorResults: [] }
      })
      engineMock.getLastDiagnosticFailure.mockReturnValue({
        code: 'migration_engine_failed',
        origin: 'main',
        operation: 'run_migration',
        error: {
          name: 'Error',
          message: 'Validation failed',
          stack: 'Error: Validation failed\n    at validate (/app/main.js:84:5)'
        }
      })
      diagnosticSaveDialogMock.mockResolvedValue({
        result: { status: 'saved', logs: 'included', size: 'standard' },
        destination: '/main/chosen.zip'
      })

      await startMigration({ reduxData: {} })
      const result = await saveDiagnostics('en-US', { destination: '/renderer/evil.zip' })

      expect(result).toEqual({ status: 'saved', logs: 'included', size: 'standard' })
      expect(diagnosticSaveDialogMock).toHaveBeenCalledTimes(1)
      expect(diagnosticSaveDialogMock).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'renderer',
          stage: 'error',
          errorSummary: 'Validation failed',
          overallProgress: 65,
          migrators: [
            { id: 'settings', status: 'completed' },
            { id: 'messages', status: 'failed' }
          ],
          failure: expect.objectContaining({
            code: 'migration_engine_failed',
            origin: 'main',
            operation: 'run_migration'
          }),
          run: expect.objectContaining({ id: RUN_ID, failedAt: expect.any(String) })
        }),
        { locale: 'en-US', userDataPath: '/mock/userData' }
      )
    })

    it('rejects a concurrent save immediately with save_in_progress', async () => {
      let finishSave!: (value: unknown) => void
      diagnosticSaveDialogMock.mockImplementationOnce(() => new Promise((resolve) => (finishSave = resolve)))

      const first = saveDiagnostics()
      await Promise.resolve()

      await expect(saveDiagnostics()).resolves.toEqual({
        status: 'failed',
        code: 'save_in_progress'
      })
      expect(diagnosticSaveDialogMock).toHaveBeenCalledTimes(1)

      finishSave({ result: { status: 'canceled' } })
      await first
    })

    it.each([
      [MigrationIpcChannels.BeginRun, { runId: 'replacement' }],
      [MigrationIpcChannels.StartMigration, { runId: RUN_ID, reduxData: {} }],
      [MigrationIpcChannels.Retry, undefined],
      [MigrationIpcChannels.SkipMigration, undefined],
      [MigrationIpcChannels.Restart, undefined]
    ] as const)('rejects state mutation on %s while a diagnostic save is in flight', async (channel, payload) => {
      let finishSave!: (value: unknown) => void
      diagnosticSaveDialogMock.mockImplementationOnce(() => new Promise((resolve) => (finishSave = resolve)))
      const saveFlow = saveDiagnostics()
      await Promise.resolve()

      await expect(Promise.resolve().then(() => invoke(channel, payload))).rejects.toThrow(
        'Cannot change migration state while a diagnostic save or quit is in progress'
      )

      finishSave({ result: { status: 'canceled' } })
      await saveFlow
    })

    it('reveals only the latest successful Main-selected path and preserves it across canceled or failed saves', async () => {
      expect(await invoke(MigrationIpcChannels.ShowDiagnosticBundleInFolder)).toBe(false)
      expect(shell.showItemInFolder).not.toHaveBeenCalled()

      diagnosticSaveDialogMock
        .mockResolvedValueOnce({
          result: { status: 'saved', logs: 'not_included', retry: 'suggested', size: 'standard' },
          destination: '/main/success.zip'
        })
        .mockResolvedValueOnce({ result: { status: 'canceled' } })
        .mockResolvedValueOnce({ result: { status: 'failed', code: 'bundle_save_failed' } })

      await saveDiagnostics()
      await saveDiagnostics()
      await saveDiagnostics()

      expect(await invoke(MigrationIpcChannels.ShowDiagnosticBundleInFolder, '/renderer/evil.zip')).toBe(true)
      expect(shell.showItemInFolder).toHaveBeenCalledWith('/main/success.zip')
    })

    it('uses the Renderer locale while keeping the support email content owned by Main', async () => {
      const error = {
        name: 'Error',
        message: 'Dexie export failed',
        stack: 'Error: Dexie export failed\n    at exportAll (/app/renderer.js:12:3)'
      }
      invoke(MigrationIpcChannels.BeginRun, { runId: RUN_ID })
      await invoke(MigrationIpcChannels.ReportError, rendererFailure(error))

      expect(
        await invoke(MigrationIpcChannels.OpenDiagnosticEmail, {
          locale: 'zh-CN',
          recipient: 'attacker@example.com',
          body: 'renderer-controlled'
        })
      ).toBe(true)
      expect(diagnosticEmailUrlMock).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'renderer',
          stage: 'error',
          errorSummary: 'Dexie export failed',
          overallProgress: 0,
          migrators: [],
          failure: expect.objectContaining({ origin: 'renderer', operation: 'export_dexie' }),
          run: expect.objectContaining({ id: RUN_ID, failedAt: expect.any(String) })
        }),
        { version: '2.0.0-test', platform: process.platform, arch: process.arch },
        expect.objectContaining({ locale: 'zh-CN' })
      )
      expect(diagnosticI18nMock).toHaveBeenCalledWith('zh-CN')
      expect(isSafeExternalUrlMock).toHaveBeenCalledWith('mailto:support@cherry-ai.com?subject=diagnostics')
      expect(shell.openExternal).toHaveBeenCalledWith('mailto:support@cherry-ai.com?subject=diagnostics')

      expect(await invoke(MigrationIpcChannels.CopySupportEmail, 'attacker@example.com')).toBe(true)
      expect(clipboard.writeText).toHaveBeenCalledWith('support@cherry-ai.com')
    })

    it('does not open an email URL rejected by the external URL safety gate', async () => {
      isSafeExternalUrlMock.mockReturnValue(false)

      await expect(invoke(MigrationIpcChannels.OpenDiagnosticEmail, { locale: 'en-US' })).rejects.toThrow(
        'Could not create a safe support email URL'
      )
      expect(shell.openExternal).not.toHaveBeenCalled()
    })

    it('rejects an unsupported Renderer locale before creating the email', async () => {
      await expect(invoke(MigrationIpcChannels.OpenDiagnosticEmail, { locale: 'fr-FR' })).rejects.toThrow(
        'Unsupported migration diagnostic email locale.'
      )
      expect(diagnosticI18nMock).not.toHaveBeenCalled()
      expect(shell.openExternal).not.toHaveBeenCalled()
    })

    it.each([
      MigrationIpcChannels.SaveDiagnosticBundle,
      MigrationIpcChannels.OpenDiagnosticEmail,
      MigrationIpcChannels.ShowDiagnosticBundleInFolder,
      MigrationIpcChannels.CopySupportEmail,
      MigrationIpcChannels.ReportError
    ])('rejects an untrusted sender before side effects on %s', async (channel) => {
      validateSenderMock.mockReturnValue(false)

      await expect(Promise.resolve().then(() => invoke(channel))).rejects.toThrow('Untrusted migration IPC sender')
      expect(diagnosticSaveDialogMock).not.toHaveBeenCalled()
      expect(diagnosticEmailUrlMock).not.toHaveBeenCalled()
      expect(shell.openExternal).not.toHaveBeenCalled()
      expect(shell.showItemInFolder).not.toHaveBeenCalled()
      expect(clipboard.writeText).not.toHaveBeenCalled()
    })

    it('rejects an untrusted sender on every registered renderer-to-main handler', async () => {
      validateSenderMock.mockReturnValue(false)

      for (const channel of handlers.keys()) {
        await expect(Promise.resolve().then(() => invoke(channel))).rejects.toThrow('Untrusted migration IPC sender')
      }

      expect(validateSenderMock).toHaveBeenCalledTimes(handlers.size)
    })

    it('clears the latest path and in-flight guard when migration data is reset', async () => {
      diagnosticSaveDialogMock.mockResolvedValueOnce({
        result: { status: 'saved', logs: 'included', size: 'standard' },
        destination: '/main/old.zip'
      })
      await saveDiagnostics()

      let finishOldSave!: (value: unknown) => void
      diagnosticSaveDialogMock
        .mockImplementationOnce(() => new Promise((resolve) => (finishOldSave = resolve)))
        .mockResolvedValueOnce({ result: { status: 'canceled' } })
      const oldSave = saveDiagnostics()
      await Promise.resolve()

      resetMigrationData()

      expect(await invoke(MigrationIpcChannels.ShowDiagnosticBundleInFolder)).toBe(false)
      await expect(saveDiagnostics()).resolves.toEqual({ status: 'canceled' })

      finishOldSave({
        result: { status: 'saved', logs: 'included', size: 'standard' },
        destination: '/main/stale.zip'
      })
      await oldSave
      expect(await invoke(MigrationIpcChannels.ShowDiagnosticBundleInFolder)).toBe(false)
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
      invoke(MigrationIpcChannels.BeginRun, { runId: RUN_ID })
      await invoke(MigrationIpcChannels.ReportError, rendererFailure({ name: 'Error', message: 'boom' }))
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

    it('routes Cancel through the same immediate quit path when no write is in flight', async () => {
      const quitting = await invoke(MigrationIpcChannels.Cancel)

      expect(quitting).toBe(true)
      expect(windowConfirmQuitMock).toHaveBeenCalledTimes(1)
    })

    it('defers quit while a migration is in flight, then quits once it settles', async () => {
      let resolveRun!: (result: MigrationResult) => void
      engineMock.run.mockImplementation(() => new Promise<MigrationResult>((resolve) => (resolveRun = resolve)))

      const migrationFlow = startMigration({ reduxData: {} })
      await Promise.resolve()

      const quitting = await invoke(MigrationIpcChannels.ConfirmQuit)
      expect(quitting).toBe(false)
      expect(windowConfirmQuitMock).not.toHaveBeenCalled()

      resolveRun({ success: true, totalDuration: 1, migratorResults: [] })
      await migrationFlow
      await tick()

      expect(windowConfirmQuitMock).toHaveBeenCalledTimes(1)
    })

    it('continues waiting past 30 seconds while a migration is in flight', async () => {
      vi.useFakeTimers()
      try {
        let resolveRun!: (result: MigrationResult) => void
        engineMock.run.mockImplementation(() => new Promise<MigrationResult>((resolve) => (resolveRun = resolve)))

        const migrationFlow = startMigration({ reduxData: {} })
        await Promise.resolve()

        expect(await invoke(MigrationIpcChannels.ConfirmQuit)).toBe(false)
        await vi.advanceTimersByTimeAsync(30_000)
        expect(windowConfirmQuitMock).not.toHaveBeenCalled()

        resolveRun({ success: true, totalDuration: 1, migratorResults: [] })
        await migrationFlow
        await vi.runAllTimersAsync()

        expect(windowConfirmQuitMock).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not register a second deferred quit on repeated confirmation', async () => {
      let resolveRun!: (result: MigrationResult) => void
      engineMock.run.mockImplementation(() => new Promise<MigrationResult>((resolve) => (resolveRun = resolve)))

      const migrationFlow = startMigration({ reduxData: {} })
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

      const migrationFlow = startMigration({ reduxData: {} })
      await Promise.resolve()

      expect(requestQuit()).toBe(false)
      expect(windowConfirmQuitMock).not.toHaveBeenCalled()

      resolveRun({ success: true, totalDuration: 1, migratorResults: [] })
      await migrationFlow
      await tick()

      expect(windowConfirmQuitMock).toHaveBeenCalledTimes(1)
    })

    it('defers quit while a diagnostic save is in flight, then quits once it settles', async () => {
      let finishSave!: (value: unknown) => void
      diagnosticSaveDialogMock.mockImplementation(() => new Promise((resolve) => (finishSave = resolve)))

      const saveFlow = saveDiagnostics()
      await Promise.resolve()

      expect(await invoke(MigrationIpcChannels.ConfirmQuit)).toBe(false)
      expect(windowConfirmQuitMock).not.toHaveBeenCalled()

      finishSave({ result: { status: 'canceled' } })
      await saveFlow
      await tick()

      expect(windowConfirmQuitMock).toHaveBeenCalledTimes(1)
    })

    it('defers Cancel while a diagnostic save is in flight, then quits once it settles', async () => {
      let finishSave!: (value: unknown) => void
      diagnosticSaveDialogMock.mockImplementation(() => new Promise((resolve) => (finishSave = resolve)))

      const saveFlow = saveDiagnostics()
      await Promise.resolve()

      expect(await invoke(MigrationIpcChannels.Cancel)).toBe(false)
      expect(windowConfirmQuitMock).not.toHaveBeenCalled()

      finishSave({ result: { status: 'canceled' } })
      await saveFlow
      await tick()

      expect(windowConfirmQuitMock).toHaveBeenCalledTimes(1)
    })

    it('continues waiting past 30 seconds and quits only after the diagnostic save settles', async () => {
      vi.useFakeTimers()
      try {
        let finishSave!: (value: unknown) => void
        diagnosticSaveDialogMock.mockImplementation(() => new Promise((resolve) => (finishSave = resolve)))

        const saveFlow = saveDiagnostics()
        await Promise.resolve()

        expect(await invoke(MigrationIpcChannels.ConfirmQuit)).toBe(false)
        await vi.advanceTimersByTimeAsync(60_000)
        expect(windowConfirmQuitMock).not.toHaveBeenCalled()

        finishSave({ result: { status: 'canceled' } })
        await saveFlow
        await vi.runAllTimersAsync()
        expect(windowConfirmQuitMock).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not create timeout timers for repeated confirmation during a diagnostic save', async () => {
      vi.useFakeTimers()
      try {
        diagnosticSaveDialogMock.mockImplementation(() => new Promise(() => undefined))

        void saveDiagnostics()
        await Promise.resolve()

        expect(await invoke(MigrationIpcChannels.ConfirmQuit)).toBe(false)
        expect(await invoke(MigrationIpcChannels.ConfirmQuit)).toBe(false)
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    })

    it('rejects a new diagnostic save after quit has been scheduled', async () => {
      let resolveRun!: (result: MigrationResult) => void
      engineMock.run.mockImplementation(() => new Promise<MigrationResult>((resolve) => (resolveRun = resolve)))
      const migrationFlow = startMigration({ reduxData: {} })
      await Promise.resolve()

      expect(await invoke(MigrationIpcChannels.ConfirmQuit)).toBe(false)
      await expect(invoke(MigrationIpcChannels.Retry)).rejects.toThrow(
        'Cannot change migration state while a diagnostic save or quit is in progress'
      )
      await expect(saveDiagnostics()).resolves.toEqual({
        status: 'failed',
        code: 'save_in_progress'
      })
      expect(diagnosticSaveDialogMock).not.toHaveBeenCalled()

      resolveRun({ success: true, totalDuration: 1, migratorResults: [] })
      await migrationFlow
      await tick()
    })
  })
})
