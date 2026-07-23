import { application } from '@application'
import { backupErrorCodes } from '@shared/ipc/errors/backup'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { backupRequestSchemas } from '@shared/ipc/schemas/backup'
import type { IpcHandlersFor } from '@shared/ipc/types'

function assertBackupSender(senderId: string | null): asserts senderId is string {
  if (senderId == null) {
    throw new IpcError(backupErrorCodes.INVALID_SENDER, 'backup: caller is not a managed window')
  }
}

/**
 * Thin adapters for the backup request routes: each delegates to BackupService
 * (business logic + export lifecycle + cancel/progress routing stay there).
 * Side-effecting backup routes require a managed window caller (`ctx.senderId`).
 */
export const backupHandlers: IpcHandlersFor<typeof backupRequestSchemas> = {
  'backup.start_backup': async ({ preset, outputPath, overwrite }, { senderId }) => {
    assertBackupSender(senderId)
    const result = await application.get('BackupService').startBackup({ preset, outputPath, overwrite })
    return { backupId: result.backupId, archivePath: result.archivePath }
  },
  'backup.cancel': async ({ backupId }, { senderId }) => {
    assertBackupSender(senderId)
    return application.get('BackupService').cancel(backupId)
  },
  'backup.start_restore': async ({ archivePath }, { senderId }) => {
    assertBackupSender(senderId)
    const result = await application.get('BackupService').startRestore({ archivePath })
    return { restoreId: result.restoreId }
  }
}
