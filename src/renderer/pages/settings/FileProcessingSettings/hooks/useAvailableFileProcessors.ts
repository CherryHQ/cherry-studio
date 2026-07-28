import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'
import { useEffect, useState } from 'react'

const logger = loggerService.withContext('useAvailableFileProcessors')

export type AvailableFileProcessorsState = {
  processorIds: ReadonlySet<FileProcessorId>
  status: 'loading' | 'ready' | 'error'
}

export function useAvailableFileProcessors(): AvailableFileProcessorsState {
  const [availableProcessors, setAvailableProcessors] = useState<AvailableFileProcessorsState>(() => ({
    processorIds: new Set(),
    status: 'loading'
  }))

  useEffect(() => {
    let mounted = true

    ipcApi
      .request('file_processing.list_available_processors')
      .then(({ processorIds }) => {
        if (mounted) {
          setAvailableProcessors({
            processorIds: new Set(processorIds),
            status: 'ready'
          })
        }
      })
      .catch((error) => {
        logger.warn('Failed to list available file processors', error as Error)
        if (mounted) {
          setAvailableProcessors({
            processorIds: new Set(),
            status: 'error'
          })
        }
      })

    return () => {
      mounted = false
    }
  }, [])

  return availableProcessors
}
