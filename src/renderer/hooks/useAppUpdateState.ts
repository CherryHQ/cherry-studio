import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { cacheService } from '@data/CacheService'
import { useCache, useSharedCacheValue } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { DefaultSharedCache } from '@shared/data/cache/cacheSchemas'
import type { CacheAppUpdateState } from '@shared/data/cache/cacheValueTypes'

const logger = loggerService.withContext('useAppUpdateState')

export const useAppUpdateState = (
  showDownloadedUpdate?: (info: CacheAppUpdateState['info']) => Promise<unknown> | void
) => {
  const { t } = useTranslation()
  const [intent, setIntent] = useCache('app.dist.update_state')
  const status = useSharedCacheValue('app.dist.update_status') ?? DefaultSharedCache['app.dist.update_status']
  const appUpdateState = useMemo(() => ({ ...status, ...intent }), [status, intent])

  const updateAppUpdateState = useCallback(
    (state: Partial<CacheAppUpdateState>) => {
      const { manualCheck, ignore, ...statusPatch } = state
      if (statusPatch.checking) statusPatch.lastErrorKey = null
      if (manualCheck !== undefined || ignore !== undefined) {
        setIntent((previous) => ({
          manualCheck: manualCheck ?? previous.manualCheck,
          ignore: ignore ?? previous.ignore
        }))
      }
      if (Object.keys(statusPatch).length > 0) {
        const previous =
          cacheService.getShared('app.dist.update_status') ?? DefaultSharedCache['app.dist.update_status']
        cacheService.setShared('app.dist.update_status', { ...previous, ...statusPatch })
      }
    },
    [setIntent]
  )

  const checkForUpdate = useCallback(async (): Promise<void> => {
    const current = cacheService.getShared('app.dist.update_status') ?? DefaultSharedCache['app.dist.update_status']
    if (current.checking || current.downloading) return
    if (current.downloaded) {
      try {
        await showDownloadedUpdate?.(current.info)
      } catch (error) {
        logger.error('Failed to show update dialog', error as Error)
        toast.error(t('settings.about.updateError'))
      }
      return
    }
    updateAppUpdateState({ checking: true, manualCheck: true })
    try {
      await ipcApi.request('app.updater.check_for_update')
    } catch (error) {
      logger.error('Failed to check for update', error as Error)
      updateAppUpdateState({ manualCheck: false })
      toast.error(t('settings.about.updateError'))
    } finally {
      updateAppUpdateState({ checking: false })
    }
  }, [showDownloadedUpdate, t, updateAppUpdateState])

  return {
    appUpdateState,
    updateAppUpdateState,
    checkForUpdate
  }
}
