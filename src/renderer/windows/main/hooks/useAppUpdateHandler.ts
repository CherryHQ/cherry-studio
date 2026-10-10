import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { useAppUpdateState } from '@renderer/hooks/useAppUpdateState'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { notificationService } from '@renderer/services/notification'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { uuid } from '@renderer/utils/uuid'
import type { UpdateSnapshot } from '@shared/ipc/schemas/updater'

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
  // notificationService is imported as a module-level singleton
  const manualCheckRef = useRef(appUpdateState.manualCheck)
  useEffect(() => {
    let active = true
    let last: UpdateSnapshot | null = null
    const apply = (snapshot: UpdateSnapshot) => {
      if (!active || (last?.sessionId === snapshot.sessionId && snapshot.revision <= last.revision)) return
      const restoreFailure = !last && snapshot.error === 'UPDATE_NOT_APPLIED'
      last = snapshot
      updateAppUpdateState({
        info: snapshot.release,
        checking: snapshot.phase === 'checking',
        downloading: snapshot.phase === 'downloading' || snapshot.phase === 'cancelling',
        downloaded: snapshot.phase === 'ready',
        available: snapshot.release !== null,
        downloadProgress: snapshot.percent ?? 0
      })
      if (restoreFailure) {
        void notificationService.send({
          id: `update-recovery-${snapshot.sessionId}`,
          type: 'warning',
          title: t('settings.about.updateError'),
          message: t('settings.about.updateError'),
          timestamp: Date.now(),
          source: 'update'
        })
      }
    }
    const unsubscribe = ipcApi.on('app.updater.state_changed', apply)
    void ipcApi
      .request('app.updater.get_state')
      .then(apply)
      .catch((error) => {
        if (active) logger.warn('Could not restore update state', error as Error)
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [t, updateAppUpdateState])

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
        content: t(getManualUpdateErrorMessageKey(error)),
        icon: null
      })
    }
  })
}
