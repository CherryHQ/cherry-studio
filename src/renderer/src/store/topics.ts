import { createSelector, createSlice, PayloadAction } from '@reduxjs/toolkit'
import { TopicManager } from '@renderer/hooks/useTopic'
import { getDefaultTopic } from '@renderer/services/TopicService'
import type { AppDispatch, RootState } from '@renderer/store'
import { Topic } from '@renderer/types'
import { isEmpty, uniqBy } from 'lodash'

export interface TopicsState {
  topics: Topic[]
  activeTopic: Topic | null
}

const initialState: TopicsState = {
  topics: [getDefaultTopic()],
  activeTopic: null
}

const topicsSlice = createSlice({
  name: 'topics',
  initialState,
  reducers: {
    setAllTopics: (state, action: PayloadAction<Topic[]>) => {
      state.topics = action.payload
    },
    setActiveTopic: (state, action: PayloadAction<Topic | null>) => {
      state.activeTopic = action.payload
    },
    addTopic: (state, action: PayloadAction<{ topic: Topic; assistantId: string }>) => {
      const topic = {
        ...action.payload.topic,
        createdAt: action.payload.topic.createdAt || new Date().toISOString(),
        updatedAt: action.payload.topic.updatedAt || new Date().toISOString(),
        assistantId: action.payload.assistantId
      }
      state.topics = uniqBy([topic, ...state.topics], 'id')
    },
    removeTopic: (state, action: PayloadAction<string>) => {
      if (state.topics.length === 1) {
        state.topics = [
          {
            ...getDefaultTopic(),
            assistantId: state.topics[0].assistantId
          }
        ]
        state.activeTopic = state.topics[0]
        return
      }

      if (state.activeTopic?.id === action.payload) {
        const index = state.topics.findIndex(({ id }) => id === action.payload)
        state.activeTopic = state.topics[index + 1 === state.topics.length ? index - 1 : index + 1]
      }

      state.topics = state.topics.filter(({ id }) => id !== action.payload)
    },
    removeAssistantTopics: (state, action: PayloadAction<string>) => {
      state.topics = state.topics.filter((topic) => topic.assistantId !== action.payload)
      if (state.topics.length === 0) {
        state.topics = [getDefaultTopic()]
      }

      if (state.activeTopic?.assistantId === action.payload) {
        state.activeTopic = state.topics[0]
      }
    },
    switchAssistant: (state, action: PayloadAction<{ topicId: string; assistantId: string }>) => {
      const { topicId, assistantId } = action.payload
      const topic = state.topics.find(({ id }) => id === topicId)
      if (topic) {
        topic.assistantId = assistantId
        if (state.activeTopic?.id === topicId) {
          state.activeTopic.assistantId = assistantId
        }
      }
    },
    updateTopic: (state, action: PayloadAction<Topic>) => {
      const index = state.topics.findIndex((topic) => topic.id === action.payload.id)
      if (index !== -1) {
        state.topics[index] = {
          ...action.payload,
          updatedAt: new Date().toISOString(),
          messages: []
        }

        if (state.activeTopic && state.activeTopic.id === action.payload.id) {
          state.activeTopic = action.payload
        }
      }
    },
    updateTopics: (state, action: PayloadAction<Topic[]>) => {
      state.topics = action.payload.map((topic) => (isEmpty(topic.messages) ? topic : { ...topic, messages: [] }))
    }
  }
})

export const {
  setAllTopics,
  setActiveTopic,
  addTopic,
  removeTopic,
  removeAssistantTopics,
  switchAssistant,
  updateTopic,
  updateTopics
} = topicsSlice.actions

export const selectAllTopics = (state: RootState) => state.topics.topics
export const selectActiveTopic = (state: RootState) => state.topics.activeTopic
export const selectTopicsByAssistantId = createSelector(
  [selectAllTopics, (_, assistantId: string) => assistantId],
  (topics, assistantId) => topics.filter((topic) => topic.assistantId === assistantId)
)

export const removeTopicThunk = (topicId: string) => async (dispatch: AppDispatch) => {
  await TopicManager.removeTopic(topicId)
  dispatch(removeTopic(topicId))
}

export const removeAssistantTopicsThunk =
  (assistantId: string) => async (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState()
    const topicsToRemove = state.topics.topics.filter((topic: Topic) => topic.assistantId === assistantId)

    for (const topic of topicsToRemove) {
      await TopicManager.removeTopic(topic.id)
    }

    dispatch(removeAssistantTopics(assistantId))
  }

export default topicsSlice.reducer
