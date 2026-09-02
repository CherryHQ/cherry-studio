import { loggerService } from '@logger'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { setBackupSyncState } from '@renderer/services/BackupService'
import { notificationService } from '@renderer/services/notification'
import { toast } from '@renderer/services/toast'
import { getLocalizedBackupErrorMessage } from '@renderer/utils/backup'
import { uuid } from '@renderer/utils/uuid'
import type { AutoBackupEvent, AutoBackupType } from '@shared/types/backup'
import { useEffect, useEffectEvent } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useAutoBackupEvents')
const latestEventIds = new Map<AutoBackupType, number>()
const notifiedEventIds = new Map<AutoBackupType, number>()

export function useAutoBackupEvents(): void {
  const { t } = useTranslation()

  const handleEvent = useEffectEvent((event: AutoBackupEvent, notify: boolean) => {
    if (event.id > (latestEventIds.get(event.type) ?? 0)) {
      latestEventIds.set(event.type, event.id)

      if (event.status === 'running') {
        setBackupSyncState(event.type, { syncing: true, lastSyncError: null })
      } else if (event.status === 'stopped') {
        setBackupSyncState(event.type, { syncing: false })
      } else if (event.status === 'warning') {
        setBackupSyncState(event.type, {
          syncing: false,
          lastSyncTime: event.timestamp,
          lastSyncError: t('message.backup.cleanup_failed')
        })
      } else if (event.status === 'failed') {
        setBackupSyncState(event.type, {
          syncing: false,
          lastSyncTime: event.timestamp,
          lastSyncError: getLocalizedBackupErrorMessage(new Error(event.errorMessage), 'message.backup.failed', {
            tlsCertificateHint: event.type === 'webdav'
          })
        })
      } else {
        setBackupSyncState(event.type, { syncing: false, lastSyncTime: event.timestamp, lastSyncError: null })
      }
    }

    if (!notify) return

    if ((event.status === 'warning' || event.status === 'failed') && notifiedEventIds.get(event.type) !== event.id) {
      notifiedEventIds.set(event.type, event.id)
      if (event.status === 'warning') {
        toast.warning(t('message.backup.cleanup_failed'))
      } else {
        toast.error(
          getLocalizedBackupErrorMessage(new Error(event.errorMessage), 'message.backup.failed', {
            tlsCertificateHint: event.type === 'webdav'
          })
        )
      }
      void ipcApi
        .request('backup.acknowledge_auto_sync_notification', { type: event.type, id: event.id })
        .catch((error) => logger.error('Failed to acknowledge automatic backup notification', error as Error))
    } else if (event.status === 'succeeded' && (event.type === 'webdav' || event.type === 's3')) {
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

  useIpcOn('backup.auto_sync_state_changed', (event) => handleEvent(event, true))

  useEffect(() => {
    void ipcApi
      .request('backup.get_auto_sync_state')
      .then(({ events, pendingNotifications }) => {
        events.forEach((event) => handleEvent(event, false))
        pendingNotifications.forEach((event) => handleEvent(event, true))
      })
      .catch((error) => logger.error('Failed to load automatic backup state', error as Error))
    // `handleEvent` is an Effect Event and must not be a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
