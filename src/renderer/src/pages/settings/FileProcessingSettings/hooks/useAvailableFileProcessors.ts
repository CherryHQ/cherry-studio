import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'
import { useEffect, useState } from 'react'

export function useAvailableFileProcessors(): ReadonlySet<FileProcessorId> | null {
  const [availableProcessorIds, setAvailableProcessorIds] = useState<ReadonlySet<FileProcessorId> | null>(null)

  useEffect(() => {
    let mounted = true

    window.api.fileProcessing
      .listAvailableProcessors()
      .then(({ processorIds }) => {
        if (mounted) {
          setAvailableProcessorIds(new Set(processorIds))
        }
      })
      .catch(() => {
        if (mounted) {
          setAvailableProcessorIds(null)
        }
      })

    return () => {
      mounted = false
    }
  }, [])

  return availableProcessorIds
}
