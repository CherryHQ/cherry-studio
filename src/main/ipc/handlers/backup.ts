import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { t } from '@main/i18n'
import {
  ArchiveAdmissionError,
  BACKUP_FORMAT_VERSION,
  BackupBusyError,
  BackupCancelledError,
  BackupFormatCompatibilityError,
  BackupMigrationCompatibilityError,
  BackupQuiesceError,
  CeilingExceededError,
  DiskFullError,
  HardLinkUnsupportedError,
  InsufficientDiskSpaceError,
  NonRegularSourceError,
  OutputPathExistsError,
  presentDegradations,
  presentJournalDegradations,
  ResourceInstallPlanError,
  RestoreStateError,
  SourceDriftError,
  UnportableSourceError
} from '@main/services/backup'
import { backupErrorCodes } from '@shared/ipc/errors/backup'
import { IpcError, IpcErrorCode } from '@shared/ipc/errors/IpcError'
import {
  BackupDiagnosticPathSchema,
  type BackupExportSourceDiagnostic,
  BackupExportSourceDiagnosticSchema,
  BackupFormatCompatibilityDiagnosticSchema,
  BackupMigrationCompatibilityDiagnosticSchema,
  type backupRequestSchemas
} from '@shared/ipc/schemas/backup'
import type { IpcContext, IpcHandlersFor } from '@shared/ipc/types'
import { app, type BrowserWindow, dialog } from 'electron'

/**
 * Backup v2 request routes — sender policy, the file dialogs, error mapping, and
 * delegation to `BackupService`. No backup behaviour lives here.
 *
 * THE DIALOGS ARE MAIN'S, ON PURPOSE. A route that accepted a path would let any
 * renderer name a file to overwrite or a file to read; instead the user picks,
 * with filters this module fixes, and only the chosen path comes back out for
 * display.
 */

const logger = loggerService.withContext('IpcBackupHandlers')

const ARCHIVE_EXTENSION = 'cherrybackup'

/**
 * Every route here either replaces the database or releases the material that
 * could undo one, so the caller must be a window this app manages. `senderId` is
 * null for anything WindowManager does not track — a detached webContents, a
 * webview — and that is exactly what must not drive a restore.
 */
function requireManagedWindow({ senderId }: IpcContext): BrowserWindow {
  const window = senderId === null ? undefined : application.get('WindowManager').getWindow(senderId)
  if (!window) {
    throw new IpcError(backupErrorCodes.SENDER_NOT_ALLOWED, 'backup commands require a managed application window')
  }
  return window
}

/**
 * Map the backup pipeline's structural errors onto the closed code set the UI
 * branches on. Anything unmapped stays an unexpected fault (`INTERNAL`), which
 * is the honest answer for a fault we did not predict.
 */
function currentBuildType(): 'packaged' | 'development' {
  return app.isPackaged ? 'packaged' : 'development'
}

function migrationTipForIpc(tip: { readonly folderMillis: number; readonly hash: string }) {
  return {
    folderMillis: tip.folderMillis,
    hashPrefix: /^[0-9a-f]{12,}$/.test(tip.hash) ? tip.hash.slice(0, 12) : ('unavailable' as const)
  }
}

/**
 * What the renderer is told, per code. FIXED strings, chosen once here.
 *
 * Every underlying message this module used to forward was written for a main
 * log: they carry absolute paths, archive-controlled names, and free prose. The
 * renderer never renders them — it branches on `code` and looks up its own
 * translation — so forwarding them only published the user's directory layout
 * across the IPC boundary. The original error keeps its detail in the main log,
 * where it is diagnostic rather than exposure.
 */
