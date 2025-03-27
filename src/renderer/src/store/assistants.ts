import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { DEFAULT_CONTEXTCOUNT, DEFAULT_TEMPERATURE } from '@renderer/config/constant'
import { TopicManager } from '@renderer/hooks/useTopic'
import { getDefaultAssistant, getDefaultTopic } from '@renderer/services/AssistantService'
import { Assistant, AssistantGroup, AssistantSettings, Model, Topic } from '@renderer/types'
import { isEmpty, uniqBy } from 'lodash'

export interface AssistantsState {
  defaultAssistant: Assistant
  assistants: Assistant[]
  groups: AssistantGroup[]
  isLoading: boolean
  loadingError: Error | null
}

const initialState: AssistantsState = {
  defaultAssistant: getDefaultAssistant(),
  assistants: [getDefaultAssistant()],
  groups: [],
  isLoading: false,
  loadingError: null
}

const assistantsSlice = createSlice({
  name: 'assistants',
  initialState,
  reducers: {
    updateDefaultAssistant: (state, action: PayloadAction<{ assistant: Assistant }>) => {
      state.defaultAssistant = action.payload.assistant
    },
    updateAssistants: (state, action: PayloadAction<Assistant[]>) => {
      state.assistants = action.payload
    },
    addAssistant: (state, action: PayloadAction<Assistant>) => {
      state.assistants.push(action.payload)
    },
    removeAssistant: (state, action: PayloadAction<{ id: string }>) => {
      state.assistants = state.assistants.filter((assistant) => assistant.id !== action.payload.id)
    },
    updateAssistant: (state, action: PayloadAction<Assistant>) => {
      state.assistants = state.assistants.map((c) => (c.id === action.payload.id ? action.payload : c))
    },
    updateAssistantSettings: (
      state,
      action: PayloadAction<{ assistantId: string; settings: Partial<AssistantSettings> }>
    ) => {
      for (const assistant of state.assistants) {
        const settings = action.payload.settings
        if (assistant.id === action.payload.assistantId) {
          for (const key in settings) {
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
            assistant.settings[key] = settings[key]
          }
        }
      }
    },
    addTopic: (state, action: PayloadAction<{ assistantId: string; topic: Topic }>) => {
      const topic = action.payload.topic
      topic.createdAt = topic.createdAt || new Date().toISOString()
      topic.updatedAt = topic.updatedAt || new Date().toISOString()
      state.assistants = state.assistants.map((assistant) =>
        assistant.id === action.payload.assistantId
          ? {
              ...assistant,
              topics: uniqBy([topic, ...assistant.topics], 'id')
            }
          : assistant
      )
    },
    removeTopic: (state, action: PayloadAction<{ assistantId: string; topic: Topic }>) => {
      state.assistants = state.assistants.map((assistant) =>
        assistant.id === action.payload.assistantId
          ? {
              ...assistant,
              topics: assistant.topics.filter(({ id }) => id !== action.payload.topic.id)
            }
          : assistant
      )
    },
    updateTopic: (state, action: PayloadAction<{ assistantId: string; topic: Topic }>) => {
      const newTopic = action.payload.topic
      newTopic.updatedAt = new Date().toISOString()
      state.assistants = state.assistants.map((assistant) =>
        assistant.id === action.payload.assistantId
          ? {
              ...assistant,
              topics: assistant.topics.map((topic) => {
                const _topic = topic.id === newTopic.id ? newTopic : topic
                _topic.messages = []
                return _topic
              })
            }
          : assistant
      )
    },
    updateTopics: (state, action: PayloadAction<{ assistantId: string; topics: Topic[] }>) => {
      state.assistants = state.assistants.map((assistant) =>
        assistant.id === action.payload.assistantId
          ? {
              ...assistant,
              topics: action.payload.topics.map((topic) =>
                isEmpty(topic.messages) ? topic : { ...topic, messages: [] }
              )
            }
          : assistant
      )
    },
    removeAllTopics: (state, action: PayloadAction<{ assistantId: string }>) => {
      state.assistants = state.assistants.map((assistant) => {
        if (assistant.id === action.payload.assistantId) {
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
      state.assistants = state.assistants.map((assistant) =>
        assistant.id === action.payload.assistantId
          ? {
              ...assistant,
              model: action.payload.model
            }
          : assistant
      )
    },
    addGroup: (state, action: PayloadAction<AssistantGroup>) => {
      state.groups.push(action.payload)
    },
    updateGroup: (state, action: PayloadAction<AssistantGroup>) => {
      const index = state.groups.findIndex((g) => g.id === action.payload.id)
      if (index !== -1) {
        state.groups[index] = action.payload
      }
    },
    removeGroup: (state, action: PayloadAction<string>) => {
      state.groups = state.groups.filter((g) => g.id !== action.payload)
      state.assistants = state.assistants.map((assistant) => {
        if (assistant.groupId === action.payload) {
          return { ...assistant, groupId: undefined }
        }
        return assistant
      })
    },
    updateAssistantGroup: (state, action: PayloadAction<{ assistantId: string; groupId?: string }>) => {
      state.assistants = state.assistants.map((assistant) => {
        if (assistant.id === action.payload.assistantId) {
          return { ...assistant, groupId: action.payload.groupId }
        }
        return assistant
      })
    },
    updateGroupsOrder: (state, action: PayloadAction<AssistantGroup[]>) => {
      state.groups = action.payload
    },
    updateTopicGroup: (state, action: PayloadAction<{ assistantId: string; topicId: string; groupId?: string }>) => {
      console.log('updateTopicGroup被调用:', action.payload)

      const { assistantId, topicId, groupId } = action.payload

      // 查找对应的助手
      const assistantIndex = state.assistants.findIndex((assistant) => assistant.id === assistantId)

      if (assistantIndex >= 0) {
        console.log('找到助手:', state.assistants[assistantIndex].name)

        // 查找对应的topic
        const topicIndex = state.assistants[assistantIndex].topics.findIndex((topic) => topic.id === topicId)

        if (topicIndex >= 0) {
          console.log('找到topic:', state.assistants[assistantIndex].topics[topicIndex].name)

          // 更新groupId
          state.assistants[assistantIndex].topics[topicIndex].groupId = groupId
          console.log('更新groupId成功')
        } else {
          console.log('未找到对应的topic')
        }
      } else {
        console.log('未找到对应的助手')
      }
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
  updateGroupsOrder,
  updateTopicGroup
} = assistantsSlice.actions

export default assistantsSlice.reducer
