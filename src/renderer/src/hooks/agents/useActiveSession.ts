import { useRuntime } from '../useRuntime'
import { useSession } from './useSession'

export const useActiveSession = () => {
  const { chat } = useRuntime()
  const { activeSessionIdMap, activeAgentId } = chat
  const activeSessionId = activeAgentId ? activeSessionIdMap[activeAgentId] : null
  return useSession(activeAgentId, activeSessionId)
}
