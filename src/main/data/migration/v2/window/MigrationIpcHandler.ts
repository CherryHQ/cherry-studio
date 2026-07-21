/**
 * IPC handler for migration communication between Main and Renderer
 */

import type { VersionBlockReason } from '@data/migration/v2/core/versionPolicy'
import { loggerService } from '@logger'
import { isSafeExternalUrl } from '@main/utils/externalUrlSafety'
import {
  migrationRendererExportFailurePayloadSchema,
  type MigrationRendererExportFailureReport
} from '@shared/data/migration/v2/diagnostics'
import {
  type MigrationDiagnosticSaveResult,
  MigrationIpcChannels,
  type MigrationProgress,
  type MigrationResult,
  type MigrationSummary,
  type StartMigrationPayload
} from '@shared/data/migration/v2/types'
import { app, clipboard, ipcMain, type IpcMainInvokeEvent, shell } from 'electron'
import fs from 'fs/promises'
import path from 'path'

import { migrationEngine } from '../core/MigrationEngine'
import { classifyMigrationError } from '../diagnostics'
import type { MigrationRendererExportMainWriteFailure } from '../migrationDiagnostics'
import {
  type MigrationDiagnosticNativeSaveResult,
  saveMigrationDiagnosticBundleWithDialog
} from './migrationDiagnosticDialogs'
import { createMigrationDiagnosticNativeI18n } from './migrationDiagnosticNativeI18n'
import { migrationWindowManager } from './MigrationWindowManager'

const logger = loggerService.withContext('MigrationIpcHandler')
const CONCURRENT_MIGRATION_ERROR = 'Migration is already in progress.'
const RENDERER_EXPORT_NOT_ACTIVE_ERROR = 'Renderer export is not active.'
const SUPPORT_EMAIL = 'support@cherry-ai.com'
type MigrationDiagnosticSaveInProgressResult = Extract<MigrationDiagnosticSaveResult, { status: 'failed' }> & {
  code: 'save_in_progress'
}
const DIAGNOSTIC_SAVE_IN_PROGRESS_RESULT: MigrationDiagnosticSaveInProgressResult = Object.freeze({
  status: 'failed',
  code: 'save_in_progress'
})
const UNKNOWN_RENDERER_EXPORT_REPORT: MigrationRendererExportFailureReport = Object.freeze({
  sourceRole: 'unknown',
  operationRole: 'unknown'
})
type RendererExportFilesystemEvidence = Extract<
  MigrationRendererExportMainWriteFailure,
  { errorCode: 'file_invalid_type' }
>['filesystemEvidence']
interface ControlledRendererExportPaths {
  readonly migrationTempRoot: string
  readonly dexieExportDirectory: string
  readonly localStorageExportDirectory: string
}

interface DiagnosticRegistrationState {
  epoch: number
  lastSavedBundlePath: string | null
  versionGateCompleted: boolean
  rendererExportGeneration: number
  rendererExportPhase: {
    generation: number
    status: 'exporting' | 'reporting_failure'
    mainWriteFailure?: MigrationRendererExportMainWriteFailure
  } | null
}

let inFlightMigration: Promise<MigrationResult> | null = null
// Covers the complete user-visible save transaction: native dialog, bundle build, and path
// publication. It intentionally outlives handler registrations so two windows cannot overlap.
let diagnosticSaveInFlight: Promise<unknown> | null = null
// Set once a deferred quit has been registered, so repeated confirmations while a migration
// write is in flight don't stack a second allSettled().then(confirmQuit).
let quitScheduled = false
let activeDiagnosticRegistration: DiagnosticRegistrationState | null = null

export interface MigrationIpcDiagnosticCapabilities {
  start(): void | Promise<void>
  reportRendererExportFailure(
    report: MigrationRendererExportFailureReport,
    mainWriteFailure?: MigrationRendererExportMainWriteFailure
  ): void | Promise<void>
  saveDiagnosticBundle(destination: string): Promise<MigrationDiagnosticNativeSaveResult>
  completeVersionGate(): void
}

// Current migration progress
let currentProgress: MigrationProgress = {
  stage: 'introduction',
  overallProgress: 0,
  currentMessage: 'Ready to start data migration',
  migrators: []
}

