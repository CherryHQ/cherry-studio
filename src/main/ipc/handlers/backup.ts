import { application } from '@application'
import {
  ArchiveAdmissionError,
  BackupBusyError,
  BackupCancelledError,
  DiskFullError,
  HardLinkUnsupportedError,
  InsufficientDiskSpaceError,
  OutputPathExistsError,
  RestoreStateError
} from '@main/services/backup'
import { backupErrorCodes } from '@shared/ipc/errors/backup'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { backupRequestSchemas } from '@shared/ipc/schemas/backup'
import type { IpcContext, IpcHandlersFor } from '@shared/ipc/types'
import { dialog } from 'electron'

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

/**
 * Every route here either replaces the database or releases the material that
 * could undo one, so the caller must be a window this app manages. `senderId` is
 * null for anything WindowManager does not track — a detached webContents, a
 * webview — and that is exactly what must not drive a restore.
 */
function assertManagedWindow({ senderId }: IpcContext): void {
  if (senderId === null) {
    throw new IpcError(backupErrorCodes.SENDER_NOT_ALLOWED, 'backup commands require a managed application window')
  }
}

/**
 * Map the backup pipeline's structural errors onto the closed code set the UI
 * branches on. Anything unmapped stays an unexpected fault (`INTERNAL`), which
 * is the honest answer for a fault we did not predict.
 */
function toIpcError(error: unknown): unknown {
  if (error instanceof BackupBusyError) {
    return new IpcError(backupErrorCodes.BUSY, error.message, { running: error.running })
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
    if (error.code === 'recovery-incomplete') {
      return new IpcError(backupErrorCodes.RECOVERY_INCOMPLETE, error.message)
    }
    return new IpcError(backupErrorCodes.RESTORE_STATE, error.message)
  }
  if (
    error instanceof InsufficientDiskSpaceError ||
    error instanceof DiskFullError ||
    error instanceof OutputPathExistsError ||
    error instanceof HardLinkUnsupportedError
  ) {
    return new IpcError(backupErrorCodes.EXPORT_DESTINATION, (error as Error).message)
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
      restore: degradations
        ? { ...journal, degradations: degradations.map((degradation) => ({ ...degradation })) }
        : journal
    }
  },

  'backup.export': async ({ preset }, ctx) => {
    assertManagedWindow(ctx)
    const { canceled, filePath } = await dialog.showSaveDialog({
      // The export never overwrites, so a name that already exists fails the
      // operation rather than the dialog — say so where the user is choosing.
      defaultPath: `cherry-studio-${preset}-${new Date().toISOString().slice(0, 10)}.${ARCHIVE_EXTENSION}`,
      filters: [{ name: 'Cherry Studio Backup', extensions: [ARCHIVE_EXTENSION] }]
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
      degradations: manifest.degradations.map((degradation) => ({ ...degradation }))
    }
  },

  'backup.prepare_restore': async (_input, ctx) => {
    assertManagedWindow(ctx)
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Cherry Studio Backup', extensions: [ARCHIVE_EXTENSION] }]
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
        degradations: preview.degradations.map((degradation) => ({ ...degradation })),
        migratedForward: preview.migratedForward
      }
    }
  },

  'backup.cancel_operation': async (_input, ctx) => {
    assertManagedWindow(ctx)
    return { cancelled: application.get('BackupService').cancelOperation() }
  },

  'backup.cancel_restore': async (_input, ctx) => {
    assertManagedWindow(ctx)
    await mapped(() => application.get('BackupService').cancelRestore())
  },

  'backup.arm_restore': async (_input, ctx) => {
    assertManagedWindow(ctx)
    await mapped(() => application.get('BackupService').armRestore())
  },

  'backup.acknowledge_restore': async (_input, ctx) => {
    assertManagedWindow(ctx)
    return mapped(() => application.get('BackupService').acknowledgeRestore())
  }
}
