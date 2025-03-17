import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { TopicInfo } from '@renderer/types'

export interface TopicInfosState {
  topicInfos: TopicInfo[]
}

const initialState: TopicInfosState = {
  topicInfos: []
}

const topicInfosSlice = createSlice({
  name: 'topicInfos',
  initialState,
  reducers: {
    setTopicInfos: (state, action: PayloadAction<TopicInfo[]>) => {
      state.topicInfos = action.payload
    },
    updateTopicInfo: (state, action: PayloadAction<TopicInfo>) => {
      const index = state.topicInfos.findIndex((t) => t.id === action.payload.id)
      if (index !== -1) {
        state.topicInfos[index] = action.payload
      } else {
        state.topicInfos.push(action.payload)
      }
    },
    removeTopicInfo: (state, action: PayloadAction<string>) => {
      state.topicInfos = state.topicInfos.filter((t) => t.id !== action.payload)
    },
    reorderTopicInfos: (state, action: PayloadAction<{ sourceIndex: number; targetIndex: number }>) => {
      const { sourceIndex, targetIndex } = action.payload
      if (sourceIndex !== targetIndex) {
        const newTopicInfos = [...state.topicInfos]
        const [movedItem] = newTopicInfos.splice(sourceIndex, 1)
        newTopicInfos.splice(targetIndex, 0, movedItem)
        state.topicInfos = newTopicInfos
      }
    }
  }
})

export const { setTopicInfos, updateTopicInfo, removeTopicInfo, reorderTopicInfos } = topicInfosSlice.actions
export default topicInfosSlice.reducer