// Recovered non-default data directory to surface on the introduction screen.
// Held separately from currentProgress so it survives Retry (which rebuilds the
// introduction progress from scratch) instead of vanishing after a failed run.
let dataLocationNotice: string | null = null

/**
 * Register all migration IPC handlers
 */
export function registerMigrationIpcHandlers(
  userDataPath: string,
  diagnosticCapabilities: MigrationIpcDiagnosticCapabilities
): void {
  logger.info('Registering migration IPC handlers')
  invalidateActiveDiagnosticRegistration()
  const diagnosticRegistration: DiagnosticRegistrationState = {
    epoch: 0,
    lastSavedBundlePath: null,
    versionGateCompleted: false,
    rendererExportGeneration: 0,
    rendererExportPhase: null
  }
  const migrationTempRoot = path.join(userDataPath, 'migration_temp')
  const controlledExportPaths: ControlledRendererExportPaths = Object.freeze({
    migrationTempRoot,
    dexieExportDirectory: path.join(migrationTempRoot, 'dexie_export'),
    localStorageExportDirectory: path.join(migrationTempRoot, 'localstorage_export')
  })
  activeDiagnosticRegistration = diagnosticRegistration
  const requestRegisteredQuit = (): boolean => requestQuit(diagnosticRegistration, diagnosticCapabilities)

  // Wire repeated-close quit deferral and native crash/hang waiting to the same in-flight write.
  migrationWindowManager.setQuitRequester(requestRegisteredQuit)
  migrationWindowManager.setWriteWaiter(waitForInFlightWrites)

  ipcMain.handle(MigrationIpcChannels.Start, async (event) => {
    assertMigrationSender(event)
    if (
      activeDiagnosticRegistration !== diagnosticRegistration ||
      inFlightMigration !== null ||
      currentProgress.stage !== 'introduction' ||
      diagnosticRegistration.rendererExportPhase !== null
    ) {
      return false
    }

    const generation = diagnosticRegistration.rendererExportGeneration + 1
    diagnosticRegistration.rendererExportGeneration = generation
    diagnosticRegistration.rendererExportPhase = { generation, status: 'exporting' }
    try {
      await diagnosticCapabilities.start()
    } catch (error) {
      if (diagnosticRegistration.rendererExportPhase?.generation === generation) {
        clearRendererExportPhase(diagnosticRegistration)
      }
      throw error
    }
    return true
  })

  ipcMain.handle(MigrationIpcChannels.SaveDiagnosticBundle, async (event) => {
    assertMigrationSender(event)
    const saveEpoch = diagnosticRegistration.epoch
    return runMigrationDiagnosticSaveTransaction(async (): Promise<MigrationDiagnosticSaveResult> => {
      const outcome = await saveMigrationDiagnosticBundleWithDialog(
        app.getLocale(),
        diagnosticCapabilities.saveDiagnosticBundle
      )
      if (
        outcome.result.status === 'saved' &&
        outcome.destination !== undefined &&
        activeDiagnosticRegistration === diagnosticRegistration &&
        diagnosticRegistration.epoch === saveEpoch
      ) {
        diagnosticRegistration.lastSavedBundlePath = outcome.destination
      }
      return outcome.result
    })
  })

  ipcMain.handle(MigrationIpcChannels.OpenDiagnosticEmail, async (event) => {
    assertMigrationSender(event)
    const i18n = await createMigrationDiagnosticNativeI18n(app.getLocale())
    const mailto = createSupportEmailUrl(i18n.t('support.emailSubject'), i18n.t('support.emailBody'))
    if (!isSafeExternalUrl(mailto)) {
      throw new Error('Could not create a safe support email URL.')
    }
    await shell.openExternal(mailto)
    return true
  })

  ipcMain.handle(MigrationIpcChannels.ShowDiagnosticBundleInFolder, (event) => {
    assertMigrationSender(event)
    if (
      activeDiagnosticRegistration !== diagnosticRegistration ||
      diagnosticRegistration.lastSavedBundlePath === null
    ) {
      throw new Error('No saved diagnostic bundle is available.')
    }
    shell.showItemInFolder(diagnosticRegistration.lastSavedBundlePath)
    return true
  })

  ipcMain.handle(MigrationIpcChannels.CopySupportEmail, (event) => {
    assertMigrationSender(event)
    clipboard.writeText(SUPPORT_EMAIL)
    return true
  })

  // Get user data path
  ipcMain.handle(MigrationIpcChannels.GetUserDataPath, () => {
    return userDataPath
  })

  // Check if migration is needed
  ipcMain.handle(MigrationIpcChannels.CheckNeeded, async () => {
    try {
      return await migrationEngine.needsMigration()
    } catch (error) {
      logger.error('Error checking migration needed', error as Error)
      throw error
    }
  })

  // Get current progress
  ipcMain.handle(MigrationIpcChannels.GetProgress, () => {
    return currentProgress
  })

  // Get last error
  ipcMain.handle(MigrationIpcChannels.GetLastError, async () => {
    try {
      return migrationEngine.getLastError()
    } catch (error) {
      logger.error('Error getting last error', error as Error)
      throw error
    }
  })

  // Write export file from Renderer
  ipcMain.handle(
    MigrationIpcChannels.WriteExportFile,
    async (event, exportPath: string, tableName: string, jsonData: string) => {
      assertMigrationSender(event)
      assertRendererExportActive(diagnosticRegistration)
      const rememberFailure = async (error: unknown, filesystemOperation: 'mkdir' | 'write'): Promise<void> => {
        const phase = diagnosticRegistration.rendererExportPhase
        if (
          activeDiagnosticRegistration !== diagnosticRegistration ||
          phase === null ||
          phase.status !== 'exporting' ||
          phase.mainWriteFailure !== undefined
        ) {
          return
        }
        const mainWriteFailure = await classifyMainExportWriteFailure(
          error,
          filesystemOperation,
          exportPath,
          tableName,
          controlledExportPaths
        )
        if (
          activeDiagnosticRegistration === diagnosticRegistration &&
          diagnosticRegistration.rendererExportPhase === phase &&
          phase.status === 'exporting'
        ) {
          phase.mainWriteFailure = mainWriteFailure
        }
      }

      try {
        // Ensure export directory exists
        await fs.mkdir(exportPath, { recursive: true })
      } catch (error) {
        await rememberFailure(error, 'mkdir')
        logger.error('Error creating export directory', error as Error)
        throw error
      }

      try {
        // Write table data to file
        const filePath = path.join(exportPath, `${tableName}.json`)
        await fs.writeFile(filePath, jsonData, 'utf-8')

        logger.info('Export file written', { tableName, filePath })
        return true
      } catch (error) {
        await rememberFailure(error, 'write')
        logger.error('Error writing export file', error as Error)
        throw error
      }
    }
  )

  // Start the migration process
  ipcMain.handle(MigrationIpcChannels.StartMigration, async (event, payload: StartMigrationPayload) => {
    assertMigrationSender(event)
    if (inFlightMigration) {
      logger.warn(CONCURRENT_MIGRATION_ERROR)
      throw new Error(CONCURRENT_MIGRATION_ERROR)
    }
    assertRendererExportActive(diagnosticRegistration)

    let runPromise: Promise<MigrationResult> | null = null

    try {
      const { reduxData, dexieExportPath, localStorageExportPath } = payload

      if (!reduxData || !dexieExportPath) {
        throw new Error('Migration data not ready. Redux data or Dexie export path missing.')
      }

      // Main owns the attempt from this point. A later renderer ReportError belongs to an
      // obsolete export phase and must not finish or overwrite the engine-owned attempt.
      clearRendererExportPhase(diagnosticRegistration)

      // Set up progress callback
      migrationEngine.onProgress((progress) => {
        updateProgress(progress)
      })

      // Flip to the protected `migration` stage before running the engine. run() synchronously
      // clears all v2 tables (verifyAndClearNewTables) before emitting its first progress tick, so
      // without this the destructive clear would execute while still on the unprotected
      // `introduction` stage — a window close there would quit immediately, bypassing the
      // ConfirmQuit write-deferral. The engine's first tick overwrites this shortly after.
      updateProgress({
        stage: 'migration',
        overallProgress: 0,
        currentMessage: 'Starting migration…',
        migrators: []
      })

      // Run migration
      runPromise = migrationEngine.run(reduxData, dexieExportPath, localStorageExportPath)
      inFlightMigration = runPromise

      const result = await runPromise

      if (result.success) {
        updateProgress({
          stage: 'completed',
          overallProgress: 100,
          currentMessage: 'Migration completed successfully!',
          migrators: currentProgress.migrators.map((m) => ({
            ...m,
            status: 'completed'
          })),
          warnings: result.migratorResults.flatMap((migratorResult) => migratorResult.warnings ?? []),
          summary: createMigrationSummary(result, currentProgress)
        })
      } else {
        updateProgress({
          stage: 'error',
          overallProgress: currentProgress.overallProgress,
          currentMessage: result.error || 'Migration failed',
          migrators: currentProgress.migrators,
          error: result.error
        })
      }

      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Error starting migration', error as Error)

      if (errorMessage === CONCURRENT_MIGRATION_ERROR) {
        throw error
      }

      updateProgress({
        stage: 'error',
        overallProgress: currentProgress.overallProgress,
        currentMessage: errorMessage,
        migrators: currentProgress.migrators,
        error: errorMessage
      })

      throw error
    } finally {
      if (runPromise && inFlightMigration === runPromise) {
        inFlightMigration = null
      }
    }
  })

  // Mirror renderer-local failures into main so close handling sees the terminal error stage.
  ipcMain.handle(MigrationIpcChannels.ReportError, async (event, payload: unknown) => {
    assertMigrationSender(event)
    const phase = diagnosticRegistration.rendererExportPhase
    if (activeDiagnosticRegistration !== diagnosticRegistration || phase === null || phase.status !== 'exporting') {
      return false
    }

    const parsed = migrationRendererExportFailurePayloadSchema.safeParse(payload)
    const message = parsed.success ? parsed.data.message : rendererExportUiMessage(payload)
    const report = parsed.success ? parsed.data.report : UNKNOWN_RENDERER_EXPORT_REPORT
    diagnosticRegistration.rendererExportPhase = {
      generation: phase.generation,
      status: 'reporting_failure',
      ...(phase.mainWriteFailure === undefined ? {} : { mainWriteFailure: phase.mainWriteFailure })
    }
    await diagnosticCapabilities.reportRendererExportFailure(report, phase.mainWriteFailure)
    if (
      activeDiagnosticRegistration !== diagnosticRegistration ||
      diagnosticRegistration.rendererExportPhase?.generation !== phase.generation ||
      diagnosticRegistration.rendererExportPhase.status !== 'reporting_failure'
    ) {
      return false
    }
    clearRendererExportPhase(diagnosticRegistration)
    updateProgress({
      stage: 'error',
      overallProgress: currentProgress.overallProgress,
      currentMessage: message,
      migrators: currentProgress.migrators,
      error: message
    })
    return true
  })

  // Retry migration
  ipcMain.handle(MigrationIpcChannels.Retry, async (event) => {
    assertMigrationSender(event)
    if (inFlightMigration !== null) return false

    try {
      clearRendererExportPhase(diagnosticRegistration)
      // Reset to the introduction stage so the user can re-trigger migration from its Start button.
      // Carry the data-location notice back so it doesn't disappear after a failed export.
      updateProgress({
        stage: 'introduction',
        overallProgress: 0,
        currentMessage: 'Ready to retry migration',
        migrators: [],
        ...(dataLocationNotice ? { dataLocation: dataLocationNotice } : {})
      })
      return true
    } catch (error) {
      logger.error('Error retrying migration', error as Error)
      throw error
    }
  })

  // Cancel migration
  ipcMain.handle(MigrationIpcChannels.Cancel, async () => {
    try {
      logger.info('Migration cancelled by user')
      completeVersionGateDiagnostics(diagnosticRegistration, diagnosticCapabilities)
      migrationWindowManager.close()
      app.quit()
      return true
    } catch (error) {
      logger.error('Error cancelling migration', error as Error)
      throw error
    }
  })

  // Skip migration (version incompatible — user chose to use defaults)
  ipcMain.handle(MigrationIpcChannels.SkipMigration, async () => {
    try {
      logger.info('User chose to skip migration and use defaults')
      await migrationEngine.skipMigration()
      completeVersionGateDiagnostics(diagnosticRegistration, diagnosticCapabilities)
      migrationEngine.close()
      void migrationWindowManager.restartApp()
      return true
    } catch (error) {
      logger.error('Error skipping migration', error as Error)
      throw error
    }
  })

  // Restart app
  ipcMain.handle(MigrationIpcChannels.Restart, async () => {
    try {
      logger.info('Restarting app after migration')
      void migrationWindowManager.restartApp()
      return true
    } catch (error) {
      logger.error('Error restarting app', error as Error)
      throw error
    }
  })

  // Minimize the migration window (custom control on Windows/Linux)
  ipcMain.handle(MigrationIpcChannels.Minimize, () => {
    migrationWindowManager.minimize()
    return true
  })

  // Request a user-initiated close (custom control on Windows/Linux). Routes through the
  // native close event so the in-flow confirmation applies.
  ipcMain.handle(MigrationIpcChannels.CloseWindow, () => {
    migrationWindowManager.requestClose()
    return true
  })

  // User confirmed quit from the renderer's in-flow close dialog. Returns true when quitting
  // immediately, false when deferred (an active write must settle first) — the renderer uses this
  // to show the "app will close when the current step finishes" notice.
  ipcMain.handle(MigrationIpcChannels.ConfirmQuit, requestRegisteredQuit)

  // Renderer dismissed the in-flow close dialog without quitting (Continue / Esc / backdrop).
  // Drop the pending-close flag so the next close re-prompts instead of force-quitting.
  ipcMain.handle(MigrationIpcChannels.CancelClose, () => {
    migrationWindowManager.clearCloseConfirm()
    return true
  })
}

