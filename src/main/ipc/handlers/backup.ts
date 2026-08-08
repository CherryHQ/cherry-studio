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
 * (v2 export/restore lifecycle) or AutoBackupService (v1 auto-sync state).
 * Side-effecting v2 routes require a managed window caller (`ctx.senderId`).
 */
export const backupHandlers: IpcHandlersFor<typeof backupRequestSchemas> = {
  // v2 modular export/restore pipeline (managed-window gated).
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
  },
  'backup.restore_relaunch': async (_input, { senderId }) => {
    assertBackupSender(senderId)
    application.get('BackupService').relaunchStagedRestore()
  },
  'backup.restore_status': async (_input, { senderId }) => {
    assertBackupSender(senderId)
    return application.get('BackupService').getRestoreStatus()
  },
  'backup.restore_acknowledge': async (_input, { senderId }) => {
    assertBackupSender(senderId)
    return application.get('BackupService').acknowledgeRestoreOutcome()
  },
  // v1 auto-backup sync state (read-only / idempotent — no sender gate).
  'backup.get_auto_sync_state': async () => application.get('AutoBackupService').getStateSnapshot(),
  'backup.acknowledge_auto_sync_notification': async ({ type, id }) => {
    application.get('AutoBackupService').acknowledgeNotification(type, id)
  },
  'backup.manual_completion.record': async ({ type }) => {
    application.get('AutoBackupService').recordManualBackupCompletion(type)
  }
}
