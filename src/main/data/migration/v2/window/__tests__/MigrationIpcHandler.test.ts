import { lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { MigrationIpcChannels, type MigrationProgress, type MigrationResult } from '@shared/data/migration/v2/types'
import { clipboard, dialog, ipcMain, shell } from 'electron'
import StreamZip from 'node-stream-zip'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  MigrationDiagnosticBundleBuilder,
  migrationDiagnosticBundleDocumentSchema,
  MigrationDiagnosticsCoordinator
} from '../../diagnostics'
import { createMigrationRendererExportDiagnosticFailure } from '../../migrationDiagnostics'

// Shared mock fns so each test can configure return values.
const engineMock = vi.hoisted(() => ({
  onProgress: vi.fn(),
  run: vi.fn(),
  needsMigration: vi.fn(),
  getLastError: vi.fn(),
  skipMigration: vi.fn(),
  close: vi.fn()
}))
const windowSendMock = vi.hoisted(() => vi.fn())
const windowMinimizeMock = vi.hoisted(() => vi.fn())
const windowRequestCloseMock = vi.hoisted(() => vi.fn())
const windowSetStageMock = vi.hoisted(() => vi.fn())
const windowConfirmQuitMock = vi.hoisted(() => vi.fn())
const windowSetQuitRequesterMock = vi.hoisted(() => vi.fn())
const windowSetWriteWaiterMock = vi.hoisted(() => vi.fn())
const windowClearCloseConfirmMock = vi.hoisted(() => vi.fn())
const windowRestartAppMock = vi.hoisted(() => vi.fn())
const migrationMainFrame = vi.hoisted(() => ({ id: 'migration-main-frame', parent: null }))
const migrationWebContents = vi.hoisted(() => ({
  id: 'migration-web-contents',
  getType: () => 'window',
  mainFrame: migrationMainFrame
}))
const windowGetMock = vi.hoisted(() => vi.fn())
const diagnosticsStartMock = vi.hoisted(() => vi.fn())
const diagnosticsReportRendererExportFailureMock = vi.hoisted(() => vi.fn())
const diagnosticsSaveBundleMock = vi.hoisted(() => vi.fn())
const diagnosticsCompleteVersionGateMock = vi.hoisted(() => vi.fn())
const isSafeExternalUrlMock = vi.hoisted(() => vi.fn())
const fsMocks = vi.hoisted(() => ({ lstat: vi.fn(), mkdir: vi.fn(), writeFile: vi.fn() }))
function createMigrationIpcPaths(userData: string) {
  const migrationTempDir = path.join(userData, 'migration_temp')
  const localStorageExportDir = path.join(migrationTempDir, 'localstorage_export')
  return Object.freeze({
    userData,
    migrationTempDir,
    dexieExportDir: path.join(migrationTempDir, 'dexie_export'),
    localStorageExportDir,
    localStorageExportFile: path.join(localStorageExportDir, 'localStorage.json')
  })
}
const migrationIpcPaths = createMigrationIpcPaths('/mock/userData')
const electronMocks = vi.hoisted(() => ({
  app: { getLocale: vi.fn(), quit: vi.fn() },
  clipboard: { writeText: vi.fn() },
  dialog: { showMessageBox: vi.fn(), showSaveDialog: vi.fn() },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() }
}))

vi.mock('@main/utils/externalUrlSafety', () => ({ isSafeExternalUrl: isSafeExternalUrlMock }))
vi.mock('electron', () => electronMocks)
vi.mock('fs/promises', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  default: fsMocks
}))