/**
 * Unregister all migration IPC handlers
 */
export function unregisterMigrationIpcHandlers(options: { readonly preserveWriteDeferral?: boolean } = {}): void {
  logger.info('Unregistering migration IPC handlers')

  const channels = Object.values(MigrationIpcChannels)
  for (const channel of channels) {
    ipcMain.removeHandler(channel)
  }

  if (!options.preserveWriteDeferral) {
    migrationWindowManager.setQuitRequester(null)
    migrationWindowManager.setWriteWaiter(null)
  }
  invalidateActiveDiagnosticRegistration()
  activeDiagnosticRegistration = null
}

export async function runMigrationDiagnosticSaveTransaction<T>(
  operation: () => Promise<T>
): Promise<T | MigrationDiagnosticSaveInProgressResult> {
  if (diagnosticSaveInFlight !== null) {
    return DIAGNOSTIC_SAVE_IN_PROGRESS_RESULT
  }

  // Install the guard before beginning the operation so a synchronous close or second save
  // cannot slip between the transaction request and the native destination dialog.
  const savePromise = Promise.resolve().then(operation)
  diagnosticSaveInFlight = savePromise
  try {
    return await savePromise
  } finally {
    if (diagnosticSaveInFlight === savePromise) {
      diagnosticSaveInFlight = null
    }
  }
}

