import { createSlice, PayloadAction } from '@reduxjs/toolkit'

interface KnowledgeFileChange {
  type: 'file-changed' | 'directory-changed'
  uniqueId: string
}

export interface KnowledgeFileChangesState {
  pendingChanges: KnowledgeFileChange[]
}

const initialState: KnowledgeFileChangesState = {
  pendingChanges: []
}

const knowledgeFileChangesSlice = createSlice({
  name: 'knowledgeFileChanges',
  initialState,
  reducers: {
    addPendingChange: (state, action: PayloadAction<KnowledgeFileChange>) => {
      state.pendingChanges.push(action.payload)
    },
    clearPendingChanges: (state) => {
      state.pendingChanges = []
    }
  }
})

export const { addPendingChange, clearPendingChanges } = knowledgeFileChangesSlice.actions
export default knowledgeFileChangesSlice.reducer
