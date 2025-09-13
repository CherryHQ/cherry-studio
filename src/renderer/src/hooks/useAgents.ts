import { useAppDispatch, useAppSelector } from '@renderer/store'
import { addAgent, removeAgent, updateAgent, updateAgents, updateAgentSettings } from '@renderer/store/agents'
import { AssistantPreset, AssistantSettings } from '@renderer/types'

export function useAgents() {
  const agents = useAppSelector((state) => state.agents.agents)
  const dispatch = useAppDispatch()

  return {
    agents,
    updateAgents: (agents: AssistantPreset[]) => dispatch(updateAgents(agents)),
    addAgent: (agent: AssistantPreset) => dispatch(addAgent(agent)),
    removeAgent: (id: string) => dispatch(removeAgent({ id }))
  }
}

export function useAgent(id: string) {
  const agent = useAppSelector((state) => state.agents.agents.find((a) => a.id === id) as AssistantPreset)
  const dispatch = useAppDispatch()

  return {
    agent,
    updateAgent: (agent: AssistantPreset) => dispatch(updateAgent(agent)),
    updateAgentSettings: (settings: Partial<AssistantSettings>) => {
      dispatch(updateAgentSettings({ assistantId: agent.id, settings }))
    }
  }
}
