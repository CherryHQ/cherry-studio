import { application } from '@application'
import type { backupRequestSchemas } from '@shared/ipc/schemas/backup'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Thin adapters for the backup request routes: each delegates to BackupService
 * (business logic + export lifecycle + cancel/progress routing stay there). These
 * routes act on a singleton export slot, not the caller's window, so they ignore
 * IpcContext — there is no senderId addressing here (contrast window.ts).
 */
export const backupHandlers: IpcHandlersFor<typeof backupRequestSchemas> = {
  'backup.start_backup': async ({ preset, outputPath }) => {
    const result = await application.get('BackupService').startBackup({ preset, outputPath })
    return { backupId: result.backupId, archivePath: result.archivePath }
  },
  'backup.cancel': async ({ backupId }) => application.get('BackupService').cancel(backupId)
}
