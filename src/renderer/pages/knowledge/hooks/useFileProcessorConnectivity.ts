import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
import { useEffect, useState } from 'react'

const logger = loggerService.withContext('useFileProcessorConnectivity')

export type FileProcessorConnectivityState = {
  reachable: boolean
  /** False until the probe answers. Callers must not render a verdict before this. */
  isResolved: boolean
}

/**
 * Probe whether a self-hosted processor's server is up, once per mount.
 *
 * Starts optimistic (`reachable: true`) so a working deployment never flickers
 * through a disabled state on the way to being offered; `isResolved` is what
 * callers gate the verdict on.
 *
 * The result is not refreshed — a user who starts their server while the panel is
 * open reopens it to be seen again, which is cheap enough not to justify polling.
 */
export function useFileProcessorConnectivity(
  processorId: FileProcessorId,
  feature: FileProcessorFeature
): FileProcessorConnectivityState {
  const [state, setState] = useState<FileProcessorConnectivityState>(() => ({ reachable: true, isResolved: false }))

  useEffect(() => {
    let mounted = true
    setState({ reachable: true, isResolved: false })

    ipcApi
      .request('file_processing.processor.check_connectivity', { processorId, feature })
      .then((reachable) => {
        if (mounted) {
          setState({ reachable, isResolved: true })
        }
      })
      .catch((error) => {
        // The route answers false for an unreachable host, so a rejection means the
        // probe itself broke. Resolve as reachable: we have no evidence the server is
        // down, and blocking selection on our own bug would be the worse failure.
        logger.warn('Failed to probe file processor connectivity', error as Error)
        if (mounted) {
          setState({ reachable: true, isResolved: true })
        }
      })

    return () => {
      mounted = false
    }
  }, [feature, processorId])

  return state
}