async function classifyMainExportWriteFailure(
  error: unknown,
  filesystemOperation: 'mkdir' | 'write',
  exportPath: string,
  tableName: string,
  controlledPaths: ControlledRendererExportPaths
): Promise<MigrationRendererExportMainWriteFailure> {
  const { errorCode } = classifyMigrationError(error)
  switch (errorCode) {
    case 'file_invalid_type': {
      const causeCode = findFilesystemTypeCauseCode(error)
      if (causeCode === null) return { errorCode: 'unknown_error' }

      const targetRole = tableName === 'localStorage' ? 'local_storage_export_file' : 'dexie_export_directory'
      const isControlledExportPath =
        path.normalize(exportPath) ===
        path.normalize(
          targetRole === 'local_storage_export_file'
            ? controlledPaths.localStorageExportDirectory
            : controlledPaths.dexieExportDirectory
        )
      const blocker = isControlledExportPath
        ? await probeControlledFilesystemBlocker(controlledPaths, targetRole)
        : { blockingNodeRole: 'unknown' as const, observedNodeType: 'unavailable' as const }
      return {
        errorCode,
        filesystemEvidence: {
          causeCode,
          filesystemOperation,
          targetRole,
          ...blocker,
          expectedNodeType: targetRole === 'dexie_export_directory' ? 'directory' : 'file'
        }
      }
    }
    case 'file_missing':
    case 'file_permission':
    case 'file_readonly':
    case 'file_io':
      return { errorCode }
    default:
      return { errorCode: 'unknown_error' }
  }
}

