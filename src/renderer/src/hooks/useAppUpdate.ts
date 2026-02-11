import { useCache } from '@data/hooks/useCache'
import { NotificationService } from '@renderer/services/NotificationService'
import { uuid } from '@renderer/utils'
import type { CacheAppUpdateState } from '@shared/data/cache/cacheValueTypes'
import { IpcChannel } from '@shared/IpcChannel'
import type { ProgressInfo, UpdateInfo } from 'builder-util-runtime'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
export const useAppUpdateState = () => {
  const [appUpdateState, setAppUpdateState] = useCache('app.dist.update_state')

  const updateAppUpdateState = (state: Partial<CacheAppUpdateState>) => {
    setAppUpdateState({ ...appUpdateState, ...state })
  }

  return {
    appUpdateState,
    updateAppUpdateState
  }
}

//TODO: 这个函数是从useUpdateHandler中复制过来的，是v2数据重构时调整的，但这个函数本身需要重构和优化（并不需要用在use中）。by fullex
export function useAppUpdateHandler() {
  const { t } = useTranslation()
  const { updateAppUpdateState } = useAppUpdateState()
  const notificationService = NotificationService.getInstance()

  useEffect(() => {
    if (!window.electron) return

    const ipcRenderer = window.electron.ipcRenderer

    const removers = [
      ipcRenderer.on(IpcChannel.UpdateNotAvailable, () => {
        updateAppUpdateState({ checking: false })
        if (window.location.hash.includes('settings/about')) {
          window.toast.success(t('settings.about.updateNotAvailable'))
        }
      }),
      ipcRenderer.on(IpcChannel.UpdateAvailable, (_, releaseInfo: UpdateInfo) => {
        notificationService.send({
          id: uuid(),
          type: 'info',
          title: t('button.update_available'),
          message: t('button.update_available', { version: releaseInfo.version }),
          timestamp: Date.now(),
          source: 'update',
          channel: 'system'
        })
        updateAppUpdateState({
          checking: false,
          downloading: true,
          info: releaseInfo,
          available: true
        })
      }),
      ipcRenderer.on(IpcChannel.DownloadUpdate, () => {
        updateAppUpdateState({
          checking: false,
          downloading: true
        })
      }),
      ipcRenderer.on(IpcChannel.DownloadProgress, (_, progress: ProgressInfo) => {
        updateAppUpdateState({
          downloading: progress.percent < 100,
          downloadProgress: progress.percent
        })
      }),
      ipcRenderer.on(IpcChannel.UpdateDownloaded, (_, releaseInfo: UpdateInfo) => {
        updateAppUpdateState({
          downloading: false,
          info: releaseInfo,
          downloaded: true
        })
      }),
      ipcRenderer.on(IpcChannel.UpdateError, (_, error) => {
        updateAppUpdateState({
          checking: false,
          downloading: false,
          downloadProgress: 0
        })
        if (window.location.hash.includes('settings/about')) {
          window.modal.info({
            title: t('settings.about.updateError'),
            content: error?.message || t('settings.about.updateError'),
            icon: null
          })
        }
      })
    ]
    return () => removers.forEach((remover) => remover())
  }, [notificationService, t, updateAppUpdateState])
}
