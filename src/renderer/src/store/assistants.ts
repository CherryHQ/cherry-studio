import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { createSelector } from '@reduxjs/toolkit'
import { DEFAULT_CONTEXTCOUNT, DEFAULT_TEMPERATURE } from '@renderer/config/constant'
import { getDefaultAssistant } from '@renderer/services/AssistantService'
import { Assistant, AssistantSettings, Model } from '@renderer/types'

export interface AssistantsState {
  defaultAssistant: Assistant
  assistants: Assistant[]
  tagsOrder: string[]
}

const initialState: AssistantsState = {
  defaultAssistant: getDefaultAssistant(), // 这个是模型设置的默认助手
  assistants: [getDefaultAssistant()], // 这个是主页列表的默认助手
  tagsOrder: []
}

// ----------- selectors -----------
// 基础selector
export const selectAssistantsState = (state: { assistants: AssistantsState }) => state.assistants

// 获取所有助手（不含模板）
export const selectActiveAssistants = createSelector(selectAssistantsState, (state) =>
  state.assistants.filter((a) => !a.isTemplate)
)

// 获取所有模板
export const selectTemplates = createSelector(selectAssistantsState, (state) =>
  state.assistants.filter((a) => a.isTemplate)
)

// 通过id查找助手（不含模板）
export const selectAssistantById = (id: string) =>
  createSelector(selectActiveAssistants, (assistants) => assistants.find((a) => a.id === id))

// 通过id查找模板
export const selectTemplateById = (id: string) =>
  createSelector(selectTemplates, (templates) => templates.find((a) => a.id === id))

// ----------- end selectors -----------

const assistantsSlice = createSlice({
  name: 'assistants',
  initialState,
  reducers: {
    updateDefaultAssistant: (state, action: PayloadAction<{ assistant: Assistant }>) => {
      const assistant = action.payload.assistant
      state.defaultAssistant = assistant
    },
    updateAssistants: (state, action: PayloadAction<Assistant[]>) => {
      const assistants = action.payload
      const templates = assistants.filter((a) => a.isTemplate)
      state.assistants = [...assistants.filter((a) => !a.isTemplate), ...templates]
    },
    updateTemplates: (state, action: PayloadAction<Assistant[]>) => {
      const templates = action.payload
      const assistants = state.assistants.filter((a) => !a.isTemplate)
      state.assistants = [...assistants, ...templates]
    },
    addAssistant: (state, action: PayloadAction<Assistant>) => {
      state.assistants.push(action.payload)
    },
    removeAssistant: (state, action: PayloadAction<{ id: string }>) => {
      state.assistants = state.assistants.filter((c) => c.id !== action.payload.id)
    },
    updateAssistant: (state, action: PayloadAction<Assistant>) => {
      const assistant = action.payload
      state.assistants = state.assistants.map((c) => (c.id === assistant.id ? assistant : c))
    },
    updateAssistantSettings: (
      state,
      action: PayloadAction<{ assistantId: string; settings: Partial<AssistantSettings> }>
    ) => {
      const { assistantId, settings } = action.payload
      for (const assistant of state.assistants) {
        if (assistant.id === assistantId) {
          for (const key in settings) {
            if (!assistant.settings) {
              assistant.settings = {
                temperature: DEFAULT_TEMPERATURE,
                contextCount: DEFAULT_CONTEXTCOUNT,
                enableMaxTokens: false,
                maxTokens: 0,
                streamOutput: true
              }
            }
            assistant.settings[key] = settings[key]
          }
        }
      }
    },
    setModel: (state, action: PayloadAction<{ assistantId: string; model: Model }>) => {
      const { assistantId, model } = action.payload
      for (let i = 0; i < state.assistants.length; i++) {
        if (state.assistants[i].id === assistantId) {
          state.assistants[i] = {
            ...state.assistants[i],
            model: model
          }
          break
        }
      }
    },
    // 从模板创建助手
    createAssistantFromTemplate: (state, action: PayloadAction<{ templateId: string; assistantId: string }>) => {
      const { templateId, assistantId } = action.payload
      const template = state.assistants.find((t) => t.id === templateId && t.isTemplate)
      if (template) {
        const newAssistant: Assistant = {
          ...template,
          id: assistantId,
          isTemplate: false
        }
        state.assistants.push(newAssistant)
      }
    },
    setTagsOrder: (state, action: PayloadAction<string[]>) => {
      state.tagsOrder = action.payload
    }
  }
})

export const {
  updateDefaultAssistant,
  updateAssistants,
  addAssistant,
  removeAssistant,
  updateAssistant,
  createAssistantFromTemplate,
  setModel,
  setTagsOrder,
  updateAssistantSettings
} = assistantsSlice.actions

export default assistantsSlice.reducer
