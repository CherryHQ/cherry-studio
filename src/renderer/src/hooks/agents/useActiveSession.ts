import { useRuntime } from '../useRuntime'
import { useSessions } from './useSessions'

export const useActiveSession = () => {
  const { chat } = useRuntime()
  const { activeSessionIdMap, activeAgentId } = chat
  const { sessions } = useSessions(activeAgentId)
  const activeSessionId = activeAgentId ? activeSessionIdMap[activeAgentId] : null
  const activeSession = sessions.find((s) => s.id === activeSessionId)
  return activeSession
}
