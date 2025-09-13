import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  addAssistantPreset,
  removeAssistantPreset,
  setAssistantPresets,
  updateAssistantPreset,
  updateAssistantPresetSettings
} from '@renderer/store/agents'
import { AssistantPreset, AssistantSettings } from '@renderer/types'

export function useAgents() {
  const agents = useAppSelector((state) => state.agents.agents)
  const dispatch = useAppDispatch()

  return {
    agents,
    setAgents: (agents: AssistantPreset[]) => dispatch(setAssistantPresets(agents)),
    addAgent: (agent: AssistantPreset) => dispatch(addAssistantPreset(agent)),
    removeAgent: (id: string) => dispatch(removeAssistantPreset({ id }))
  }
}

export function useAgent(id: string) {
  const agent = useAppSelector((state) => state.agents.agents.find((a) => a.id === id) as AssistantPreset)
  const dispatch = useAppDispatch()

  return {
    agent,
    updateAgent: (agent: AssistantPreset) => dispatch(updateAssistantPreset(agent)),
    updateAgentSettings: (settings: Partial<AssistantSettings>) => {
      dispatch(updateAssistantPresetSettings({ assistantId: agent.id, settings }))
    }
  }
}
