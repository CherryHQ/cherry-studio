import { loggerService } from '@logger'
import type { StorageHealth } from '@shared/types/storageMonitor'
import { notification } from 'antd'
import { t } from 'i18next'
import { useEffect } from 'react'

const logger = loggerService.withContext('useStorageMonitorNotification')

/**
 * Subscribe to main-process disk-space health and surface a low-disk warning.
 *
 * Detection and capacity-adaptive polling live in the main-process
 * StorageMonitorService; this hook is a thin subscriber that maps health
 * transitions onto an antd notification, mirroring useAppUpdateHandler.
 *
 * TODO(v2-ui): the antd `notification` here is retained intentionally — migrate
 * it to `@cherrystudio/ui` as part of the broader v2 UI refactor, not piecemeal.
 */
export function useStorageMonitorNotification(): void {
  useEffect(() => {
    // Single main window, mounted once: a closure-scoped key dedupes the warning
    // and lets us destroy it on recovery.
    let warningKey: string | null = null
    // Drop any health that arrives after teardown — notably the async getHealth()
    // pull resolving post-unmount (e.g. StrictMode's mount/unmount/mount in dev).
    let active = true

    const apply = (health: StorageHealth) => {
      if (!active) return
      if (health.level === 'low' && !warningKey) {
        warningKey = `disk-warning-${Date.now()}`
        notification.warning({
          message: t('settings.data.limit.appDataDiskQuota'),
          description: t('settings.data.limit.appDataDiskQuotaDescription'),
          duration: 0,
          key: warningKey
        })
        logger.info('Low disk space, showing warning notification')
      } else if (health.level === 'ok' && warningKey) {
        notification.destroy(warningKey)
        warningKey = null
        logger.info('Disk space recovered, dismissing warning notification')
      }
    }

    const unsubscribe = window.api.storageMonitor.onHealthChange(apply)

    // Seed initial state — covers the disk already being low at startup, before
    // any transition push arrives.
    void window.api.storageMonitor
      .getHealth()
      .then(apply)
      .catch((error) => logger.error('Failed to get initial storage health', error as Error))

    return () => {
      active = false
      unsubscribe()
    }
  }, [])
}
