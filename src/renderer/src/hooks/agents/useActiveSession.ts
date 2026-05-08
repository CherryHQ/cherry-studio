import { useCache } from '@renderer/data/hooks/useCache'
import { useCallback } from 'react'

import { useSession } from './useSessionDataApi'

/**
 * Reads the single active-session pointer and returns the resolved session.
 * Active agent is derived from `session.agentId` — see {@link useActiveAgent}.
 */
export const useActiveSession = () => {
  const [activeSessionId, setActiveSessionIdAction] = useCache('agent.active_session_id')
  const setActiveSessionId = useCallback(
    (id: string | null) => setActiveSessionIdAction(id),
    [setActiveSessionIdAction]
  )
  const result = useSession(null, activeSessionId)
  return { ...result, activeSessionId, setActiveSessionId }
}
