import { useIpcOn } from '@renderer/ipc'
import { getBackupSyncState, type RemoteSyncState } from '@renderer/services/BackupService'
import { notificationService } from '@renderer/services/notification'
import { getNutstoreSyncState } from '@renderer/services/NutstoreService'
import { toast } from '@renderer/services/toast'
import { getLocalizedBackupErrorMessage } from '@renderer/utils/backup'
import { uuid } from '@renderer/utils/uuid'
import type { AutoBackupType } from '@shared/types/backup'
import { useTranslation } from 'react-i18next'

function getSyncState(type: AutoBackupType): RemoteSyncState {
  if (type === 'nutstore') return getNutstoreSyncState()

  const state = getBackupSyncState()
  if (type === 'webdav') return state.webdavSync
  if (type === 's3') return state.s3Sync
  return state.localBackupSync
}

export function useAutoBackupEvents(): void {
  const { t } = useTranslation()

  useIpcOn('backup.auto_sync_state_changed', (event) => {
    const state = getSyncState(event.type)

    if (event.status === 'running') {
      Object.assign(state, { syncing: true, lastSyncError: null })
      return
    }
    if (event.status === 'stopped') {
      state.syncing = false
      return
    }
    if (event.status === 'warning') {
      const message = t('message.backup.cleanup_failed')
      Object.assign(state, { syncing: false, lastSyncTime: event.timestamp, lastSyncError: message })
      toast.warning(message)
      return
    }
    if (event.status === 'failed') {
      const message = getLocalizedBackupErrorMessage(new Error(event.errorMessage))
      Object.assign(state, { syncing: false, lastSyncTime: event.timestamp, lastSyncError: message })
      toast.error(message)
      return
    }

    Object.assign(state, { syncing: false, lastSyncTime: event.timestamp, lastSyncError: null })
    if (event.type === 'webdav' || event.type === 's3') {
      void notificationService.send({
        id: uuid(),
        type: 'success',
        title: t('common.success'),
        message: t('message.backup.success'),
        silent: false,
        timestamp: event.timestamp,
        source: 'backup'
      })
    }
  })
}
