import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { getTopic } from '@renderer/hooks/useTopic'
import { fetchMessagesSummary } from '@renderer/services/ApiService'
import { Topic } from '@renderer/types'
import { t } from 'i18next'

import { RootState } from '.'

// State interface for topics-related features
export interface TopicsState {
  // Topic IDs that are currently being renamed
  renamingTopicIds: string[]
}

const initialState: TopicsState = {
  renamingTopicIds: []
}

const topicsSlice = createSlice({
  name: 'topics',
  initialState,
  reducers: {
    startRenaming: (state, action: PayloadAction<string>) => {
      if (!state.renamingTopicIds.includes(action.payload)) {
        state.renamingTopicIds.push(action.payload)
      }
    },
    finishRenaming: (state, action: PayloadAction<string>) => {
      state.renamingTopicIds = state.renamingTopicIds.filter((id) => id !== action.payload)
    }
  }
})

export const { startRenaming, finishRenaming } = topicsSlice.actions

// Selectors
export const selectIsRenaming = (state: RootState, topicId: string) => state.topics.renamingTopicIds.includes(topicId)

// Thunk for renaming a topic
export const renameTopic =
  (
    assistant: any,
    topic: Topic,
    messages: any[],
    setActiveTopic: (topic: Topic) => void,
    updateTopic: (topic: Topic) => void,
    enableTopicNaming: boolean
  ) =>
  async (dispatch: any) => {
    const _topic = getTopic(assistant, topic.id)

    if (messages.length < 2) {
      return
    }

    // If auto naming is disabled, use the first message content as topic name
    if (!enableTopicNaming) {
      const topicName = messages[0].content.substring(0, 50)
      if (topicName) {
        const data = { ..._topic, name: topicName } as Topic
        setActiveTopic(data)
        updateTopic(data)
      }
      return
    }

    // Auto rename topic using AI-generated summary
    if (_topic && _topic.name === t('chat.default.topic.name')) {
      dispatch(startRenaming(topic.id))
      try {
        const summaryText = await fetchMessagesSummary({ messages, assistant })
        if (summaryText) {
          const data = { ..._topic, name: summaryText }
          setActiveTopic(data)
          updateTopic(data)
        }
      } finally {
        dispatch(finishRenaming(topic.id))
      }
    }
  }

export default topicsSlice.reducer
