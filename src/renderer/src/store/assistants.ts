import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { DEFAULT_CONTEXTCOUNT, DEFAULT_TEMPERATURE } from '@renderer/config/constant'
import { TopicManager } from '@renderer/hooks/useTopic'
import { getDefaultAssistant, getDefaultTopic } from '@renderer/services/AssistantService'
import { Assistant, AssistantGroup, AssistantSettings, Model, Topic } from '@renderer/types'
import { safeFilter, safeMap } from '@renderer/utils/safeArrayUtils'
import { uniqBy } from 'lodash'

export interface AssistantsState {
  defaultAssistant: Assistant
  assistants: Assistant[]
  groups: AssistantGroup[]
  isLoading: boolean
  loadingError: string | null
}

// 确保默认助手始终存在
const getInitialDefaultAssistant = (): Assistant => {
  try {
    return getDefaultAssistant()
  } catch (error) {
    console.error('获取默认助手失败:', error)
    // 提供一个基本的默认助手以防止错误
    return {
      id: 'default-fallback',
      name: '默认助手',
      description: '默认助手',
      prompt: '',
      topics: [],
      type: 'default',
      createTime: new Date().getTime(),
      updateTime: new Date().getTime(),
      model: 'gpt-3.5-turbo' as unknown as Model,
      settings: {
        temperature: DEFAULT_TEMPERATURE,
        contextCount: DEFAULT_CONTEXTCOUNT
      }
    }
  }
}

const initialState: AssistantsState = {
  defaultAssistant: getInitialDefaultAssistant(),
  assistants: [getInitialDefaultAssistant()], // 确保始终有至少一个助手
  groups: [],
  isLoading: false,
  loadingError: null
}

