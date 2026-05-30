import type { AgentType, Tool } from '@renderer/types'
import useSWR from 'swr'

export const useAgentTools = (type: AgentType = 'claude-code', mcps: string[] = []) => {
  const { data, error, isLoading } = useSWR(['agent-tools', type, mcps] as const, ([, agentType, mcpIds]) =>
    window.api.agent.listTools({ type: agentType, mcps: mcpIds }).then((tools) => tools as Tool[])
  )

  return { tools: data ?? [], error, isLoading }
}
