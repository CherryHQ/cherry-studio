import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import RestoreV2Popup from '@renderer/pages/settings/DataSettings/RestoreV2Popup'
import { useEffect } from 'react'

const logger = loggerService.withContext('useRestoreOutcomeDisclosure')

let restoreOutcomeCheckStarted = false

/**
 * Proactively disclose a terminal restore outcome once per main-window load.
 *
 * The restore popup re-queries the durable journal and owns acknowledgement, so
 * this startup check only decides whether to open it. Pending restores stay out:
 * their pre-relaunch summary is not durable yet and must not be shown as empty.
 */
export function useRestoreOutcomeDisclosure(): void {
  useEffect(() => {
    if (restoreOutcomeCheckStarted) return
    restoreOutcomeCheckStarted = true

    void ipcApi
      .request('backup.restore_status')
      .then((status) => {
        if (status.state === 'none' || status.state === 'pending') return
        void RestoreV2Popup.show()
      })
      .catch((error) => logger.warn('backup.restore_status startup query failed', error as Error))
  }, [])
}