async function probeControlledFilesystemBlocker(
  paths: ControlledRendererExportPaths,
  targetRole: RendererExportFilesystemEvidence['targetRole']
): Promise<Pick<RendererExportFilesystemEvidence, 'blockingNodeRole' | 'observedNodeType'>> {
  try {
    const migrationTempType = nodeType(await fs.lstat(paths.migrationTempRoot))
    if (migrationTempType !== 'directory') {
      return { blockingNodeRole: 'migration_temp_root', observedNodeType: migrationTempType }
    }
    if (targetRole !== 'dexie_export_directory') {
      return { blockingNodeRole: 'unknown', observedNodeType: 'unavailable' }
    }

    const dexieExportType = nodeType(await fs.lstat(paths.dexieExportDirectory))
    return dexieExportType === 'directory'
      ? { blockingNodeRole: 'unknown', observedNodeType: 'unavailable' }
      : { blockingNodeRole: 'dexie_export_directory', observedNodeType: dexieExportType }
  } catch {
    return { blockingNodeRole: 'unknown', observedNodeType: 'unavailable' }
  }
}

function nodeType(stats: Awaited<ReturnType<typeof fs.lstat>>): RendererExportFilesystemEvidence['observedNodeType'] {
  if (stats.isFile()) return 'file'
  if (stats.isDirectory()) return 'directory'
  return 'other'
}

