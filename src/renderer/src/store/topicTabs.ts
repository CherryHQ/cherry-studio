import { loggerService } from '@logger'
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

import { removeAllTopics, removeAssistant, removeTopic } from './assistants'

const logger = loggerService.withContext('TopicTabs')

export interface TopicTabItem {
  topicId: string
  assistantId: string
  openedAt: number
}

export interface TopicTabsState {
  openTabs: TopicTabItem[]
  activeTabId: string | null
  maxTabs: number
}

const initialState: TopicTabsState = {
  openTabs: [],
  activeTabId: null,
  maxTabs: 15
}

const topicTabsSlice = createSlice({
  name: 'topicTabs',
  initialState,
  reducers: {
    addTopicTab: (state, action: PayloadAction<{ topicId: string; assistantId: string }>) => {
      const { topicId, assistantId } = action.payload
      const existing = state.openTabs.find((tab) => tab.topicId === topicId)

      if (existing) {
        state.activeTabId = topicId
        return
      }

      state.openTabs.push({ topicId, assistantId, openedAt: Date.now() })

      if (state.openTabs.length > state.maxTabs) {
        let oldestIndex = 0
        for (let i = 1; i < state.openTabs.length; i++) {
          if (state.openTabs[i].openedAt < state.openTabs[oldestIndex].openedAt) {
            oldestIndex = i
          }
        }
        const removed = state.openTabs.splice(oldestIndex, 1)[0]
        logger.info('Tab evicted due to maxTabs limit', { topicId: removed.topicId })
      }

      state.activeTabId = topicId
      logger.info('Tab added', { topicId, assistantId })
    },
    removeTopicTab: (state, action: PayloadAction<string>) => {
      const topicId = action.payload
      const index = state.openTabs.findIndex((tab) => tab.topicId === topicId)

      if (index === -1) return

      state.openTabs.splice(index, 1)

      if (state.activeTabId === topicId) {
        if (state.openTabs.length === 0) {
          state.activeTabId = null
        } else {
          const newIndex = index > 0 ? index - 1 : 0
          state.activeTabId = state.openTabs[newIndex].topicId
        }
      }

      logger.info('Tab removed', { topicId })
    },
    setActiveTopicTab: (state, action: PayloadAction<string>) => {
      state.activeTabId = action.payload
    },
    clearAllTopicTabs: (state) => {
      state.openTabs = []
      state.activeTabId = null
      logger.info('All tabs cleared')
    }
  },
  extraReducers: (builder) => {
    builder.addCase(removeTopic, (state, action) => {
      const topicId = action.payload.topic.id
      const hadTab = state.openTabs.some((tab) => tab.topicId === topicId)
      state.openTabs = state.openTabs.filter((tab) => tab.topicId !== topicId)

      if (state.activeTabId === topicId) {
        state.activeTabId = state.openTabs[0]?.topicId ?? null
      }

      if (hadTab) {
        logger.info('Tab removed due to topic deletion', { topicId })
      }
    })

    builder.addCase(removeAssistant, (state, action) => {
      const assistantId = action.payload.id
      const removedCount = state.openTabs.filter((tab) => tab.assistantId === assistantId).length
      state.openTabs = state.openTabs.filter((tab) => tab.assistantId !== assistantId)

      if (!state.openTabs.some((tab) => tab.topicId === state.activeTabId)) {
        state.activeTabId = state.openTabs[0]?.topicId ?? null
      }

      if (removedCount > 0) {
        logger.info('Tabs removed due to assistant deletion', { assistantId, removedCount })
      }
    })

    builder.addCase(removeAllTopics, (state, action) => {
      const assistantId = action.payload.assistantId
      const removedCount = state.openTabs.filter((tab) => tab.assistantId === assistantId).length
      state.openTabs = state.openTabs.filter((tab) => tab.assistantId !== assistantId)

      if (!state.openTabs.some((tab) => tab.topicId === state.activeTabId)) {
        state.activeTabId = state.openTabs[0]?.topicId ?? null
      }

      if (removedCount > 0) {
        logger.info('Tabs removed due to removeAllTopics', { assistantId, removedCount })
      }
    })
  }
})

export const { addTopicTab, removeTopicTab, setActiveTopicTab, clearAllTopicTabs } = topicTabsSlice.actions
export default topicTabsSlice.reducer
