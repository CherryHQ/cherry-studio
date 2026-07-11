import { loggerService } from '@logger'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import type { BinaryInstallStates } from '@shared/types/binary'
import { useEffect, useRef, useState } from 'react'

const logger = loggerService.withContext('useBinaryInstallStates')

/**
 * Live install activity map (tool name → installing/failed), owned by
 * BinaryManager in the main process. Hydrates on mount so a window opened
 * mid-install renders the right state, then follows broadcast updates.
 * "Installed" is not in here — derive it from `binary.resolve_tools`.
 */
export function useBinaryInstallStates(): BinaryInstallStates {
  const [states, setStates] = useState<BinaryInstallStates>({})
  // Broadcasts carry the full map, so once one has arrived the (older)
  // hydration snapshot must not overwrite it.
  const gotBroadcastRef = useRef(false)

  useIpcOn('binary.install_states_changed', (next) => {
    gotBroadcastRef.current = true
    setStates(next)
  })

  useEffect(() => {
    let cancelled = false
    ipcApi
      .request('binary.get_install_states')
      .then((snapshot) => {
        if (!cancelled && !gotBroadcastRef.current) setStates(snapshot)
      })
      .catch((error) => {
        logger.error('Failed to hydrate install states', error as Error)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return states
}
