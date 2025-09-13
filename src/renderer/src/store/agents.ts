import { loggerService } from '@logger'
import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { DEFAULT_CONTEXTCOUNT, DEFAULT_TEMPERATURE } from '@renderer/config/constant'
import { AgentEntity, AssistantPreset, AssistantSettings } from '@renderer/types'
import { cloneDeep, mergeWith } from 'lodash'

const logger = loggerService.withContext('Agents')
export interface AgentsState {
  /** They are actually assistant presets.
   * They should not be in this slice. However, since redux will be removed
   * in the future, I just don't care where should they are.  */
  agents: AssistantPreset[]
  /** For new autonomous agent feature. They are actual agent entities. */
  agentsNew: AgentEntity[]
}

const initialState: AgentsState = {
  agents: [],
  agentsNew: []
}

const assistantsSlice = createSlice({
  name: 'agents',
  initialState,
  reducers: {
    setAssistantPresets: (state, action: PayloadAction<AssistantPreset[]>) => {
      state.agents = action.payload
    },
    addAssistantPreset: (state, action: PayloadAction<AssistantPreset>) => {
      state.agents.push(action.payload)
    },
    removeAssistantPreset: (state, action: PayloadAction<{ id: string }>) => {
      state.agents = state.agents.filter((c) => c.id !== action.payload.id)
    },
    updateAssistantPreset: (state, action: PayloadAction<AssistantPreset>) => {
      state.agents = state.agents.map((c) => (c.id === action.payload.id ? action.payload : c))
    },
    updateAssistantPresetSettings: (
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
    },
    setAgents: (state, action: PayloadAction<AgentEntity[]>) => {
      state.agentsNew = action.payload
    },
    addAgent: (state, action: PayloadAction<AgentEntity>) => {
      state.agentsNew.push(action.payload)
    },
    removeAgent: (state, action: PayloadAction<{ id: string }>) => {
      state.agentsNew = state.agentsNew.filter((agent) => agent.id !== action.payload.id)
    },
    updateAgent: (state, action: PayloadAction<Partial<AgentEntity> & { id: string }>) => {
      const { id, ...update } = action.payload
      const agent = state.agentsNew.find((agent) => agent.id === id)
      if (agent) {
        mergeWith(agent, update, (_, srcVal) => {
          // cut reference
          if (Array.isArray(srcVal)) return cloneDeep(srcVal)
          else return undefined
        })
      } else {
        logger.warn('Agent not found when trying to update')
      }
    }
  }
})

export const {
  setAssistantPresets,
  addAssistantPreset,
  removeAssistantPreset,
  updateAssistantPreset,
  updateAssistantPresetSettings,
  setAgents,
  addAgent,
  removeAgent,
  updateAgent
} = assistantsSlice.actions

export default assistantsSlice.reducer