const IPC_MESSAGE: Record<string, string> = {
  [backupErrorCodes.BUSY]: 'another backup operation is already running',
  [backupErrorCodes.ARCHIVE_REJECTED]: 'backup archive was rejected',
  [backupErrorCodes.RESTORE_REQUIRES_NEWER_APP]: 'the backup needs a newer version of this app',
  [backupErrorCodes.RESTORE_LINEAGE_INCOMPATIBLE]: 'the backup came from an incompatible app lineage',
  [backupErrorCodes.FORMAT_UNSUPPORTED]: 'the backup format is not supported by this app version',
  [backupErrorCodes.RESTORE_STATE]: 'the restore is not in a state that allows this action',
  [backupErrorCodes.JOURNAL_UNREADABLE]: 'the restore journal cannot be read',
  [backupErrorCodes.ARM_FAILED]: 'the app could not restart to carry out the restore',
  [backupErrorCodes.ROLLBACK_UNAVAILABLE]: 'this restore can no longer be rolled back',
  [backupErrorCodes.RECOVERY_INCOMPLETE]: 'the last restore has not finished putting files back',
  [backupErrorCodes.STORAGE_UNAVAILABLE]: 'there is not enough usable space to finish this operation',
  [backupErrorCodes.EXPORT_SOURCE]: 'a file this backup needed could not be read safely',
  [backupErrorCodes.EXPORT_DESTINATION]: 'the chosen destination cannot be written',
  [backupErrorCodes.RESTORE_RESOURCES]: 'the backup files cannot be installed on this device'
}

function ipcError(code: string, data?: unknown): IpcError {
  return new IpcError(code, IPC_MESSAGE[code], data)
}

function profileRelativePath(sourcePath: string): string | undefined {
  const userDataPath = path.resolve(application.getPath('app.userdata'))
  const relative = path.relative(userDataPath, path.resolve(sourcePath)).split(path.sep).join('/')
  const parsed = BackupDiagnosticPathSchema.safeParse(relative)
  return parsed.success ? parsed.data : undefined
}

function unportableDiagnosticPath(error: UnportableSourceError): string | undefined {
  if (!error.sourceRoot) return undefined
  const root = profileRelativePath(error.sourceRoot)
  if (!root) return undefined
  const parsed = BackupDiagnosticPathSchema.safeParse(`${root}/${error.relPath}`)
  return parsed.success ? parsed.data : undefined
}

function limitDiagnostic(kind: string): BackupExportSourceDiagnostic {
  const candidate = BackupExportSourceDiagnosticSchema.safeParse({
    kind: 'limit-exceeded',
    limit: kind
  })
  return candidate.success ? candidate.data : { kind: 'limit-exceeded', limit: 'unknown' }
}

function exportSourceIpcError(error: unknown): IpcError | undefined {
  let diagnostic: BackupExportSourceDiagnostic | undefined
  let message: string | undefined

  if (error instanceof SourceDriftError) {
    const sourcePath = profileRelativePath(error.sourcePath)
    diagnostic = {
      kind: 'source-changed',
      ...(sourcePath ? { path: sourcePath } : {})
    }
    message = 'backup source changed during export'
  } else if (error instanceof BackupQuiesceError) {
    const phase = /^[a-z0-9-]{1,64}$/.test(error.phase) ? error.phase : 'unknown'
    diagnostic = { kind: 'quiesce-timeout', phase }
    message = 'backup export could not reach a sealed profile view'
  } else if (error instanceof NonRegularSourceError) {
    const sourcePath = profileRelativePath(error.sourcePath)
    diagnostic = { kind: 'non-regular', ...(sourcePath ? { path: sourcePath } : {}) }
    message = 'backup source contains a symlink or special file'
  } else if (error instanceof UnportableSourceError) {
    const sourcePath = unportableDiagnosticPath(error)
    diagnostic = {
      kind: 'unportable-path',
      reason: error.reason,
      ...(sourcePath ? { path: sourcePath } : {})
    }
    message = 'backup source path is not portable'
  } else if (error instanceof CeilingExceededError) {
    diagnostic = limitDiagnostic(error.kind)
    message = 'backup source exceeds an export limit'
  }

  if (!diagnostic || !message) return undefined
  const validated = BackupExportSourceDiagnosticSchema.parse(diagnostic)
  logger.warn('Backup export source rejected', { diagnostic: validated, error })
  return ipcError(backupErrorCodes.EXPORT_SOURCE, validated)
}

