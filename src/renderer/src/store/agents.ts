import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { DEFAULT_CONTEXTCOUNT, DEFAULT_TEMPERATURE } from '@renderer/config/constant'
import { AssistantPreset, AssistantSettings } from '@renderer/types'

// const logger = loggerService.withContext('Agents')
export interface AgentsState {
  /** They are actually assistant presets.
   * They should not be in this slice. However, since redux will be removed
   * in the future, I just don't care where should they are.  */
  agents: AssistantPreset[]
}

const initialState: AgentsState = {
  agents: []
}

const assistantsSlice = createSlice({
  name: 'agents',
  initialState,
  reducers: {
    setAssistantPresets: (state, action: PayloadAction<AssistantPreset[]>) => {
      const presets = action.payload
      state.agents = []
      presets.forEach((p) => {
        state.agents.push(p)
      })
    },
    addAssistantPreset: (state, action: PayloadAction<AssistantPreset>) => {
      // @ts-ignore ts-2589 false positive
      state.agents.push(action.payload)
    },
    removeAssistantPreset: (state, action: PayloadAction<{ id: string }>) => {
      state.agents = state.agents.filter((c) => c.id !== action.payload.id)
    },
    updateAssistantPreset: (state, action: PayloadAction<AssistantPreset>) => {
      const preset = action.payload
      state.agents.forEach((a) => {
        if (a.id === preset.id) {
          a = preset
        }
      })
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
    }
  }
})

export const {
  setAssistantPresets,
  addAssistantPreset,
  removeAssistantPreset,
  updateAssistantPreset,
  updateAssistantPresetSettings
} = assistantsSlice.actions

export default assistantsSlice.reducer
