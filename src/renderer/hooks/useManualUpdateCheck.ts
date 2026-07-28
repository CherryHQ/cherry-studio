import { useAppUpdateState } from '@renderer/hooks/useAppUpdateState'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'

const MANUAL_CHECK_THROTTLE_MS = 2_000

/**
 * The single renderer entry for a user-initiated update check. About Settings
 * and restore compatibility guidance share the same cache flags and updater IPC
 * flow, so notifications/download completion still belong to
 * `useAppUpdateHandler` rather than either page.
 */
export function useManualUpdateCheck() {
  const { t } = useTranslation()
  const { appUpdateState, updateAppUpdateState } = useAppUpdateState()
  const inFlightRef = useRef(false)
  const lastStartedAtRef = useRef(0)
  const { checking, downloaded, downloading, info } = appUpdateState

  const checkForUpdates = useCallback(async () => {
    const now = Date.now()
    if (inFlightRef.current || now - lastStartedAtRef.current < MANUAL_CHECK_THROTTLE_MS || checking || downloading) {
      return
    }
    lastStartedAtRef.current = now

    if (downloaded) {
      try {
        const { default: UpdateDialogPopup } = await import('@renderer/components/UpdateDialogPopup')
        void UpdateDialogPopup.show({ releaseInfo: info || null })
      } catch {
        toast.error(t('settings.about.updateError'))
      }
      return
    }

    inFlightRef.current = true
    updateAppUpdateState({ checking: true, manualCheck: true })
    try {
      await ipcApi.request('app.updater.check_for_update')
    } catch {
      updateAppUpdateState({ manualCheck: false })
      toast.error(t('settings.about.updateError'))
    } finally {
      inFlightRef.current = false
      updateAppUpdateState({ checking: false })
    }
  }, [checking, downloaded, downloading, info, t, updateAppUpdateState])

  return { appUpdateState, updateAppUpdateState, checkForUpdates }
}
