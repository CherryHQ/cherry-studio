import { application } from '@application'
import type { backupRequestSchemas } from '@shared/ipc/schemas/backup'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const backupHandlers: IpcHandlersFor<typeof backupRequestSchemas> = {
  'backup.get_auto_sync_state': async () => application.get('AutoBackupService').getStateSnapshot(),
  'backup.acknowledge_auto_sync_notification': async ({ type, id }) => {
    application.get('AutoBackupService').acknowledgeNotification(type, id)
  },
  'backup.manual_completion.record': async ({ type }) => {
    application.get('AutoBackupService').recordManualBackupCompletion(type)
  }
}
