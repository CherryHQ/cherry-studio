import { useCache } from '@data/hooks/useCache'
import UpdateDialogPopup from '@renderer/components/Popups/UpdateDialogPopup'
import { notificationService } from '@renderer/services/notification'
import { uuid } from '@renderer/utils/uuid'
import type { CacheAppUpdateState } from '@shared/data/cache/cacheValueTypes'
import { IpcChannel } from '@shared/IpcChannel'
import type { ProgressInfo, UpdateInfo } from 'builder-util-runtime'
import { useEffect, useRef } from 'react'
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

// REFACTOR(window-runtime-init): copied from the old useUpdateHandler and adjusted
// during the v2 data refactor — but it should NOT be a React hook at all. It is a
// main-only IPC->notification subscriber (twin of useStorageMonitorNotification) and
// belongs in a notification/service layer, not the window render tree. — fullex
export function useAppUpdateHandler() {
  const { t } = useTranslation()
  const { updateAppUpdateState } = useAppUpdateState()
  // notificationService is imported as a module-level singleton
  const { appUpdateState } = useAppUpdateState()
  const manualCheckRef = useRef(appUpdateState.manualCheck)

  // Keep ref in sync with current state
  useEffect(() => {
    manualCheckRef.current = appUpdateState.manualCheck
  }, [appUpdateState.manualCheck])

  useEffect(() => {
    if (!window.electron) return

    const ipcRenderer = window.electron.ipcRenderer

    const removers = [
      ipcRenderer.on(IpcChannel.UpdateNotAvailable, () => {
        updateAppUpdateState({ checking: false, manualCheck: false })
      }),
      ipcRenderer.on(IpcChannel.UpdateAvailable, (_, releaseInfo: UpdateInfo) => {
        void notificationService.send({
          id: uuid(),
          type: 'info',
          title: t('button.update_available'),
          message: t('button.update_available', { version: releaseInfo.version }),
          timestamp: Date.now(),
          source: 'update'
        })
        updateAppUpdateState({
          checking: false,
          downloading: true,
          info: releaseInfo,
          available: true
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
        // Auto show update dialog when download completes (only if user manually triggered the check)
        if (manualCheckRef.current) {
          void UpdateDialogPopup.show({ releaseInfo })
        }
      }),
      ipcRenderer.on(IpcChannel.UpdateError, () => {
        updateAppUpdateState({
          checking: false,
          downloading: false,
          downloadProgress: 0,
          manualCheck: false
        })
      })
    ]
    return () => removers.forEach((remover) => remover())
  }, [t, updateAppUpdateState])
}
