import { cacheService } from '@data/CacheService'
import { useSharedCacheSelector } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { setBackupSyncState } from '@renderer/services/BackupService'
import { notificationService } from '@renderer/services/notification'
import { toast } from '@renderer/services/toast'
import { getLocalizedBackupErrorMessage } from '@renderer/utils/backup'
import { uuid } from '@renderer/utils/uuid'
import { AUTO_BACKUP_TYPES, type AutoBackupEvent } from '@shared/types/backup'
import { useEffect, useEffectEvent } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useAutoBackupEvents')
const STATE_KEYS = AUTO_BACKUP_TYPES.map((type) => `backup.auto_sync.state.${type}` as const)

function notificationCacheKey(event: AutoBackupEvent): string {
  return `backup:auto-sync:notified:${event.type}:${event.id}`
}

export function useAutoBackupEvents(): void {
  const { t } = useTranslation()
  const events = useSharedCacheSelector(STATE_KEYS, (values) => values)

  const applyState = useEffectEvent((event: AutoBackupEvent) => {
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
        lastSyncError: getLocalizedBackupErrorMessage(new Error(event.errorMessage))
      })
    } else {
      setBackupSyncState(event.type, { syncing: false, lastSyncTime: event.timestamp, lastSyncError: null })
    }
  })

  const notify = useEffectEvent((event: AutoBackupEvent) => {
    const cacheKey = notificationCacheKey(event)
    if ((event.status === 'warning' || event.status === 'failed') && !cacheService.hasCasual(cacheKey)) {
      cacheService.setCasual(cacheKey, true, 24 * 60 * 60 * 1000) // 24 hours
      if (event.status === 'warning') toast.warning(t('message.backup.cleanup_failed'))
      else toast.error(getLocalizedBackupErrorMessage(new Error(event.errorMessage)))
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

  useEffect(() => {
    events.forEach((event) => {
      if (event) applyState(event)
    })
  }, [applyState, events])

  useIpcOn('backup.auto_sync_state_changed', notify)

  useEffect(() => {
    void ipcApi
      .request('backup.get_auto_sync_state')
      .then(({ pendingNotifications }) => pendingNotifications.forEach(notify))
      .catch((error) => logger.error('Failed to load automatic backup notifications', error as Error))
  }, [notify])
}
