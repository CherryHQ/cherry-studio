import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { TopicGroup } from '@renderer/types'

export interface TopicsState {
  groups: TopicGroup[]
  isLoading: boolean
  loadingError: Error | null
}

const initialState: TopicsState = {
  groups: [],
  isLoading: false,
  loadingError: null
}

const topicsSlice = createSlice({
  name: 'topics',
  initialState,
  reducers: {
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload
    },
    setLoadingError: (state, action: PayloadAction<Error | null>) => {
      state.loadingError = action.payload
    },
    updateGroups: (state, action: PayloadAction<TopicGroup[]>) => {
      state.groups = action.payload || []
    },
    addGroup: (state, action: PayloadAction<TopicGroup>) => {
      state.groups.push(action.payload)
    },
    updateGroup: (state, action: PayloadAction<TopicGroup>) => {
      state.groups = state.groups.map((group) => (group.id === action.payload.id ? action.payload : group))
    },
    removeGroup: (state, action: PayloadAction<{ id: string }>) => {
      state.groups = state.groups.filter((group) => group.id !== action.payload.id)
    },
    updateTopicGroup: () => {
      // 在assistants store中实现，这里只是保留接口
      // 空实现，不修改状态
    },
    updateGroupsOrder: (state, action: PayloadAction<TopicGroup[]>) => {
      state.groups = action.payload
    }
  }
})

export const {
  setLoading,
  setLoadingError,
  updateGroups,
  addGroup,
  updateGroup,
  removeGroup,
  updateTopicGroup,
  updateGroupsOrder
} = topicsSlice.actions

export default topicsSlice.reducer
