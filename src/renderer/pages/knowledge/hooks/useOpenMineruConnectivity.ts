import { useEffect, useState } from 'react'

import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'

const logger = loggerService.withContext('useOpenMineruConnectivity')

export type OpenMineruConnectivityState = {
  reachable: boolean
  /** False until the probe answers. Callers must not allow a new selection before this. */
  isResolved: boolean
}

/** Probe the configured Open MinerU host once per mount. */
export function useOpenMineruConnectivity(): OpenMineruConnectivityState {
  const [state, setState] = useState<OpenMineruConnectivityState>(() => ({ reachable: false, isResolved: false }))

  useEffect(() => {
    let mounted = true
    setState({ reachable: false, isResolved: false })

    ipcApi
      .request('file_processing.open_mineru.check_connectivity')
      .then((reachable) => {
        if (mounted) {
          setState({ reachable, isResolved: true })
        }
      })
      .catch((error) => {
        // The route answers false for an unreachable host, so a rejection means the
        // probe itself broke. Do not block a configured deployment without evidence.
        logger.warn('Failed to probe Open MinerU connectivity', error as Error)
        if (mounted) {
          setState({ reachable: true, isResolved: true })
        }
      })

    return () => {
      mounted = false
    }
  }, [])

  return state
}