vi.mock('../../core/MigrationEngine', () => ({ migrationEngine: engineMock }))
vi.mock('../MigrationWindowManager', () => ({
  migrationWindowManager: {
    send: windowSendMock,
    close: vi.fn(),
    restartApp: windowRestartAppMock,
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
  runMigrationDiagnosticSaveTransaction,
  setDataLocationNotice,
  setVersionIncompatible,
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

  function invokeFrom(source: { sender: unknown; senderFrame: unknown }, channel: string, ...args: unknown[]) {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`No handler registered for ${channel}`)
    return Promise.resolve().then(() => handler(source, ...args))
  }

  function invoke(channel: string, ...args: unknown[]) {
    return invokeFrom({ sender: migrationWebContents, senderFrame: migrationMainFrame }, channel, ...args)
  }

  function useRealExportFilesystem(): void {
    fsMocks.mkdir.mockImplementation(async (target, options) => {
      mkdirSync(target, options)
    })
    fsMocks.writeFile.mockImplementation(async (target, data, encoding) => {
      writeFileSync(target, data, encoding)
    })
    fsMocks.lstat.mockImplementation(async (target) => lstatSync(target))
  }

  beforeEach(() => {
    vi.resetAllMocks()
    electronMocks.app.getLocale.mockReturnValue('en-US')
    windowGetMock.mockReturnValue({ webContents: migrationWebContents })
    isSafeExternalUrlMock.mockReturnValue(true)
    diagnosticsStartMock.mockResolvedValue(undefined)
    diagnosticsReportRendererExportFailureMock.mockResolvedValue(undefined)
    diagnosticsSaveBundleMock.mockResolvedValue({ status: 'saved' })
    fsMocks.mkdir.mockResolvedValue(undefined)
    fsMocks.writeFile.mockResolvedValue(undefined)
    fsMocks.lstat.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }))
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: '/main-selected/migration-diagnostics.zip'
    } as never)
    engineMock.run.mockResolvedValue({ success: true, totalDuration: 1, migratorResults: [] })
    engineMock.skipMigration.mockResolvedValue(undefined)
    resetMigrationData()
    registerMigrationIpcHandlers(migrationIpcPaths, {
      start: diagnosticsStartMock,
      reportRendererExportFailure: diagnosticsReportRendererExportFailureMock,
      saveDiagnosticBundle: diagnosticsSaveBundleMock,
      completeVersionGate: diagnosticsCompleteVersionGateMock
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

  it('returns the precomputed MigrationPaths userData value', async () => {
    await expect(invoke(MigrationIpcChannels.GetUserDataPath)).resolves.toBe(migrationIpcPaths.userData)
  })

  it('starts renderer-export diagnostics without making StartMigration begin a second attempt', async () => {
    await invoke(MigrationIpcChannels.Start)
    await invoke(MigrationIpcChannels.StartMigration, { reduxData: {}, dexieExportPath: '/dexie' })

    expect(diagnosticsStartMock).toHaveBeenCalledTimes(1)
    expect(diagnosticsStartMock).toHaveBeenCalledWith()
  })

  it('reports renderer export failure through the narrow capability without forwarding the raw message', async () => {
    await invoke(MigrationIpcChannels.Start)
    await invoke(MigrationIpcChannels.ReportError, {
      message: 'Bearer canary-secret /Users/private',
      report: { sourceRole: 'dexie', operationRole: 'read' }
    })

    expect(diagnosticsReportRendererExportFailureMock).toHaveBeenCalledTimes(1)
    expect(diagnosticsReportRendererExportFailureMock).toHaveBeenCalledWith(
      { sourceRole: 'dexie', operationRole: 'read' },
      undefined
    )
    expect(JSON.stringify(diagnosticsReportRendererExportFailureMock.mock.calls)).not.toContain('Bearer canary-secret')
  })

  describe('strict diagnostics support actions', () => {
    it.each(['dialog_failed', 'snapshot_failed', 'bundle_save_failed', 'save_in_progress'] as const)(
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
      ).resolves.toEqual({ status: 'saved' })

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

    it.each(['canceled', 'dialog_failed', 'snapshot_failed', 'bundle_save_failed', 'save_in_progress'] as const)(
      'keeps the last successful destination after a later %s save outcome',
      async (outcome) => {
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
      }
    )

    it.each(['canceled', 'dialog_failed', 'snapshot_failed', 'bundle_save_failed', 'save_in_progress'] as const)(
      'has no reveal destination after an initial %s save outcome',
      async (outcome) => {
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
      }
    )

    it('clears the reveal destination when handlers are unregistered and registered again', async () => {
      await invoke(MigrationIpcChannels.SaveDiagnosticBundle)
      unregisterMigrationIpcHandlers()
      registerMigrationIpcHandlers(migrationIpcPaths, {
        start: diagnosticsStartMock,
        reportRendererExportFailure: diagnosticsReportRendererExportFailureMock,
        saveDiagnosticBundle: diagnosticsSaveBundleMock,
        completeVersionGate: diagnosticsCompleteVersionGateMock
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
      registerMigrationIpcHandlers(migrationIpcPaths, {
        start: diagnosticsStartMock,
        reportRendererExportFailure: diagnosticsReportRendererExportFailureMock,
        saveDiagnosticBundle: diagnosticsSaveBundleMock,
        completeVersionGate: diagnosticsCompleteVersionGateMock
      })
      handlers = new Map(vi.mocked(ipcMain.handle).mock.calls.map(([channel, fn]) => [channel, fn as Handler]))

      resolveOldSave({ status: 'saved' })
      await expect(oldSave).resolves.toEqual({ status: 'saved' })
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
      await expect(oldSave).resolves.toEqual({ status: 'saved' })
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

    it('rejects a concurrent save before opening a second native dialog', async () => {
      let resolveDialog!: (result: { canceled: true; filePath: undefined }) => void
      vi.mocked(dialog.showSaveDialog).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveDialog = resolve as typeof resolveDialog
          }) as never
      )

      const firstSave = invoke(MigrationIpcChannels.SaveDiagnosticBundle)
      await vi.waitFor(() => expect(dialog.showSaveDialog).toHaveBeenCalledTimes(1))

      await expect(invoke(MigrationIpcChannels.SaveDiagnosticBundle)).resolves.toEqual({
        status: 'failed',
        code: 'save_in_progress'
      })
      expect(dialog.showSaveDialog).toHaveBeenCalledTimes(1)

      resolveDialog({ canceled: true, filePath: undefined })
      await expect(firstSave).resolves.toEqual({ status: 'canceled' })
    })

    it.each(['canceled', 'failed', 'saved'] as const)(
      'releases the full save guard after a %s outcome',
      async (outcome) => {
        if (outcome === 'canceled') {
          vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: true, filePath: undefined } as never)
        } else if (outcome === 'failed') {
          diagnosticsSaveBundleMock.mockResolvedValueOnce({ status: 'failed', code: 'bundle_save_failed' })
        }

        await invoke(MigrationIpcChannels.SaveDiagnosticBundle)
        await expect(invoke(MigrationIpcChannels.SaveDiagnosticBundle)).resolves.toEqual({ status: 'saved' })

        expect(dialog.showSaveDialog).toHaveBeenCalledTimes(2)
      }
    )

    it('keeps the full save guard across handler replacement until the old dialog settles', async () => {
      let resolveOldDialog!: (result: { canceled: true; filePath: undefined }) => void
      vi.mocked(dialog.showSaveDialog).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOldDialog = resolve as typeof resolveOldDialog
          }) as never
      )
      const oldSave = invoke(MigrationIpcChannels.SaveDiagnosticBundle)
      await vi.waitFor(() => expect(dialog.showSaveDialog).toHaveBeenCalledTimes(1))

      unregisterMigrationIpcHandlers()
      registerMigrationIpcHandlers(migrationIpcPaths, {
        start: diagnosticsStartMock,
        reportRendererExportFailure: diagnosticsReportRendererExportFailureMock,
        saveDiagnosticBundle: diagnosticsSaveBundleMock,
        completeVersionGate: diagnosticsCompleteVersionGateMock
      })
      handlers = new Map(vi.mocked(ipcMain.handle).mock.calls.map(([channel, fn]) => [channel, fn as Handler]))

      await expect(invoke(MigrationIpcChannels.SaveDiagnosticBundle)).resolves.toEqual({
        status: 'failed',
        code: 'save_in_progress'
      })
      expect(dialog.showSaveDialog).toHaveBeenCalledTimes(1)

      resolveOldDialog({ canceled: true, filePath: undefined })
      await oldSave
      await expect(invoke(MigrationIpcChannels.SaveDiagnosticBundle)).resolves.toEqual({ status: 'saved' })
      expect(dialog.showSaveDialog).toHaveBeenCalledTimes(2)
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
    const sensitiveChannels = [
      MigrationIpcChannels.Start,
      MigrationIpcChannels.SaveDiagnosticBundle,
      MigrationIpcChannels.OpenDiagnosticEmail,
      MigrationIpcChannels.ShowDiagnosticBundleInFolder,
      MigrationIpcChannels.CopySupportEmail,
      MigrationIpcChannels.Retry
    ] as const

    const foreignMainFrame = { id: 'foreign-main-frame', parent: null }
    const foreignWebContents = { id: 'foreign-web-contents', getType: () => 'window', mainFrame: foreignMainFrame }
    const webviewMainFrame = { id: 'webview-main-frame', parent: null }
    const webviewWebContents = { id: 'webview-web-contents', getType: () => 'webview', mainFrame: webviewMainFrame }

    it.each(
      sensitiveChannels.flatMap((channel) => [
        [
          channel,
          'same-webContents subframe',
          { sender: migrationWebContents, senderFrame: { parent: migrationMainFrame } }
        ],
        [channel, 'same-webContents null frame', { sender: migrationWebContents, senderFrame: null }],
        [channel, 'foreign window', { sender: foreignWebContents, senderFrame: foreignMainFrame }],
        [channel, 'webview', { sender: webviewWebContents, senderFrame: webviewMainFrame }]
      ])
    )('rejects %s from a %s caller', async (channel, _caller, source) => {
      await expect(invokeFrom(source, channel)).rejects.toThrow(/migration window/i)
    })

    it('accepts all six sensitive channels only from the migration window top frame', async () => {
      await expect(invoke(MigrationIpcChannels.Start)).resolves.toBe(true)
      await expect(invoke(MigrationIpcChannels.SaveDiagnosticBundle)).resolves.toEqual({ status: 'saved' })
      await expect(invoke(MigrationIpcChannels.OpenDiagnosticEmail)).resolves.toBe(true)
      await expect(invoke(MigrationIpcChannels.ShowDiagnosticBundleInFolder)).resolves.toBe(true)
      await expect(invoke(MigrationIpcChannels.CopySupportEmail)).resolves.toBe(true)
      await expect(invoke(MigrationIpcChannels.Retry)).resolves.toBe(true)
    })

    it.each([
      [MigrationIpcChannels.WriteExportFile, ['/private/export', 'topics', '{}']],
      [MigrationIpcChannels.StartMigration, [{ reduxData: {}, dexieExportPath: '/dexie' }]]
    ] as const)('rejects %s from a foreign window before using its payload', async (channel, args) => {
      await expect(
        invokeFrom(
          { sender: foreignWebContents, senderFrame: foreignMainFrame },
          channel,
          ...(args as readonly unknown[])
        )
      ).rejects.toThrow(/migration window/i)
      expect(fsMocks.writeFile).not.toHaveBeenCalled()
      expect(engineMock.run).not.toHaveBeenCalled()
    })
  })

  describe('renderer export phase', () => {
    const foreignMainFrame = { id: 'foreign-main-frame', parent: null }
    const foreignWebContents = { id: 'foreign-web-contents', getType: () => 'window', mainFrame: foreignMainFrame }
    const webviewMainFrame = { id: 'webview-main-frame', parent: null }
    const webviewWebContents = { id: 'webview-web-contents', getType: () => 'webview', mainFrame: webviewMainFrame }

    it('requires an accepted renderer-export generation before writing files or handing off to the engine', async () => {
      await expect(invoke(MigrationIpcChannels.WriteExportFile, '/private/export', 'topics', '{}')).rejects.toThrow(
        /renderer export/i
      )
      await expect(
        invoke(MigrationIpcChannels.StartMigration, { reduxData: {}, dexieExportPath: '/dexie' })
      ).rejects.toThrow(/renderer export/i)
      expect(fsMocks.writeFile).not.toHaveBeenCalled()
      expect(engineMock.run).not.toHaveBeenCalled()

      await expect(invoke(MigrationIpcChannels.Start)).resolves.toBe(true)
      await expect(invoke(MigrationIpcChannels.WriteExportFile, '/private/export', 'topics', '{}')).resolves.toBe(true)
      await expect(
        invoke(MigrationIpcChannels.StartMigration, { reduxData: {}, dexieExportPath: '/dexie' })
      ).resolves.toMatchObject({ success: true })
    })

    it('rejects a stale registration and a non-introduction stage before engine handoff', async () => {
      const staleStart = handlers.get(MigrationIpcChannels.Start)
      const staleHandoff = handlers.get(MigrationIpcChannels.StartMigration)
      if (staleStart === undefined || staleHandoff === undefined) throw new Error('Expected migration handlers')
      await staleStart({ sender: migrationWebContents, senderFrame: migrationMainFrame })

      unregisterMigrationIpcHandlers()
      registerMigrationIpcHandlers(migrationIpcPaths, {
        start: diagnosticsStartMock,
        reportRendererExportFailure: diagnosticsReportRendererExportFailureMock,
        saveDiagnosticBundle: diagnosticsSaveBundleMock,
        completeVersionGate: diagnosticsCompleteVersionGateMock
      })
      await expect(
        Promise.resolve(
          staleHandoff(
            { sender: migrationWebContents, senderFrame: migrationMainFrame },
            { reduxData: {}, dexieExportPath: '/dexie' }
          )
        )
      ).rejects.toThrow(/renderer export/i)

      handlers = new Map(vi.mocked(ipcMain.handle).mock.calls.map(([channel, fn]) => [channel, fn as Handler]))
      setVersionIncompatible('v1_too_old', { previousVersion: '1.0.0', requiredVersion: '1.9.12' })
      await expect(
        invoke(MigrationIpcChannels.StartMigration, { reduxData: {}, dexieExportPath: '/dexie' })
      ).rejects.toThrow(/renderer export/i)
      expect(engineMock.run).not.toHaveBeenCalled()
    })

    it.each([
      ['same-webContents subframe', { sender: migrationWebContents, senderFrame: { parent: migrationMainFrame } }],
      ['same-webContents null frame', { sender: migrationWebContents, senderFrame: null }],
      ['foreign window', { sender: foreignWebContents, senderFrame: foreignMainFrame }],
      ['webview', { sender: webviewWebContents, senderFrame: webviewMainFrame }]
    ])('rejects ReportError from a %s caller without consuming the active phase', async (_caller, source) => {
      await invoke(MigrationIpcChannels.Start)

      await expect(invokeFrom(source, MigrationIpcChannels.ReportError, 'foreign canary')).rejects.toThrow(
        /migration window/i
      )
      expect(diagnosticsReportRendererExportFailureMock).not.toHaveBeenCalled()

      await expect(invoke(MigrationIpcChannels.ReportError, 'real renderer failure')).resolves.toBe(true)
      expect(diagnosticsReportRendererExportFailureMock).toHaveBeenCalledTimes(1)
    })

    it('ignores ReportError when no renderer export phase is active', async () => {
      await expect(invoke(MigrationIpcChannels.ReportError, 'forged terminal message')).resolves.toBe(false)

      expect(diagnosticsReportRendererExportFailureMock).not.toHaveBeenCalled()
      expect(progressBroadcasts()).toEqual([])
    })

    it('consumes an active renderer export failure exactly once', async () => {
      await invoke(MigrationIpcChannels.Start)

      await expect(invoke(MigrationIpcChannels.ReportError, 'first failure')).resolves.toBe(true)
      await expect(invoke(MigrationIpcChannels.ReportError, 'late replacement')).resolves.toBe(false)

      expect(diagnosticsReportRendererExportFailureMock).toHaveBeenCalledTimes(1)
      expect(lastProgress()).toMatchObject({ stage: 'error', error: 'first failure' })
    })

    it('downgrades an invalid or extended report to the fixed unknown report while keeping message UI-only', async () => {
      await invoke(MigrationIpcChannels.Start)

      await expect(
        invoke(MigrationIpcChannels.ReportError, {
          message: 'PRIVATE_UI_ONLY',
          report: { sourceRole: 'dexie', operationRole: 'read' },
          extra: 'not-allowed'
        })
      ).resolves.toBe(true)

      expect(diagnosticsReportRendererExportFailureMock).toHaveBeenCalledWith(
        { sourceRole: 'unknown', operationRole: 'unknown' },
        undefined
      )
      expect(JSON.stringify(diagnosticsReportRendererExportFailureMock.mock.calls)).not.toContain('PRIVATE_UI_ONLY')
      expect(lastProgress()).toMatchObject({ stage: 'error', error: 'PRIVATE_UI_ONLY' })
    })

    it.each([
      ['ENOSPC', 'file_io'],
      ['EACCES', 'file_permission']
    ] as const)('prioritizes a Main-owned %s export write classification', async (code, errorCode) => {
      const original = Object.assign(new Error(`PRIVATE_MAIN_WRITE_${code}`), { code })
      fsMocks.writeFile.mockRejectedValueOnce(original)
      await invoke(MigrationIpcChannels.Start)

      await expect(
        invoke(MigrationIpcChannels.WriteExportFile, '/private/export', 'topics', 'PRIVATE_JSON')
      ).rejects.toBe(original)
      await invoke(MigrationIpcChannels.ReportError, {
        message: 'renderer received a rejected IPC invoke',
        report: { sourceRole: 'dexie', operationRole: 'write' }
      })

      expect(diagnosticsReportRendererExportFailureMock).toHaveBeenCalledWith(
        { sourceRole: 'dexie', operationRole: 'write' },
        { errorCode }
      )
      expect(JSON.stringify(diagnosticsReportRendererExportFailureMock.mock.calls)).not.toContain('PRIVATE_MAIN_WRITE')
    })

    it('captures a real ENOTDIR migration-temp blocker without exposing the path or payload', async () => {
      const userData = mkdtempSync(path.join(tmpdir(), 'cs-migration-handler-enotdir-'))
      const paths = createMigrationIpcPaths(userData)
      writeFileSync(paths.migrationTempDir, 'blocker')
      useRealExportFilesystem()
      unregisterMigrationIpcHandlers()
      registerMigrationIpcHandlers(paths, {
        start: diagnosticsStartMock,
        reportRendererExportFailure: diagnosticsReportRendererExportFailureMock,
        saveDiagnosticBundle: diagnosticsSaveBundleMock,
        completeVersionGate: diagnosticsCompleteVersionGateMock
      })
      handlers = new Map(vi.mocked(ipcMain.handle).mock.calls.map(([channel, fn]) => [channel, fn as Handler]))

      try {
        await invoke(MigrationIpcChannels.Start)
        await expect(
          invoke(MigrationIpcChannels.WriteExportFile, paths.localStorageExportDir, 'localStorage', 'PRIVATE_JSON')
        ).rejects.toMatchObject({ code: 'ENOTDIR' })
        await invoke(MigrationIpcChannels.ReportError, {
          message: 'renderer received a rejected IPC invoke',
          report: { sourceRole: 'local_storage', operationRole: 'write' }
        })

        expect(fsMocks.lstat.mock.calls).toEqual([[paths.migrationTempDir]])
        expect(diagnosticsReportRendererExportFailureMock).toHaveBeenCalledWith(
          { sourceRole: 'local_storage', operationRole: 'write' },
          {
            errorCode: 'file_invalid_type',
            filesystemEvidence: {
              causeCode: 'ENOTDIR',
              filesystemOperation: 'mkdir',
              targetRole: 'local_storage_export_file',
              blockingNodeRole: 'migration_temp_root',
              expectedNodeType: 'file',
              observedNodeType: 'file'
            }
          }
        )
        const capabilityPayload = JSON.stringify(diagnosticsReportRendererExportFailureMock.mock.calls)
        expect(capabilityPayload).not.toContain(userData)
        expect(capabilityPayload).not.toContain('PRIVATE_JSON')
      } finally {
        rmSync(userData, { recursive: true, force: true })
      }
    })

    it('publishes handler-produced filesystem evidence through the real coordinator and ZIP builder', async () => {
      const testDir = mkdtempSync(path.join(tmpdir(), 'cs-migration-handler-evidence-'))
      const destination = path.join(testDir, 'diagnostics.zip')
      const paths = createMigrationIpcPaths(path.join(testDir, 'user-data'))
      const coordinator = new MigrationDiagnosticsCoordinator({
        appVersion: '2.0.0',
        platform: 'darwin',
        arch: 'arm64',
        clock: () => new Date('2026-07-21T08:00:00.000Z')
      })
      const bundleBuilder = new MigrationDiagnosticBundleBuilder({
        clock: () => new Date('2026-07-21T08:01:00.000Z')
      })
      mkdirSync(paths.localStorageExportFile, { recursive: true })
      useRealExportFilesystem()

      unregisterMigrationIpcHandlers()
      registerMigrationIpcHandlers(paths, {
        start: () => {
          coordinator.beginAttempt('initial')
          coordinator.updateLocation({ scope: 'renderer_export', phase: 'prepare' })
        },
        reportRendererExportFailure: (report, mainWriteFailure) => {
          coordinator.finishAttempt({
            status: 'failed',
            failure: createMigrationRendererExportDiagnosticFailure(report, mainWriteFailure)
          })
        },
        saveDiagnosticBundle: async (saveDestination) => {
          const result = await bundleBuilder.save({
            destination: saveDestination,
            snapshot: await coordinator.snapshot(),
            collectDatabaseDiagnostics: async () => ({
              file: { status: 'unreadable', sqliteHeader: 'unavailable' },
              sqlite: { status: 'unavailable', reason: 'not_attempted' }
            })
          })
          return result.status === 'saved' ? { status: 'saved' } : result
        },
        completeVersionGate: () => undefined
      })
      handlers = new Map(vi.mocked(ipcMain.handle).mock.calls.map(([channel, fn]) => [channel, fn as Handler]))
      vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath: destination } as never)

      try {
        await invoke(MigrationIpcChannels.Start)
        await expect(
          invoke(MigrationIpcChannels.WriteExportFile, paths.localStorageExportDir, 'localStorage', 'PRIVATE_JSON')
        ).rejects.toMatchObject({ code: 'EISDIR' })
        await invoke(MigrationIpcChannels.ReportError, {
          message: 'PRIVATE_RENDERER_MESSAGE',
          report: { sourceRole: 'redux', operationRole: 'parse' }
        })
        await expect(invoke(MigrationIpcChannels.SaveDiagnosticBundle)).resolves.toEqual({ status: 'saved' })

        const zip = new StreamZip.async({ file: destination })
        try {
          const entries = await zip.entries()
          expect(Object.keys(entries).sort()).toEqual(['README.txt', 'migration-diagnostics.json'])
          const document = migrationDiagnosticBundleDocumentSchema.parse(
            JSON.parse((await zip.entryData('migration-diagnostics.json')).toString('utf8'))
          )
          expect(document.current).toMatchObject({
            status: 'failed',
            failure: {
              kind: 'renderer_export_failed',
              errorCode: 'file_invalid_type',
              evidence: {
                kind: 'renderer_export',
                sourceRole: 'local_storage',
                operationRole: 'write',
                filesystemEvidence: {
                  causeCode: 'EISDIR',
                  filesystemOperation: 'write',
                  targetRole: 'local_storage_export_file',
                  blockingNodeRole: 'local_storage_export_file',
                  expectedNodeType: 'file',
                  observedNodeType: 'directory'
                }
              }
            }
          })
          expect(fsMocks.lstat.mock.calls).toEqual([
            [paths.migrationTempDir],
            [paths.localStorageExportDir],
            [paths.localStorageExportFile]
          ])
          const serialized = Buffer.concat([
            await zip.entryData('migration-diagnostics.json'),
            await zip.entryData('README.txt')
          ]).toString('utf8')
          expect(serialized).not.toContain(paths.userData)
          expect(serialized).not.toContain('PRIVATE_RENDERER_MESSAGE')
          expect(serialized).not.toContain('PRIVATE_JSON')
        } finally {
          await zip.close()
        }
      } finally {
        rmSync(testDir, { recursive: true, force: true })
      }
    })

    it('captures a real EEXIST Dexie export-directory blocker', async () => {
      const userData = mkdtempSync(path.join(tmpdir(), 'cs-migration-handler-dexie-eexist-'))
      const paths = createMigrationIpcPaths(userData)
      mkdirSync(paths.migrationTempDir, { recursive: true })
      writeFileSync(paths.dexieExportDir, 'blocker')
      useRealExportFilesystem()
      unregisterMigrationIpcHandlers()
      registerMigrationIpcHandlers(paths, {
        start: diagnosticsStartMock,
        reportRendererExportFailure: diagnosticsReportRendererExportFailureMock,
        saveDiagnosticBundle: diagnosticsSaveBundleMock,
        completeVersionGate: diagnosticsCompleteVersionGateMock
      })
      handlers = new Map(vi.mocked(ipcMain.handle).mock.calls.map(([channel, fn]) => [channel, fn as Handler]))

      try {
        await invoke(MigrationIpcChannels.Start)
        await expect(
          invoke(MigrationIpcChannels.WriteExportFile, paths.dexieExportDir, 'topics', 'PRIVATE_JSON')
        ).rejects.toMatchObject({ code: 'EEXIST' })
        await invoke(MigrationIpcChannels.ReportError, {
          message: 'renderer received a rejected IPC invoke',
          report: { sourceRole: 'dexie', operationRole: 'write' }
        })

        expect(fsMocks.lstat.mock.calls).toEqual([[paths.migrationTempDir], [paths.dexieExportDir]])
        expect(diagnosticsReportRendererExportFailureMock).toHaveBeenCalledWith(
          { sourceRole: 'dexie', operationRole: 'write' },
          {
            errorCode: 'file_invalid_type',
            filesystemEvidence: {
              causeCode: 'EEXIST',
              filesystemOperation: 'mkdir',
              targetRole: 'dexie_export_directory',
              blockingNodeRole: 'dexie_export_directory',
              expectedNodeType: 'directory',
              observedNodeType: 'file'
            }
          }
        )
      } finally {
        rmSync(userData, { recursive: true, force: true })
      }
    })

    it('captures a real EEXIST local-storage export-directory blocker', async () => {
      const userData = mkdtempSync(path.join(tmpdir(), 'cs-migration-handler-local-eexist-'))
      const paths = createMigrationIpcPaths(userData)
      mkdirSync(paths.migrationTempDir, { recursive: true })
      writeFileSync(paths.localStorageExportDir, 'blocker')
      useRealExportFilesystem()
      unregisterMigrationIpcHandlers()
      registerMigrationIpcHandlers(paths, {
        start: diagnosticsStartMock,
        reportRendererExportFailure: diagnosticsReportRendererExportFailureMock,
        saveDiagnosticBundle: diagnosticsSaveBundleMock,
        completeVersionGate: diagnosticsCompleteVersionGateMock
      })
      handlers = new Map(vi.mocked(ipcMain.handle).mock.calls.map(([channel, fn]) => [channel, fn as Handler]))

      try {
        await invoke(MigrationIpcChannels.Start)
        await expect(
          invoke(MigrationIpcChannels.WriteExportFile, paths.localStorageExportDir, 'localStorage', 'PRIVATE_JSON')
        ).rejects.toMatchObject({ code: 'EEXIST' })
        await invoke(MigrationIpcChannels.ReportError, {
          message: 'renderer received a rejected IPC invoke',
          report: { sourceRole: 'local_storage', operationRole: 'write' }
        })

        expect(fsMocks.lstat.mock.calls).toEqual([[paths.migrationTempDir], [paths.localStorageExportDir]])
        expect(diagnosticsReportRendererExportFailureMock).toHaveBeenCalledWith(
          { sourceRole: 'local_storage', operationRole: 'write' },
          {
            errorCode: 'file_invalid_type',
            filesystemEvidence: {
              causeCode: 'EEXIST',
              filesystemOperation: 'mkdir',
              targetRole: 'local_storage_export_file',
              blockingNodeRole: 'local_storage_export_directory',
              expectedNodeType: 'file',
              observedNodeType: 'file'
            }
          }
        )
      } finally {
        rmSync(userData, { recursive: true, force: true })
      }
    })

    it('keeps the original type conflict when the controlled lstat probe fails', async () => {
      const original = Object.assign(new Error('PRIVATE_ORIGINAL_FAILURE'), { code: 'ENOTDIR' })
      fsMocks.mkdir.mockRejectedValueOnce(original)
      fsMocks.lstat.mockRejectedValueOnce(new Error('PRIVATE_PROBE_FAILURE'))
      await invoke(MigrationIpcChannels.Start)

      await expect(
        invoke(
          MigrationIpcChannels.WriteExportFile,
          '/mock/userData/migration_temp/dexie_export',
          'topics',
          'PRIVATE_JSON'
        )
      ).rejects.toBe(original)
      await invoke(MigrationIpcChannels.ReportError, {
        message: 'renderer received a rejected IPC invoke',
        report: { sourceRole: 'dexie', operationRole: 'write' }
      })

      expect(diagnosticsReportRendererExportFailureMock).toHaveBeenCalledWith(
        { sourceRole: 'dexie', operationRole: 'write' },
        {
          errorCode: 'file_invalid_type',
          filesystemEvidence: expect.objectContaining({
            causeCode: 'ENOTDIR',
            blockingNodeRole: 'unknown',
            observedNodeType: 'unavailable'
          })
        }
      )
    })

    it('never probes a Renderer-submitted path outside the fixed export nodes', async () => {
      const original = Object.assign(new Error('PRIVATE_ESCAPE'), { code: 'ENOTDIR' })
      fsMocks.mkdir.mockRejectedValueOnce(original)
      await invoke(MigrationIpcChannels.Start)

      await expect(
        invoke(MigrationIpcChannels.WriteExportFile, '/private/renderer-controlled', 'topics', 'PRIVATE_JSON')
      ).rejects.toBe(original)
      await invoke(MigrationIpcChannels.ReportError, {
        message: 'renderer received a rejected IPC invoke',
        report: { sourceRole: 'dexie', operationRole: 'write' }
      })

      expect(fsMocks.lstat).not.toHaveBeenCalled()
      expect(diagnosticsReportRendererExportFailureMock).toHaveBeenCalledWith(
        { sourceRole: 'dexie', operationRole: 'write' },
        {
          errorCode: 'file_invalid_type',
          filesystemEvidence: expect.objectContaining({
            blockingNodeRole: 'unknown',
            observedNodeType: 'unavailable'
          })
        }
      )
      expect(JSON.stringify(diagnosticsReportRendererExportFailureMock.mock.calls)).not.toContain(
        '/private/renderer-controlled'
      )
    })

    it('does not carry a Main write failure into a later renderer export generation', async () => {
      fsMocks.writeFile.mockRejectedValueOnce(Object.assign(new Error('PRIVATE_OLD_WRITE'), { code: 'ENOSPC' }))
      await invoke(MigrationIpcChannels.Start)
      await expect(
        invoke(MigrationIpcChannels.WriteExportFile, '/private/export', 'topics', 'PRIVATE_JSON')
      ).rejects.toThrow()
      await invoke(MigrationIpcChannels.Retry)
      await invoke(MigrationIpcChannels.Start)

      await invoke(MigrationIpcChannels.ReportError, {
        message: 'current failure',
        report: { sourceRole: 'redux', operationRole: 'parse' }
      })

      expect(diagnosticsReportRendererExportFailureMock).toHaveBeenLastCalledWith(
        { sourceRole: 'redux', operationRole: 'parse' },
        undefined
      )
    })

    it('deactivates renderer export immediately when StartMigration accepts the handoff', async () => {
      await invoke(MigrationIpcChannels.Start)
      await invoke(MigrationIpcChannels.StartMigration, { reduxData: {}, dexieExportPath: '/dexie' })

      await expect(invoke(MigrationIpcChannels.ReportError, 'late renderer failure')).resolves.toBe(false)

      expect(diagnosticsReportRendererExportFailureMock).not.toHaveBeenCalled()
      expect(lastProgress().stage).toBe('completed')
    })

    it('clears the renderer export phase on Retry', async () => {
      await invoke(MigrationIpcChannels.Start)
      await invoke(MigrationIpcChannels.Retry)

      await expect(invoke(MigrationIpcChannels.ReportError, 'late renderer failure')).resolves.toBe(false)
      expect(diagnosticsReportRendererExportFailureMock).not.toHaveBeenCalled()
    })

    it('does not publish a reporting generation that Retry invalidated while its capability was pending', async () => {
      let resolveReport!: () => void
      diagnosticsReportRendererExportFailureMock.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveReport = resolve
          })
      )
      await invoke(MigrationIpcChannels.Start)
      const report = invoke(MigrationIpcChannels.ReportError, 'obsolete failure')
      await vi.waitFor(() => expect(diagnosticsReportRendererExportFailureMock).toHaveBeenCalledTimes(1))

      await invoke(MigrationIpcChannels.Retry)
      resolveReport()

      await expect(report).resolves.toBe(false)
      expect(lastProgress()).toMatchObject({ stage: 'introduction', currentMessage: 'Ready to retry migration' })
    })

    it('clears the renderer export phase on reset and handler replacement', async () => {
      await invoke(MigrationIpcChannels.Start)
      resetMigrationData()
      unregisterMigrationIpcHandlers()
      registerMigrationIpcHandlers(migrationIpcPaths, {
        start: diagnosticsStartMock,
        reportRendererExportFailure: diagnosticsReportRendererExportFailureMock,
        saveDiagnosticBundle: diagnosticsSaveBundleMock,
        completeVersionGate: diagnosticsCompleteVersionGateMock
      })
      handlers = new Map(vi.mocked(ipcMain.handle).mock.calls.map(([channel, fn]) => [channel, fn as Handler]))

      await expect(invoke(MigrationIpcChannels.ReportError, 'obsolete renderer failure')).resolves.toBe(false)
      expect(diagnosticsReportRendererExportFailureMock).not.toHaveBeenCalled()
    })

    it('accepts Start only in the introduction stage and allows it again after Retry', async () => {
      await expect(invoke(MigrationIpcChannels.Start)).resolves.toBe(true)
      await expect(invoke(MigrationIpcChannels.ReportError, 'export failed')).resolves.toBe(true)
      await expect(invoke(MigrationIpcChannels.Start)).resolves.toBe(false)

      await invoke(MigrationIpcChannels.Retry)
      await expect(invoke(MigrationIpcChannels.Start)).resolves.toBe(true)

      expect(diagnosticsStartMock).toHaveBeenCalledTimes(2)
    })

    it('rejects a new Start while the engine owns the active attempt', async () => {
      let resolveRun!: (result: MigrationResult) => void
      engineMock.run.mockImplementation(() => new Promise<MigrationResult>((resolve) => (resolveRun = resolve)))
      await invoke(MigrationIpcChannels.Start)
      const migration = invoke(MigrationIpcChannels.StartMigration, { reduxData: {}, dexieExportPath: '/dexie' })
      await vi.waitFor(() => expect(engineMock.run).toHaveBeenCalledTimes(1))

      await expect(invoke(MigrationIpcChannels.Start)).resolves.toBe(false)
      expect(diagnosticsStartMock).toHaveBeenCalledTimes(1)

      resolveRun({ success: true, totalDuration: 1, migratorResults: [] })
      await migration
    })

    it('keeps Retry and renderer export failure inert until the active engine attempt reaches its terminal outcome', async () => {
      let resolveRun!: (result: MigrationResult) => void
      engineMock.run.mockImplementation(() => new Promise<MigrationResult>((resolve) => (resolveRun = resolve)))
      await expect(invoke(MigrationIpcChannels.Start)).resolves.toBe(true)
      const migration = invoke(MigrationIpcChannels.StartMigration, { reduxData: {}, dexieExportPath: '/dexie' })
      await vi.waitFor(() => expect(engineMock.run).toHaveBeenCalledTimes(1))
      expect(lastProgress().stage).toBe('migration')
      const progressCount = progressBroadcasts().length

      const retryResult = await invoke(MigrationIpcChannels.Retry)
      const progressAfterRetry = lastProgress()
      const progressCountAfterRetry = progressBroadcasts().length
      const secondStartResult = await invoke(MigrationIpcChannels.Start)
      await expect(
        invoke(MigrationIpcChannels.StartMigration, { reduxData: {}, dexieExportPath: '/second-dexie' })
      ).rejects.toThrow('Migration is already in progress.')
      const reportErrorResult = await invoke(MigrationIpcChannels.ReportError, 'obsolete renderer failure')

      resolveRun({ success: true, totalDuration: 1, migratorResults: [] })
      await migration

      expect(retryResult).toBe(false)
      expect(progressCountAfterRetry).toBe(progressCount)
      expect(progressAfterRetry.stage).toBe('migration')
      expect(secondStartResult).toBe(false)
      expect(diagnosticsStartMock).toHaveBeenCalledTimes(1)
      expect(reportErrorResult).toBe(false)
      expect(diagnosticsReportRendererExportFailureMock).not.toHaveBeenCalled()
      expect(lastProgress()).toMatchObject({ stage: 'completed', overallProgress: 100 })
    })

    it('does not activate renderer export from the version-incompatible stage', async () => {
      resetMigrationData()
      setVersionIncompatible('v1_too_old', { previousVersion: '1.0.0', requiredVersion: '1.9.12' })

      await expect(invoke(MigrationIpcChannels.Start)).resolves.toBe(false)
      expect(diagnosticsStartMock).not.toHaveBeenCalled()
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

    await invoke(MigrationIpcChannels.Start)
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
    await invoke(MigrationIpcChannels.Start)
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

    await invoke(MigrationIpcChannels.Start)
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

    await invoke(MigrationIpcChannels.Start)
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

    await invoke(MigrationIpcChannels.Start)
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

      await invoke(MigrationIpcChannels.Start)
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

      await invoke(MigrationIpcChannels.Start)
      await expect(
        invoke(MigrationIpcChannels.StartMigration, { reduxData: {}, dexieExportPath: '/dexie' })
      ).rejects.toThrow('Engine exploded')

      const failure = lastProgress()
      expect(failure.stage).toBe('error')
      expect(failure.error).toBe('Engine exploded')
      expect(windowSetStageMock).toHaveBeenCalledWith('error')

      engineMock.run.mockResolvedValueOnce({ success: true, totalDuration: 1, migratorResults: [] })
      await invoke(MigrationIpcChannels.Retry)
      await invoke(MigrationIpcChannels.Start)
      const retry = await invoke(MigrationIpcChannels.StartMigration, { reduxData: {}, dexieExportPath: '/dexie' })

      expect(retry).toMatchObject({ success: true })
      expect(lastProgress().stage).toBe('completed')
    })

    it('transitions main to the terminal error stage when the renderer reports a pre-handoff failure', async () => {
      await invoke(MigrationIpcChannels.Start)
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

    it('clears the force-quit requester and write waiter on unregister', () => {
      windowSetQuitRequesterMock.mockClear()
      windowSetWriteWaiterMock.mockClear()
      unregisterMigrationIpcHandlers()
      expect(windowSetQuitRequesterMock).toHaveBeenCalledWith(null)
      expect(windowSetWriteWaiterMock).toHaveBeenCalledWith(null)
    })

    it('can remove IPC handlers while preserving native write deferral', () => {
      windowSetQuitRequesterMock.mockClear()
      windowSetWriteWaiterMock.mockClear()

      unregisterMigrationIpcHandlers({ preserveWriteDeferral: true })

      expect(ipcMain.removeHandler).toHaveBeenCalledWith(MigrationIpcChannels.Start)
      expect(windowSetQuitRequesterMock).not.toHaveBeenCalled()
      expect(windowSetWriteWaiterMock).not.toHaveBeenCalled()
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

    it('completes version-gate diagnostics before the version guidance Cancel exits', async () => {
      setVersionIncompatible('v1_too_old', { previousVersion: '1.0.0', requiredVersion: '1.9.12' })

      await invoke(MigrationIpcChannels.Cancel)

      expect(diagnosticsCompleteVersionGateMock).toHaveBeenCalledTimes(1)
      expect(diagnosticsCompleteVersionGateMock.mock.invocationCallOrder[0]).toBeLessThan(
        electronMocks.app.quit.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
      )
    })

    it('completes version-gate diagnostics before a confirmed native close', async () => {
      setVersionIncompatible('v1_too_old', { previousVersion: '1.0.0', requiredVersion: '1.9.12' })

      await invoke(MigrationIpcChannels.ConfirmQuit)

      expect(diagnosticsCompleteVersionGateMock).toHaveBeenCalledTimes(1)
      expect(diagnosticsCompleteVersionGateMock.mock.invocationCallOrder[0]).toBeLessThan(
        windowConfirmQuitMock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
      )
    })

    it('cleans version-gate diagnostics after successfully choosing the default-data path', async () => {
      setVersionIncompatible('v1_too_old', { previousVersion: '1.0.0', requiredVersion: '1.9.12' })

      await invoke(MigrationIpcChannels.SkipMigration)

      expect(engineMock.skipMigration).toHaveBeenCalledTimes(1)
      expect(diagnosticsCompleteVersionGateMock).toHaveBeenCalledTimes(1)
      expect(diagnosticsCompleteVersionGateMock.mock.invocationCallOrder[0]).toBeLessThan(
        windowRestartAppMock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
      )
    })

    it('keeps diagnostics active when Cancel exits from a migration stage', async () => {
      await invoke(MigrationIpcChannels.Cancel)

      expect(diagnosticsCompleteVersionGateMock).not.toHaveBeenCalled()
    })

    it('pushes the live stage to the window manager on progress updates', async () => {
      await invoke(MigrationIpcChannels.Start)
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

      await invoke(MigrationIpcChannels.Start)
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

      await invoke(MigrationIpcChannels.Start)
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

      await invoke(MigrationIpcChannels.Start)
      const migrationFlow = invoke(MigrationIpcChannels.StartMigration, { reduxData: {}, dexieExportPath: '/dexie' })
      await Promise.resolve()

      expect(requestQuit()).toBe(false)
      expect(windowConfirmQuitMock).not.toHaveBeenCalled()

      resolveRun({ success: true, totalDuration: 1, migratorResults: [] })
      await migrationFlow
      await tick()

      expect(windowConfirmQuitMock).toHaveBeenCalledTimes(1)
    })

    it('defers quit and the native write waiter for the entire pending diagnostic dialog', async () => {
      let resolveDialog!: (result: { canceled: true; filePath: undefined }) => void
      vi.mocked(dialog.showSaveDialog).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveDialog = resolve as typeof resolveDialog
          }) as never
      )
      const save = invoke(MigrationIpcChannels.SaveDiagnosticBundle)
      await vi.waitFor(() => expect(dialog.showSaveDialog).toHaveBeenCalledTimes(1))

      const requestQuit = windowSetQuitRequesterMock.mock.calls.at(-1)?.[0] as () => boolean
      const waitForWrites = windowSetWriteWaiterMock.mock.calls.at(-1)?.[0] as () => Promise<void>
      expect(requestQuit()).toBe(false)
      let waiterSettled = false
      const waiting = waitForWrites().then(() => {
        waiterSettled = true
      })
      await Promise.resolve()

      expect(waiterSettled).toBe(false)
      expect(windowConfirmQuitMock).not.toHaveBeenCalled()

      resolveDialog({ canceled: true, filePath: undefined })
      await Promise.all([save, waiting])
      await tick()

      expect(waiterSettled).toBe(true)
      expect(windowConfirmQuitMock).toHaveBeenCalledTimes(1)
    })

    it('defers quit for a native diagnostic save transaction from before its operation starts', async () => {
      let resolveSave!: (result: { status: 'saved' }) => void
      let operationStarted = false
      const nativeSave = runMigrationDiagnosticSaveTransaction(() => {
        operationStarted = true
        return new Promise<{ status: 'saved' }>((resolve) => {
          resolveSave = resolve
        })
      })
      const requestQuit = windowSetQuitRequesterMock.mock.calls.at(-1)?.[0] as () => boolean

      expect(operationStarted).toBe(false)
      expect(requestQuit()).toBe(false)
      expect(windowConfirmQuitMock).not.toHaveBeenCalled()

      await Promise.resolve()
      expect(operationStarted).toBe(true)
      resolveSave({ status: 'saved' })
      await expect(nativeSave).resolves.toEqual({ status: 'saved' })
      await tick()

      expect(windowConfirmQuitMock).toHaveBeenCalledTimes(1)
    })

    it('keeps one scheduled quit across reset while an old diagnostic save is pending', async () => {
      let resolveSave!: (result: { status: 'saved' }) => void
      diagnosticsSaveBundleMock.mockImplementationOnce(
        () => new Promise<{ status: 'saved' }>((resolve) => (resolveSave = resolve))
      )
      const save = invoke(MigrationIpcChannels.SaveDiagnosticBundle)
      await vi.waitFor(() => expect(diagnosticsSaveBundleMock).toHaveBeenCalledTimes(1))
      const requestQuit = windowSetQuitRequesterMock.mock.calls.at(-1)?.[0] as () => boolean

      expect(requestQuit()).toBe(false)
      resetMigrationData()
      expect(requestQuit()).toBe(false)

      resolveSave({ status: 'saved' })
      await save
      await tick()

      expect(windowConfirmQuitMock).toHaveBeenCalledTimes(1)
    })
  })
})
