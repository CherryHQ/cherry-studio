import { useCache } from '@renderer/data/hooks/useCache'

import { useSession } from './useSession'

export const useActiveSession = () => {
  const [activeAgentId] = useCache('agent.active_id')
  const [activeSessionIdMap] = useCache('agent.session.active_id_map')
  const activeSessionId = activeAgentId ? activeSessionIdMap[activeAgentId] : null
  return useSession(activeAgentId, activeSessionId)
}