function findFilesystemTypeCauseCode(error: unknown): 'ENOTDIR' | 'EEXIST' | null {
  let current = error
  const visited = new WeakSet<object>()
  for (let causeDepth = 0; causeDepth <= 4; causeDepth++) {
    if (((typeof current !== 'object' || current === null) && typeof current !== 'function') || visited.has(current)) {
      return null
    }
    visited.add(current)
    try {
      const codeDescriptor = Object.getOwnPropertyDescriptor(current, 'code')
      const code = codeDescriptor && 'value' in codeDescriptor ? codeDescriptor.value : undefined
      if (code === 'ENOTDIR' || code === 'EEXIST') return code
      const causeDescriptor = Object.getOwnPropertyDescriptor(current, 'cause')
      current = causeDescriptor && 'value' in causeDescriptor ? causeDescriptor.value : undefined
    } catch {
      return null
    }
  }
  return null
}

function rendererExportUiMessage(payload: unknown): string {
  if (typeof payload === 'string' && payload.length > 0 && payload.length <= 4_096) return payload
  if (typeof payload !== 'object' || payload === null) return 'Migration data export failed'

  try {
    const descriptor = Object.getOwnPropertyDescriptor(payload, 'message')
    const message = descriptor && 'value' in descriptor ? descriptor.value : undefined
    return typeof message === 'string' && message.length > 0 && message.length <= 4_096
      ? message
      : 'Migration data export failed'
  } catch {
    return 'Migration data export failed'
  }
}

function invalidateActiveDiagnosticRegistration(): void {
  if (activeDiagnosticRegistration === null) return
  activeDiagnosticRegistration.epoch += 1
  activeDiagnosticRegistration.lastSavedBundlePath = null
  clearRendererExportPhase(activeDiagnosticRegistration)
}

function clearRendererExportPhase(registration: DiagnosticRegistrationState): void {
  registration.rendererExportPhase = null
}

function assertMigrationSender(event: IpcMainInvokeEvent): void {
  const migrationWebContents = migrationWindowManager.getWindow()?.webContents
  if (
    migrationWebContents === undefined ||
    event.sender !== migrationWebContents ||
    event.senderFrame !== migrationWebContents.mainFrame
  ) {
    throw new Error('Migration IPC is restricted to the migration window.')
  }
}

function assertRendererExportActive(registration: DiagnosticRegistrationState): void {
  if (
    activeDiagnosticRegistration !== registration ||
    currentProgress.stage !== 'introduction' ||
    registration.rendererExportPhase?.status !== 'exporting'
  ) {
    throw new Error(RENDERER_EXPORT_NOT_ACTIVE_ERROR)
  }
}

function createSupportEmailUrl(subject: string, body: string): string {
  const url = new URL(`mailto:${SUPPORT_EMAIL}`)
  url.search = new URLSearchParams({
    subject,
    body
  }).toString()
  return url.toString()
}

/**
 * Update progress and broadcast to window.
 */
function updateProgress(progress: MigrationProgress): void {
  currentProgress = progress
  migrationWindowManager.setStage(progress.stage)
  migrationWindowManager.send(MigrationIpcChannels.Progress, progress)
}

