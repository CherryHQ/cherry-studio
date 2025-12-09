import { useCache } from '@renderer/data/hooks/useCache'

import { useAgent } from './useAgent'

export const useActiveAgent = () => {
  const [activeAgentId] = useCache('agent.active_id')
  return useAgent(activeAgentId)
}
