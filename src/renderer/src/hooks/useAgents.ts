import { useAppDispatch, useAppSelector } from '@renderer/store'
import { addAgent, removeAgent, updateAgent, updateAgents, updateAgentSettings } from '@renderer/store/agents'
import type { Agent, AssistantSettings } from '@renderer/types'

export function useAgents() {
  const agents = useAppSelector((state) => state.agents.agents)
  const dispatch = useAppDispatch()

  return {
    agents,
    updateAgents: (agents: Agent[]) => dispatch(updateAgents(agents)),
    addAgent: (agent: Agent) => dispatch(addAgent(agent)),
    removeAgent: (id: string) => dispatch(removeAgent({ id }))
  }
}

export function useAgent(id: string) {
  const agent = useAppSelector((state) => state.agents.agents.find((a) => a.id === id) as Agent)
  const dispatch = useAppDispatch()

  return {
    agent,
    updateAgent: (agent: Agent) => dispatch(updateAgent(agent)),
    updateAgentSettings: (settings: Partial<AssistantSettings>) => {
      dispatch(updateAgentSettings({ assistantId: agent.id, settings }))
    }
  }
}
