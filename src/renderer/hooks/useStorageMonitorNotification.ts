import { loggerService } from '@logger'
import { toast } from '@renderer/services/toast'
import type { StorageHealth } from '@shared/types/storageMonitor'
import { t } from 'i18next'
import { useEffect } from 'react'

const logger = loggerService.withContext('useStorageMonitorNotification')

/**
 * Subscribe to main-process disk-space health and surface a low-disk warning.
 *
 * Detection and capacity-adaptive polling live in the main-process
 * StorageMonitorService; this hook is a thin subscriber that maps health
 * transitions onto a persistent toast, mirroring useAppUpdateHandler.
 *
 * Intentionally a React hook, not a service (mirroring useAppUpdateHandler):
 * service-ification was considered and rejected — it depends on React-visible toast
 * state and manages its own effect cleanup, and the renderer has no service lifecycle
 * container, so a service would only add manual start/stop wiring for no gain.
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
        toast.warning({
          description: t('settings.data.limit.appDataDiskQuotaDescription'),
          key: warningKey,
          timeout: 0,
          title: t('settings.data.limit.appDataDiskQuota')
        })
        logger.info('Low disk space, showing warning notification')
      } else if (health.level === 'ok' && warningKey) {
        toast.closeToast(warningKey)
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