/**
 * Request an app quit. If a migration write is still in flight, defer the quit until it settles so
 * we never terminate mid-write (which would leave a half-applied migration). Returns true when
 * quitting immediately, false when deferred.
 *
 * Shared by the ConfirmQuit IPC handler (renderer's in-flow dialog) and the window manager's
 * force-quit escape hatch (crash / hang / repeated close), so every quit path inherits the same
 * write-safety. The `quitScheduled` guard dedups repeated triggers into a single deferred quit.
 */
function requestQuit(
  registration: DiagnosticRegistrationState,
  capabilities: MigrationIpcDiagnosticCapabilities
): boolean {
  const pending: Promise<unknown>[] = []
  if (inFlightMigration) pending.push(inFlightMigration)
  if (diagnosticSaveInFlight) pending.push(diagnosticSaveInFlight)

  const confirmQuit = (): void => {
    completeVersionGateDiagnostics(registration, capabilities)
    migrationWindowManager.confirmQuit()
  }

  if (pending.length === 0) {
    confirmQuit()
    return true
  }

  if (!quitScheduled) {
    quitScheduled = true
    logger.info('Quit requested during an active write; deferring until it settles')
    void Promise.allSettled(pending).then(() => {
      confirmQuit()
    })
  }
  return false
}

function completeVersionGateDiagnostics(
  registration: DiagnosticRegistrationState,
  capabilities: MigrationIpcDiagnosticCapabilities
): void {
  if (
    activeDiagnosticRegistration !== registration ||
    registration.versionGateCompleted ||
    currentProgress.stage !== 'version_incompatible'
  ) {
    return
  }
  registration.versionGateCompleted = true
  capabilities.completeVersionGate()
}

/**
 * Settle the migration write that was active when a native crash/hang flow began.
 * Rejections are deliberately settled, matching requestQuit(): the native flow
 * still needs to let the user save diagnostics and exit after a failed write.
 */
async function waitForInFlightWrites(): Promise<void> {
  const pending: Promise<unknown>[] = []
  if (inFlightMigration) pending.push(inFlightMigration)
  if (diagnosticSaveInFlight) pending.push(diagnosticSaveInFlight)
  if (pending.length > 0) {
    await Promise.allSettled(pending)
  }
}

/**
 * Seed completion-screen summary stats from the migration result + final progress.
 * The renderer owns the user-visible migration-stage duration and may replace
 * `durationMs` before rendering the completion screen.
 */
function createMigrationSummary(result: MigrationResult, progress: MigrationProgress): MigrationSummary {
  return {
    completedMigrators: result.migratorResults.length,
    totalMigrators: progress.migrators.length || result.migratorResults.length,
    itemsProcessed: result.migratorResults.reduce((sum, r) => sum + r.recordsProcessed, 0),
    durationMs: result.totalDuration
  }
}

/**
 * Reset cached data
 */
export function resetMigrationData(): void {
  // An active operation owns its promise until settlement. Clearing either guard here would let
  // reset/re-registration open a second dialog or schedule multiple deferred quits.
  if (inFlightMigration === null && diagnosticSaveInFlight === null) {
    quitScheduled = false
  }
  dataLocationNotice = null
  invalidateActiveDiagnosticRegistration()
  currentProgress = {
    stage: 'introduction',
    overallProgress: 0,
    currentMessage: 'Ready to start data migration',
    migrators: []
  }
}

/**
 * Set the initial progress to version_incompatible stage.
 * Must be called BEFORE registerMigrationIpcHandlers() so that the
 * renderer picks up this state via the GetProgress IPC on mount.
 */
export function setVersionIncompatible(reason: VersionBlockReason, details: Record<string, string>): void {
  currentProgress = {
    stage: 'version_incompatible',
    overallProgress: 0,
    currentMessage: `Version incompatible: ${reason}`,
    i18nMessage: { key: `migration.version_incompatible.${reason}`, params: details },
    migrators: []
  }
}

/**
 * Seed the recovered non-default data directory so the introduction screen can
 * show a "data migration directory" notice. Must be called BEFORE
 * registerMigrationIpcHandlers() so the renderer picks it up via GetProgress on
 * mount. Also retained across Retry (see the Retry handler).
 */
export function setDataLocationNotice(dataLocation: string): void {
  dataLocationNotice = dataLocation
  currentProgress = { ...currentProgress, dataLocation }
}
