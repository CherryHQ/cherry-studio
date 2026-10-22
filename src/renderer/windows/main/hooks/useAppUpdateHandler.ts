import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { useAppUpdateState } from '@renderer/hooks/useAppUpdateState'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { appUpdateCheckService } from '@renderer/services/AppUpdateCheckService'
import { notificationService } from '@renderer/services/notification'
import { toast } from '@renderer/services/toast'
import { uuid } from '@renderer/utils/uuid'

const logger = loggerService.withContext('useAppUpdateHandler')

/** Map updater failures to i18n keys. Never surface the raw HTTP body. */
export function getManualUpdateErrorMessageKey(error: { message?: string } | null | undefined): string {
  const message = error?.message ?? ''
  if (isUnpublishedReleaseError(message)) {
    return 'settings.about.updateNotPublished'
  }
  return 'settings.about.updateError'
}

function isUnpublishedReleaseError(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('not_published') || (/\b503\b/.test(message) && /latest\.yml|httperror|http error/i.test(message))
  )
}

// Main-only IPC->notification subscriber (twin of useStorageMonitorNotification):
// maps updater IPC events onto toasts, notifications, and the update dialog.
//
// Intentionally a React hook, not a service: service-ification was considered and
// rejected — it depends on React-visible state (useAppUpdateState cache, toast/popup)
// and manages its own effect cleanup, and the renderer has no service lifecycle
// container, so a service would only add manual start/stop wiring for no gain.
export function useAppUpdateHandler() {
  const { t } = useTranslation()
  const { appUpdateState, updateAppUpdateState } = useAppUpdateState()

  // Read the flag the click set synchronously. A ref copied in an effect is still
  // false when the updater event arrives before the next render.
  const manual = () => appUpdateCheckService.isManualUpdateCheck() || appUpdateState.manualCheck

  useIpcOn('app.updater.run_check', () => {
    void appUpdateCheckService.runAppUpdateCheck(appUpdateState, updateAppUpdateState).catch(() => {
      appUpdateCheckService.setUpdateNotice('settings.about.updateError')
    })
  })

  useIpcOn('app.updater.not_available', () => {
    if (!appUpdateCheckService.isActiveUpdateSession()) return
    const wasManual = manual()
    appUpdateCheckService.endManualUpdateCheck()
    updateAppUpdateState({ checking: false, manualCheck: false })
    if (wasManual) {
      appUpdateCheckService.setUpdateNotice('settings.about.updateNotAvailable')
      toast.success(t('settings.about.updateNotAvailable'))
    }
  })

  useIpcOn('app.updater.available', (releaseInfo) => {
    if (!appUpdateCheckService.isActiveUpdateSession()) return
    appUpdateCheckService.markUpdateDownloading(releaseInfo)
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
    if (!appUpdateCheckService.isActiveUpdateSession()) return
    appUpdateCheckService.markUpdateProgress()
    updateAppUpdateState({
      downloading: progress.percent < 100,
      downloadProgress: progress.percent
    })
  })

  useIpcOn('app.updater.downloaded', (releaseInfo) => {
    if (!appUpdateCheckService.isActiveUpdateSession()) return
    const wasManual = manual()
    appUpdateCheckService.markUpdateDownloaded(releaseInfo)
    updateAppUpdateState({
      downloading: false,
      info: releaseInfo,
      downloaded: true
    })
    // Manual downloads confirm through the shared presenter. It keeps the dialog lazy and
    // refuses a release whose session changed while that chunk was still loading.
    if (wasManual) {
      void appUpdateCheckService.presentDownloadedUpdate(releaseInfo)
    }
  })

  useIpcOn('app.updater.error', (error) => {
    if (!appUpdateCheckService.isActiveUpdateSession()) return
    const wasManual = manual()
    appUpdateCheckService.endManualUpdateCheck()
    updateAppUpdateState({
      checking: false,
      downloading: false,
      downloadProgress: 0,
      manualCheck: false
    })
    // AppUpdaterService broadcasts updater failures instead of rejecting the check IPC.
    // The notice sits on the check control. A toast is not a second error dialog.
    if (wasManual) {
      const key = getManualUpdateErrorMessageKey(error)
      appUpdateCheckService.setUpdateNotice(key)
      toast.error({ title: t(key), data: { suppressDetail: true } })
    }
  })

  useEffect(() => {
    void ipcApi.request('app.surface.receiver', { kind: 'update', ready: true }).catch((error) => {
      logger.error('Failed to register the main update receiver', error as Error)
    })
    return () => {
      void ipcApi.request('app.surface.receiver', { kind: 'update', ready: false }).catch(() => undefined)
    }
  }, [])
}