const assistantsSlice = createSlice({
  name: 'assistants',
  initialState,
  reducers: {
    setAssistantsLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload
      if (action.payload) {
        state.loadingError = null // 重置错误状态
      }
    },
    setAssistantsError: (state, action: PayloadAction<string | null>) => {
      state.loadingError = action.payload
      state.isLoading = false
    },
    updateDefaultAssistant: (state, action: PayloadAction<{ assistant: Assistant }>) => {
      state.defaultAssistant = action.payload.assistant
    },
    updateAssistants: (state, action: PayloadAction<Assistant[]>) => {
      state.assistants = action.payload || []
    },
    addAssistant: (state, action: PayloadAction<Assistant>) => {
      if (!state.assistants) {
        state.assistants = []
      }
      state.assistants.push(action.payload)
    },
    removeAssistant: (state, action: PayloadAction<{ id: string }>) => {
      if (!state.assistants) {
        state.assistants = []
        return
      }
      state.assistants = safeFilter(state.assistants, (c) => c.id !== action.payload.id)
    },
    updateAssistant: (state, action: PayloadAction<Assistant>) => {
      if (!state.assistants) {
        state.assistants = []
        return
      }
      state.assistants = safeMap(state.assistants, (c) => (c.id === action.payload.id ? action.payload : c))
    },
    updateAssistantSettings: (
      state,
      action: PayloadAction<{ assistantId: string; settings: Partial<AssistantSettings> }>
    ) => {
      if (!state.assistants) {
        state.assistants = []
        return
      }

      for (const assistant of state.assistants) {
        const settings = action.payload.settings
        if (assistant && assistant.id === action.payload.assistantId) {
          if (!assistant.settings) {
            assistant.settings = {
              temperature: DEFAULT_TEMPERATURE,
              contextCount: DEFAULT_CONTEXTCOUNT,
              enableMaxTokens: false,
              maxTokens: 0,
              streamOutput: true,
              hideMessages: false
            }
          }
          for (const key in settings) {
            assistant.settings[key] = settings[key]
          }
        }
      }
    },
    addTopic: (state, action: PayloadAction<{ assistantId: string; topic: Topic }>) => {
      if (!state.assistants) {
        state.assistants = []
        return
      }

      const topic = action.payload.topic
      topic.createdAt = topic.createdAt || new Date().toISOString()
      topic.updatedAt = topic.updatedAt || new Date().toISOString()

      state.assistants = safeMap(state.assistants, (assistant) =>
        assistant && assistant.id === action.payload.assistantId
          ? {
              ...assistant,
              topics: uniqBy([topic, ...(assistant.topics || [])], 'id')
            }
          : assistant
      )
    },
    removeTopic: (state, action: PayloadAction<{ assistantId: string; topic: Topic }>) => {
      if (!state.assistants) {
        state.assistants = []
        return
      }

      state.assistants = safeMap(state.assistants, (assistant) =>
        assistant && assistant.id === action.payload.assistantId
          ? {
              ...assistant,
              topics: safeFilter(assistant.topics, ({ id }) => id !== action.payload.topic.id)
            }
          : assistant
      )
    },
    updateTopic: (state, action: PayloadAction<{ assistantId: string; topic: Topic }>) => {
      if (!state.assistants) {
        state.assistants = []
        return
      }

      const newTopic = action.payload.topic
      newTopic.updatedAt = new Date().toISOString()

      state.assistants = safeMap(state.assistants, (assistant) =>
        assistant && assistant.id === action.payload.assistantId
          ? {
              ...assistant,
              topics: safeMap(assistant.topics, (topic) => (topic.id === newTopic.id ? newTopic : topic))
            }
          : assistant
      )
    },
    updateTopics: (state, action: PayloadAction<{ assistantId: string; topics: Topic[] }>) => {
      if (!state.assistants) {
        state.assistants = []
        return
      }

      state.assistants = safeMap(state.assistants, (assistant) =>
        assistant && assistant.id === action.payload.assistantId
          ? {
              ...assistant,
              topics: action.payload.topics
            }
          : assistant
      )
    },
    removeAllTopics: (state, action: PayloadAction<{ assistantId: string }>) => {
      if (!state.assistants) {
        state.assistants = []
        return
      }

      state.assistants = safeMap(state.assistants, (assistant) => {
        if (assistant && assistant.id === action.payload.assistantId) {
          assistant.topics.forEach((topic) => TopicManager.removeTopic(topic.id))
          return {
            ...assistant,
            topics: [getDefaultTopic(assistant.id)]
          }
        }
        return assistant
      })
    },
    setModel: (state, action: PayloadAction<{ assistantId: string; model: Model }>) => {
      if (!state.assistants) {
        state.assistants = []
        return
      }

      state.assistants = safeMap(state.assistants, (assistant) =>
        assistant && assistant.id === action.payload.assistantId
          ? {
              ...assistant,
              model: action.payload.model
            }
          : assistant
      )
    },
    addGroup: (state, action: PayloadAction<AssistantGroup>) => {
      if (!state.groups) {
        state.groups = []
      }
      state.groups.push(action.payload)
    },
    updateGroup: (state, action: PayloadAction<AssistantGroup>) => {
      if (!state.groups) {
        state.groups = []
        return
      }
      state.groups = safeMap(state.groups, (group) => (group.id === action.payload.id ? action.payload : group))
    },
    removeGroup: (state, action: PayloadAction<{ id: string }>) => {
      if (!state.assistants) {
        state.assistants = []
      }
      if (!state.groups) {
        state.groups = []
        return
      }

      state.assistants = safeMap(state.assistants, (assistant) =>
        assistant && assistant.groupId === action.payload.id ? { ...assistant, groupId: undefined } : assistant
      )

      state.groups = safeFilter(state.groups, (group) => group.id !== action.payload.id)
    },
    updateAssistantGroup: (state, action: PayloadAction<{ assistantId: string; groupId?: string }>) => {
      if (!state.assistants) {
        state.assistants = []
        return
      }

      state.assistants = safeMap(state.assistants, (assistant) =>
        assistant && assistant.id === action.payload.assistantId
          ? { ...assistant, groupId: action.payload.groupId }
          : assistant
      )
    }
  }
})

export const {
  updateDefaultAssistant,
  updateAssistants,
  addAssistant,
  removeAssistant,
  updateAssistant,
  addTopic,
  removeTopic,
  updateTopic,
  updateTopics,
  removeAllTopics,
  setModel,
  updateAssistantSettings,
  addGroup,
  updateGroup,
  removeGroup,
  updateAssistantGroup,
  setAssistantsLoading,
  setAssistantsError
} = assistantsSlice.actions

export default assistantsSlice.reducer
