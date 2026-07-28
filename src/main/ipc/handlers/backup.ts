import { application } from '@application'
import { t } from '@main/i18n'
import {
  ArchiveAdmissionError,
  BackupBusyError,
  BackupCancelledError,
  DiskFullError,
  HardLinkUnsupportedError,
  InsufficientDiskSpaceError,
  OutputPathExistsError,
  presentJournalDegradations
} from '@main/services/backup'
import { backupErrorCodes } from '@shared/ipc/errors/backup'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { backupRequestSchemas } from '@shared/ipc/schemas/backup'
import type { IpcContext, IpcHandlersFor } from '@shared/ipc/types'
import { type BrowserWindow, dialog } from 'electron'

const ARCHIVE_EXTENSION = 'cherrybackup'
const STORAGE_UNAVAILABLE_MESSAGE = 'backup storage is unavailable'
const EXPORT_DESTINATION_MESSAGE = 'backup destination is unavailable'

function requireManagedWindow({ senderId }: IpcContext): BrowserWindow {
  const window = senderId === null ? undefined : application.get('WindowManager').getWindow(senderId)
  if (!window)
    throw new IpcError(backupErrorCodes.SENDER_NOT_ALLOWED, 'backup commands require a managed application window')
  return window
}

function toIpcError(error: unknown): unknown {
  if (error instanceof BackupBusyError)
    return new IpcError(backupErrorCodes.BUSY, error.message, { running: error.running })
  if (error instanceof ArchiveAdmissionError) {
    const code =
      error.reason === 'chain-incompatible' ? backupErrorCodes.RESTORE_INCOMPATIBLE : backupErrorCodes.ARCHIVE_REJECTED
    return new IpcError(code, 'backup archive was rejected')
  }
  if (error instanceof InsufficientDiskSpaceError || error instanceof DiskFullError) {
    return new IpcError(backupErrorCodes.STORAGE_UNAVAILABLE, STORAGE_UNAVAILABLE_MESSAGE)
  }
  if (error instanceof OutputPathExistsError || error instanceof HardLinkUnsupportedError) {
    return new IpcError(backupErrorCodes.EXPORT_DESTINATION, EXPORT_DESTINATION_MESSAGE)
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

async function cancellable<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof BackupCancelledError) return null
    throw toIpcError(error)
  }
}

export const backupHandlers: IpcHandlersFor<typeof backupRequestSchemas> = {
  'backup.get_status': async () => {
    const status = application.get('BackupService').getStatus()
    switch (status.restore.kind) {
      case 'none':
        return { operation: status.operation, restore: { kind: 'none' as const } }
      case 'unreadable':
        return { operation: status.operation, restore: { kind: 'unreadable' as const } }
      case 'journal': {
        const { degradations, ...restore } = status.restore
        return {
          operation: status.operation,
          restore: degradations ? { ...restore, degradations: presentJournalDegradations(degradations) } : restore
        }
      }
    }
  },

  'backup.export': async (_input, ctx) => {
    const parent = requireManagedWindow(ctx)
    const { canceled, filePath } = await dialog.showSaveDialog(parent, {
      defaultPath: `cherry-studio-lite-${new Date().toISOString().slice(0, 10)}.${ARCHIVE_EXTENSION}`,
      filters: [{ name: t('dialog.cherry_backup_files'), extensions: [ARCHIVE_EXTENSION] }]
    })
    if (canceled || !filePath) return { status: 'canceled' as const }
    const result = await cancellable(() => application.get('BackupService').export(filePath))
    if (!result) return { status: 'canceled' as const }
    return { status: 'exported' as const, archivePath: result.outPath, degradations: result.manifest.degradations }
  },

  'backup.prepare_restore': async (_input, ctx) => {
    const parent = requireManagedWindow(ctx)
    const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
      properties: ['openFile'],
      filters: [{ name: t('dialog.cherry_backup_files'), extensions: [ARCHIVE_EXTENSION] }]
    })
    const archivePath = filePaths[0]
    if (canceled || !archivePath) return { status: 'canceled' as const }
    const preview = await cancellable(() => application.get('BackupService').prepareRestore(archivePath))
    if (!preview) return { status: 'canceled' as const }
    return {
      status: 'prepared' as const,
      preview: { ...preview, degradations: presentJournalDegradations(preview.degradations) }
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
  'backup.acknowledge_restore': async (_input, ctx) => {
    requireManagedWindow(ctx)
    return mapped(() => application.get('BackupService').acknowledgeRestore())
  }
}
