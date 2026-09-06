import { useSharedCacheValue } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { toast } from '@renderer/services/toast'
import { t } from 'i18next'
import { useEffect, useRef } from 'react'

const logger = loggerService.withContext('useStorageMonitorNotification')

/** Maps the main-owned shared disk-health snapshot onto the main-window warning. */
export function useStorageMonitorNotification(): void {
  const health = useSharedCacheValue('storage.health')
  const warningKey = useRef<string | null>(null)

  useEffect(() => {
    if (!health) return
    if (health.level === 'low' && !warningKey.current) {
      warningKey.current = `disk-warning-${Date.now()}`
      toast.warning({
        description: t('settings.data.limit.appDataDiskQuotaDescription'),
        key: warningKey.current,
        timeout: 0,
        title: t('settings.data.limit.appDataDiskQuota')
      })
      logger.info('Low disk space, showing warning notification')
    } else if (health.level === 'ok' && warningKey.current) {
      toast.closeToast(warningKey.current)
      warningKey.current = null
      logger.info('Disk space recovered, dismissing warning notification')
    }
  }, [health])
}
