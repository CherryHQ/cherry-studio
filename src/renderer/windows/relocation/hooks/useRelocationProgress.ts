import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { RelocationProgress } from '@shared/types/relocation'
import { useCallback, useEffect, useState } from 'react'

const logger = loggerService.withContext('useRelocationProgress')

export function useRelocationProgress() {
  const [progress, setProgress] = useState<RelocationProgress | null>(null)

  useEffect(() => {
    let receivedProgressEvent = false
    const handleProgress = (data: RelocationProgress) => {
      receivedProgressEvent = true
      setProgress(data)
    }

    const unsubscribe = ipcApi.on('app.user_data_relocation.progress', handleProgress)
    ipcApi
      .request('app.user_data_relocation.get_progress')
      .then((initial) => {
        if (initial && !receivedProgressEvent) setProgress(initial)
      })
      .catch((error) => {
        logger.error('Failed to read initial userData relocation progress', error as Error)
      })

    return unsubscribe
  }, [])

  const restart = useCallback(() => {
    void ipcApi.request('app.user_data_relocation.restart').catch((error) => {
      logger.error('Failed to restart after userData relocation', error as Error)
    })
  }, [])

  return { progress, restart }
}
