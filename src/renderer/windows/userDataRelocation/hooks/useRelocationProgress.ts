import { loggerService } from '@logger'
import { type RelocationProgress, UserDataRelocationIpcChannels } from '@shared/types/userDataRelocation'
import { useCallback, useEffect, useState } from 'react'

const logger = loggerService.withContext('useRelocationProgress')

export function useRelocationProgress() {
  const [progress, setProgress] = useState<RelocationProgress | null>(null)

  useEffect(() => {
    let receivedProgressEvent = false
    const handleProgress = (_event: unknown, data: RelocationProgress) => {
      receivedProgressEvent = true
      setProgress(data)
    }

    const unsubscribe = window.electron.ipcRenderer.on(UserDataRelocationIpcChannels.Progress, handleProgress)
    window.electron.ipcRenderer
      .invoke(UserDataRelocationIpcChannels.GetProgress)
      .then((initial: RelocationProgress | null) => {
        if (initial && !receivedProgressEvent) setProgress(initial)
      })
      .catch((error) => {
        logger.error('Failed to read initial userData relocation progress', error as Error)
      })

    return unsubscribe
  }, [])

  const restart = useCallback(() => {
    void window.electron.ipcRenderer.invoke(UserDataRelocationIpcChannels.Restart).catch((error) => {
      logger.error('Failed to restart after userData relocation', error as Error)
    })
  }, [])

  return { progress, restart }
}
