import { application } from '@application'
import { t } from '@main/i18n'
import {
  ArchiveAdmissionError,
  BACKUP_FORMAT_VERSION,
  BackupBusyError,
  BackupCancelledError,
  BackupFormatCompatibilityError,
  BackupMigrationCompatibilityError,
  CeilingExceededError,
  DiskFullError,
  HardLinkUnsupportedError,
  InsufficientDiskSpaceError,
  NonRegularSourceError,
  OutputPathExistsError,
  ResourceInstallPlanError,
  RestoreStateError,
  SourceDriftError,
  UnportableSourceError
} from '@main/services/backup'
import {
  backupErrorCodes,
  BackupFormatCompatibilityDiagnosticSchema,
  BackupMigrationCompatibilityDiagnosticSchema
} from '@shared/ipc/errors/backup'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { BackupDegradationCode, backupRequestSchemas } from '@shared/ipc/schemas/backup'
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

const ARCHIVE_EXTENSION = 'cherrybackup'

function presentDegradations(
  degradations: readonly { readonly kind: string; readonly reason: string }[]
): Array<{ code: BackupDegradationCode; count: number }> {
  const counts = new Map<BackupDegradationCode, number>()
  for (const degradation of degradations) {
    let code: BackupDegradationCode = 'unknown'
    let count = 1
    if (degradation.kind.startsWith('resource:')) {
      code = 'resource-unavailable'
    } else {
      const parsed =
        /^(capability-malformed|external-file-dropped|path-unportable|path-collision) \((\d+) rows?\)$/.exec(
          degradation.reason
        )
      if (parsed) {
        code = parsed[1] as BackupDegradationCode
        const parsedCount = Number(parsed[2])
        count = Number.isSafeInteger(parsedCount) && parsedCount > 0 ? parsedCount : 1
      }
    }
    counts.set(code, (counts.get(code) ?? 0) + count)
  }
  return [...counts].map(([code, count]) => ({ code, count }))
}

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

function toIpcError(error: unknown): unknown {
  if (error instanceof BackupBusyError) {
    return new IpcError(backupErrorCodes.BUSY, error.message, { running: error.running })
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
    return new IpcError(
      diagnostic.kind === 'source-ahead'
        ? backupErrorCodes.RESTORE_REQUIRES_NEWER_APP
        : backupErrorCodes.RESTORE_LINEAGE_INCOMPATIBLE,
      error.message,
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
    return new IpcError(backupErrorCodes.FORMAT_UNSUPPORTED, error.message, data)
  }
  if (error instanceof ArchiveAdmissionError) {
    return new IpcError(backupErrorCodes.ARCHIVE_REJECTED, error.message, { reason: error.reason })
  }
  if (error instanceof RestoreStateError) {
    if (error.code === 'unreadable') {
      return new IpcError(backupErrorCodes.JOURNAL_UNREADABLE, error.message)
    }
    if (error.code === 'relaunch-failed') {
      return new IpcError(backupErrorCodes.ARM_FAILED, error.message)
    }
    if (error.code === 'rollback-unavailable') {
      return new IpcError(backupErrorCodes.ROLLBACK_UNAVAILABLE, error.message)
    }
    if (error.code === 'recovery-incomplete') {
      return new IpcError(backupErrorCodes.RECOVERY_INCOMPLETE, error.message)
    }
    return new IpcError(backupErrorCodes.RESTORE_STATE, error.message)
  }
  if (error instanceof InsufficientDiskSpaceError || error instanceof DiskFullError) {
    return new IpcError(backupErrorCodes.STORAGE_UNAVAILABLE, error.message)
  }
  if (
    error instanceof SourceDriftError ||
    error instanceof NonRegularSourceError ||
    error instanceof UnportableSourceError ||
    error instanceof CeilingExceededError
  ) {
    return new IpcError(backupErrorCodes.EXPORT_SOURCE, error.message)
  }
  if (error instanceof OutputPathExistsError || error instanceof HardLinkUnsupportedError) {
    return new IpcError(backupErrorCodes.EXPORT_DESTINATION, error.message)
  }
  if (error instanceof ResourceInstallPlanError) {
    return new IpcError(backupErrorCodes.RESTORE_RESOURCES, error.message, { reason: error.code })
  }
  return error
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
      restore: degradations ? { ...journal, degradations: presentDegradations(degradations) } : journal
    }
  },

  'backup.export': async ({ preset }, ctx) => {
    const parent = requireManagedWindow(ctx)
    const { canceled, filePath } = await dialog.showSaveDialog(parent, {
      // The export never overwrites, so a name that already exists fails the
      // operation rather than the dialog — say so where the user is choosing.
      defaultPath: `cherry-studio-${preset}-${new Date().toISOString().slice(0, 10)}.${ARCHIVE_EXTENSION}`,
      filters: [{ name: t('dialog.cherry_backup_files'), extensions: [ARCHIVE_EXTENSION] }]
    })
    if (canceled || !filePath) {
      return { status: 'canceled' as const }
    }
    const result = await cancellable(() => application.get('BackupService').export(filePath, preset))
    if (result === null) {
      return { status: 'canceled' as const }
    }
    const manifest = result.manifest
    return {
      status: 'exported' as const,
      archivePath: result.outPath,
      preset: manifest.preset,
      resourceCount: manifest.preset === 'full' ? manifest.resourcePayloads.length : 0,
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
        preset: preview.preset,
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
