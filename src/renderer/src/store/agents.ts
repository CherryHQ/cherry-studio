import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { DEFAULT_CONTEXTCOUNT, DEFAULT_TEMPERATURE } from '@renderer/config/constant'
import { AssistantPreset, AssistantSettings } from '@renderer/types'

export interface AgentsState {
  /** @deprecated They are actually assistant presets. */
  agents: AssistantPreset[]
}

const initialState: AgentsState = {
  agents: []
}

const assistantsSlice = createSlice({
  name: 'agents',
  initialState,
  reducers: {
    updateAgents: (state, action: PayloadAction<AssistantPreset[]>) => {
      state.agents = action.payload
    },
    addAgent: (state, action: PayloadAction<AssistantPreset>) => {
      state.agents.push(action.payload)
    },
    removeAgent: (state, action: PayloadAction<{ id: string }>) => {
      state.agents = state.agents.filter((c) => c.id !== action.payload.id)
    },
    updateAgent: (state, action: PayloadAction<AssistantPreset>) => {
      state.agents = state.agents.map((c) => (c.id === action.payload.id ? action.payload : c))
    },
    updateAgentSettings: (
      state,
      action: PayloadAction<{ assistantId: string; settings: Partial<AssistantSettings> }>
    ) => {
      for (const agent of state.agents) {
        const settings = action.payload.settings
        if (agent.id === action.payload.assistantId) {
          for (const key in settings) {
            if (!agent.settings) {
              agent.settings = {
                temperature: DEFAULT_TEMPERATURE,
                contextCount: DEFAULT_CONTEXTCOUNT,
                enableMaxTokens: false,
                maxTokens: 0,
                streamOutput: true
              }
            }
            agent.settings[key] = settings[key]
          }
        }
      }
    }
  }
})

export const { updateAgents, addAgent, removeAgent, updateAgent, updateAgentSettings } = assistantsSlice.actions

export default assistantsSlice.reducer
