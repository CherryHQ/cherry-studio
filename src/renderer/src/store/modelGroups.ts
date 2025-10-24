import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { ModelGroup } from '@renderer/types'
import { uuid } from '@renderer/utils'

export interface ModelGroupsState {
  groups: ModelGroup[]
}

const initialState: ModelGroupsState = {
  groups: []
}

const modelGroupsSlice = createSlice({
  name: 'modelGroups',
  initialState,
  reducers: {
    addModelGroup: (state, action: PayloadAction<Omit<ModelGroup, 'id' | 'createdAt' | 'updatedAt'>>) => {
      const now = new Date().toISOString()
      const newGroup: ModelGroup = {
        ...action.payload,
        id: uuid(),
        createdAt: now,
        updatedAt: now
      }
      state.groups.push(newGroup)
    },

    updateModelGroup: (state, action: PayloadAction<ModelGroup>) => {
      const index = state.groups.findIndex((g) => g.id === action.payload.id)
      if (index !== -1) {
        state.groups[index] = {
          ...action.payload,
          updatedAt: new Date().toISOString()
        }
      }
    },

    removeModelGroup: (state, action: PayloadAction<string>) => {
      state.groups = state.groups.filter((g) => g.id !== action.payload)
    },

    setModelGroups: (state, action: PayloadAction<ModelGroup[]>) => {
      state.groups = action.payload
    }
  }
})

export const { addModelGroup, updateModelGroup, removeModelGroup, setModelGroups } = modelGroupsSlice.actions

export default modelGroupsSlice.reducer