function toIpcError(error: unknown): unknown {
  if (error instanceof BackupBusyError) {
    return ipcError(backupErrorCodes.BUSY, { running: error.running })
  }
  if (error instanceof BackupMigrationCompatibilityError) {
    const { diagnostic } = error
    const common = {
      archiveAppVersion: diagnostic.archiveAppVersion,
      archiveBuildType: diagnostic.archiveBuildType,
      currentAppVersion: app.getVersion(),
      currentBuildType: currentBuildType(),
      sourceMigrationCount: diagnostic.sourceMigrationCount,
      targetMigrationCount: diagnostic.targetMigrationCount,
      sourceTip: migrationTipForIpc(diagnostic.sourceTip),
      targetTip: migrationTipForIpc(diagnostic.targetTip)
    }
    const data = BackupMigrationCompatibilityDiagnosticSchema.parse(
      diagnostic.kind === 'source-ahead'
        ? {
            ...common,
            kind: diagnostic.kind,
            missingMigrationCount: diagnostic.missingMigrationCount,
            firstExtraIndex: diagnostic.firstExtraIndex
          }
        : { ...common, kind: diagnostic.kind, firstDivergentIndex: diagnostic.firstDivergentIndex }
    )
    return ipcError(
      diagnostic.kind === 'source-ahead'
        ? backupErrorCodes.RESTORE_REQUIRES_NEWER_APP
        : backupErrorCodes.RESTORE_LINEAGE_INCOMPATIBLE,
      data
    )
  }
  if (error instanceof BackupFormatCompatibilityError) {
    const data = BackupFormatCompatibilityDiagnosticSchema.parse({
      kind: error.archiveFormatVersion > BACKUP_FORMAT_VERSION ? 'archive-newer' : 'archive-legacy',
      archiveFormatVersion: error.archiveFormatVersion,
      currentFormatVersion: BACKUP_FORMAT_VERSION,
      archiveAppVersion: error.archiveAppVersion,
      archiveBuildType: error.archiveBuildType,
      currentAppVersion: app.getVersion(),
      currentBuildType: currentBuildType()
    })
    return ipcError(backupErrorCodes.FORMAT_UNSUPPORTED, data)
  }
  if (error instanceof ArchiveAdmissionError) {
    // Admission detail can contain bounded archive-controlled names. Keep it in
    // main logs/tests; neither `message` nor `data` may serialize it to renderer.
    return ipcError(backupErrorCodes.ARCHIVE_REJECTED, { reason: error.reason })
  }
  if (error instanceof RestoreStateError) {
    if (error.code === 'unreadable') {
      return ipcError(backupErrorCodes.JOURNAL_UNREADABLE)
    }
    if (error.code === 'relaunch-failed') {
      return ipcError(backupErrorCodes.ARM_FAILED)
    }
    if (error.code === 'rollback-unavailable') {
      return ipcError(backupErrorCodes.ROLLBACK_UNAVAILABLE)
    }
    if (error.code === 'recovery-incomplete') {
      return ipcError(backupErrorCodes.RECOVERY_INCOMPLETE)
    }
    // `code` is a closed enum, and it is the one thing that distinguishes these
    // refusals from each other once the prose is gone.
    return ipcError(backupErrorCodes.RESTORE_STATE, { reason: error.code })
  }
  if (error instanceof InsufficientDiskSpaceError || error instanceof DiskFullError) {
    return ipcError(backupErrorCodes.STORAGE_UNAVAILABLE)
  }
  const exportSourceError = exportSourceIpcError(error)
  if (exportSourceError) return exportSourceError
  if (error instanceof OutputPathExistsError || error instanceof HardLinkUnsupportedError) {
    return ipcError(backupErrorCodes.EXPORT_DESTINATION)
  }
  if (error instanceof ResourceInstallPlanError) {
    return ipcError(backupErrorCodes.RESTORE_RESOURCES, { reason: error.code })
  }
  if (error instanceof IpcError) return error
  // An unpredicted fault is the most dangerous one to forward: a raw `ENOENT`
  // carries the user's absolute path, and `IpcError.from()` would publish it
  // verbatim. Log it here — the only place that still has it — and hand the
  // renderer a fault with no detail at all.
  logger.error('Unexpected backup failure', error as Error)
  return new IpcError(IpcErrorCode.INTERNAL, 'the backup operation failed unexpectedly')
}

