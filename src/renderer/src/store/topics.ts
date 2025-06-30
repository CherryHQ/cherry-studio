import { createEntityAdapter, createSlice, EntityState, PayloadAction } from '@reduxjs/toolkit'
// --- Selectors ---
import { createSelector } from '@reduxjs/toolkit'
import { TopicManager } from '@renderer/hooks/useTopic'
import { getDefaultTopic } from '@renderer/services/AssistantService'
import { Topic } from '@renderer/types'

import type { RootState } from './index'

// 1. Create the Adapter
const topicsAdapter = createEntityAdapter<Topic>()

// 2. Define the State Interface
export interface TopicsState extends EntityState<Topic, string> {
  topicIdsByAssistant: Record<string, string[]> // Map: assistantId -> ordered topic IDs
}

// Create default topic for default assistant
const defaultTopic = getDefaultTopic('default')

// 3. Define the Initial State with default topic
const initialState: TopicsState = topicsAdapter.getInitialState(
  {
    topicIdsByAssistant: {
      default: [defaultTopic.id] // Default assistant has default topic
    }
  },
  {
    [defaultTopic.id]: defaultTopic // Add default topic to entities
  }
)

// Payload types
export interface TopicsReceivedPayload {
  assistantId: string
  topics: Topic[]
}

export interface AddTopicPayload {
  assistantId: string
  topic: Topic
}

export interface RemoveTopicPayload {
  assistantId: string
  topicId: string
}

export interface UpdateTopicPayload {
  assistantId: string
  topic: Topic
}

export interface MoveTopicPayload {
  fromAssistantId: string
  toAssistantId: string
  topicId: string
}

// 4. Create the Slice
const topicsSlice = createSlice({
  name: 'topics',
  initialState,
  reducers: {
    topicsReceived(state, action: PayloadAction<TopicsReceivedPayload>) {
      const { assistantId, topics } = action.payload
      topicsAdapter.upsertMany(state, topics)
      state.topicIdsByAssistant[assistantId] = topics.map((t) => t.id)
    },
    addTopic(state, action: PayloadAction<AddTopicPayload>) {
      const { assistantId, topic } = action.payload
      const topicWithTimestamp = {
        ...topic,
        createdAt: topic.createdAt || new Date().toISOString(),
        updatedAt: topic.updatedAt || new Date().toISOString()
      }

      topicsAdapter.addOne(state, topicWithTimestamp)

      if (!state.topicIdsByAssistant[assistantId]) {
        state.topicIdsByAssistant[assistantId] = []
      }
      // Add to the beginning to match original behavior
      state.topicIdsByAssistant[assistantId].unshift(topic.id)
    },
    removeTopic(state, action: PayloadAction<RemoveTopicPayload>) {
      const { assistantId, topicId } = action.payload

      topicsAdapter.removeOne(state, topicId)

      const currentTopicIds = state.topicIdsByAssistant[assistantId]
      if (currentTopicIds) {
        state.topicIdsByAssistant[assistantId] = currentTopicIds.filter((id) => id !== topicId)
      }

      // Remove topic from database
      TopicManager.removeTopic(topicId)
    },
    updateTopic(state, action: PayloadAction<UpdateTopicPayload>) {
      const { topic } = action.payload
      const updatedTopic = {
        ...topic,
        updatedAt: new Date().toISOString()
      }

      topicsAdapter.updateOne(state, {
        id: topic.id,
        changes: { ...updatedTopic, messages: [] } // Clear messages in redux to match original behavior
      })
    },
    updateTopics(state, action: PayloadAction<TopicsReceivedPayload>) {
      const { assistantId, topics } = action.payload

      const topicsWithoutMessages = topics.map((topic) => ({
        ...topic,
        messages: [] // Clear messages in redux
      }))

      topicsAdapter.upsertMany(state, topicsWithoutMessages)
      state.topicIdsByAssistant[assistantId] = topics.map((t) => t.id)
    },
    removeAllTopics(state, action: PayloadAction<{ assistantId: string }>) {
      const { assistantId } = action.payload
      const topicIds = state.topicIdsByAssistant[assistantId] || []

      // Remove topics from database
      topicIds.forEach((topicId) => TopicManager.removeTopic(topicId))

      // Remove topics from redux
      topicsAdapter.removeMany(state, topicIds)

      state.topicIdsByAssistant[assistantId] = []

      // Create default topic
      const defaultTopic = getDefaultTopic(assistantId)
      topicsAdapter.addOne(state, defaultTopic)
      state.topicIdsByAssistant[assistantId] = [defaultTopic.id]
    },
    moveTopic(state, action: PayloadAction<MoveTopicPayload>) {
      const { fromAssistantId, toAssistantId, topicId } = action.payload

      // Update topic's assistantId
      topicsAdapter.updateOne(state, {
        id: topicId,
        changes: { assistantId: toAssistantId }
      })

      // Remove from source assistant's topic list
      const fromTopicIds = state.topicIdsByAssistant[fromAssistantId]
      if (fromTopicIds) {
        state.topicIdsByAssistant[fromAssistantId] = fromTopicIds.filter((id) => id !== topicId)
      }

      // Add to target assistant's topic list
      if (!state.topicIdsByAssistant[toAssistantId]) {
        state.topicIdsByAssistant[toAssistantId] = []
      }
      state.topicIdsByAssistant[toAssistantId].unshift(topicId)
    },
    addDefaultTopic(state, action: PayloadAction<{ assistantId: string }>) {
      const { assistantId } = action.payload
      const defaultTopic = getDefaultTopic(assistantId)
      topicsAdapter.addOne(state, defaultTopic)
      state.topicIdsByAssistant[assistantId] = [defaultTopic.id]
    }
  }
})

// 5. Export Actions and Reducer
export const topicsActions = topicsSlice.actions
export default topicsSlice.reducer

// Base selector for the topics slice state
export const selectTopicsState = (state: RootState) => state.topics

// Selectors generated by createEntityAdapter
export const {
  selectAll: selectAllTopics,
  selectById: selectTopicById,
  selectIds: selectAllTopicIds,
  selectEntities: selectTopicEntities
} = topicsAdapter.getSelectors(selectTopicsState)

// Custom Selector: Select topics for a specific assistant in order
export const selectTopicsForAssistant = createSelector(
  [selectTopicEntities, (state: RootState, assistantId: string) => state.topics.topicIdsByAssistant[assistantId]],
  (topicEntities, assistantTopicIds) => {
    if (!assistantTopicIds) {
      return []
    }
    return assistantTopicIds.map((id) => topicEntities[id]).filter((t): t is Topic => !!t)
  }
)
