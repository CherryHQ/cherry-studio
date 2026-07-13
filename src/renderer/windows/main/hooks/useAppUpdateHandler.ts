import { loggerService } from '@logger'
import { useAppUpdateState } from '@renderer/hooks/useAppUpdateState'
import { useIpcOn } from '@renderer/ipc'
import { notificationService } from '@renderer/services/notification'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { uuid } from '@renderer/utils/uuid'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useAppUpdateHandler')

// REFACTOR(window-runtime-init): copied from the old useUpdateHandler and adjusted
// during the v2 data refactor — but it should NOT be a React hook at all. It is a
// main-only IPC->notification subscriber (twin of useStorageMonitorNotification) and
// belongs in a notification/service layer, not the window render tree. — fullex
export function useAppUpdateHandler() {
  const { t } = useTranslation()
  const { appUpdateState, updateAppUpdateState } = useAppUpdateState()
  // notificationService is imported as a module-level singleton
  const manualCheckRef = useRef(appUpdateState.manualCheck)

  // Keep ref in sync with current state
  useEffect(() => {
    manualCheckRef.current = appUpdateState.manualCheck
  }, [appUpdateState.manualCheck])

  useIpcOn('app.updater.not_available', () => {
    updateAppUpdateState({ checking: false, manualCheck: false })
    // Only surface the "already up to date" result for a user-initiated check.
    if (manualCheckRef.current) {
      toast.success(t('settings.about.updateNotAvailable'))
    }
  })

  useIpcOn('app.updater.available', (releaseInfo) => {
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
  })

  useIpcOn('app.updater.download_progress', (progress) => {
    updateAppUpdateState({
      downloading: progress.percent < 100,
      downloadProgress: progress.percent
    })
  })

  useIpcOn('app.updater.downloaded', (releaseInfo) => {
    updateAppUpdateState({
      downloading: false,
      info: releaseInfo,
      downloaded: true
    })
    // Auto show update dialog when download completes (only if user manually triggered the check).
    // Dynamic import (S6c): the dialog drags the streamdown/remark markdown stack
    // (~0.84 MB) along — imperative, rarely shown, so it must not sit in main's first paint.
    if (manualCheckRef.current) {
      import('@renderer/components/UpdateDialogPopup')
        .then(({ default: UpdateDialogPopup }) => UpdateDialogPopup.show({ releaseInfo }))
        .catch((error) => {
          // Update state stays `downloaded` — AboutSettings' static entry
          // still lets the user open the dialog and install.
          logger.error('Failed to load UpdateDialogPopup chunk:', error as Error)
        })
    }
  })

  useIpcOn('app.updater.error', (error) => {
    updateAppUpdateState({
      checking: false,
      downloading: false,
      downloadProgress: 0,
      manualCheck: false
    })
    // AppUpdaterService swallows updater failures after broadcasting UpdateError, so
    // AboutSettings.onCheckUpdate never sees them — surface it here for manual checks.
    if (manualCheckRef.current) {
      void popup.info({
        title: t('settings.about.updateError'),
        content: error?.message || t('settings.about.updateError'),
        icon: null
      })
    }
  })
}