async function mapped<T>(work: () => Promise<T> | T): Promise<T> {
  try {
    return await work()
  } catch (error) {
    throw toIpcError(error)
  }
}

/**
 * Run an abortable operation, returning `null` when the user cancelled it.
 *
 * A cancellation is folded into the SAME `canceled` outcome a dismissed file
 * dialog produces: from the renderer's side both are "the user changed their
 * mind", and neither is a failure worth a message. The pipeline unwinds its own
 * partial work before it throws, so there is nothing left to report either.
 */
async function cancellable<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof BackupCancelledError) {
      return null
    }
    throw toIpcError(error)
  }
}

export const backupHandlers: IpcHandlersFor<typeof backupRequestSchemas> = {
  'backup.get_status': async () => {
    const status = application.get('BackupService').getStatus()
    const { restore } = status
    if (restore.kind !== 'journal') {
      return { operation: status.operation, restore }
    }
    const { degradations, ...journal } = restore
    return {
      operation: status.operation,
      restore: degradations ? { ...journal, degradations: presentJournalDegradations(degradations) } : journal
    }
  },

  'backup.export': async (_input, ctx) => {
    const parent = requireManagedWindow(ctx)
    const { canceled, filePath } = await dialog.showSaveDialog(parent, {
      // The export never overwrites, so a name that already exists fails the
      // operation rather than the dialog — say so where the user is choosing.
      defaultPath: `cherry-studio-${new Date().toISOString().slice(0, 10)}.${ARCHIVE_EXTENSION}`,
      filters: [{ name: t('dialog.cherry_backup_files'), extensions: [ARCHIVE_EXTENSION] }]
    })
    if (canceled || !filePath) {
      return { status: 'canceled' as const }
    }
    const result = await cancellable(() => application.get('BackupService').export(filePath))
    if (result === null) {
      return { status: 'canceled' as const }
    }
    const manifest = result.manifest
    return {
      status: 'exported' as const,
      archivePath: result.outPath,
      resourceCount: manifest.resourcePayloads.length,
      degradations: presentDegradations(manifest.degradations)
    }
  },

  'backup.prepare_restore': async (_input, ctx) => {
    const parent = requireManagedWindow(ctx)
    const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
      properties: ['openFile'],
      filters: [{ name: t('dialog.cherry_backup_files'), extensions: [ARCHIVE_EXTENSION] }]
    })
    const archivePath = filePaths[0]
    if (canceled || !archivePath) {
      return { status: 'canceled' as const }
    }
    const preview = await cancellable(() => application.get('BackupService').prepareRestore(archivePath))
    if (preview === null) {
      return { status: 'canceled' as const }
    }
    return {
      status: 'prepared' as const,
      preview: {
        restoreId: preview.restoreId,
        coverage: { ...preview.coverage },
        resources: { ...preview.resources },
        degradations: presentDegradations(preview.degradations),
        migratedForward: preview.migratedForward
      }
    }
  },

  'backup.cancel_operation': async (_input, ctx) => {
    requireManagedWindow(ctx)
    return { cancelled: application.get('BackupService').cancelOperation() }
  },

  'backup.cancel_restore': async (_input, ctx) => {
    requireManagedWindow(ctx)
    await mapped(() => application.get('BackupService').cancelRestore())
  },

  'backup.arm_restore': async (input, ctx) => {
    requireManagedWindow(ctx)
    await mapped(() => application.get('BackupService').armRestore(input.restoreId))
  },

  'backup.rollback_restore': async (_input, ctx) => {
    requireManagedWindow(ctx)
    await mapped(() => application.get('BackupService').rollbackRestore())
  },

  'backup.acknowledge_restore': async (input, ctx) => {
    requireManagedWindow(ctx)
    return mapped(() => application.get('BackupService').acknowledgeRestore(input.knowledgeRebuild))
  }
}
