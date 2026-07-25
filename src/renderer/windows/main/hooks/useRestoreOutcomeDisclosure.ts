import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import RestoreV2Popup from '@renderer/pages/settings/DataSettings/RestoreV2Popup'
import { useEffect } from 'react'

const logger = loggerService.withContext('useRestoreOutcomeDisclosure')

let restoreOutcomeCheckStarted = false

/** Open the restore popup once when startup finds durable restore state. */
export function useRestoreOutcomeDisclosure(): void {
  useEffect(() => {
    if (restoreOutcomeCheckStarted) return
    restoreOutcomeCheckStarted = true

    void ipcApi
      .request('backup.restore_status')
      .then((status) => {
        if (status.state === 'none') return
        void RestoreV2Popup.show()
      })
      .catch((error) => logger.warn('backup.restore_status startup query failed', error as Error))
  }, [])
}
