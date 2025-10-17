import { useRuntime } from '../useRuntime'
import { useAgent } from './useAgent'

export const useActiveAgent = () => {
  const { chat } = useRuntime()
  const { activeAgentId } = chat
  return useAgent(activeAgentId)
}
