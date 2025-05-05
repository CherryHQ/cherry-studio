import { createSlice, PayloadAction } from '@reduxjs/toolkit'

interface FlowState {
  currentBranchId?: string
  currentMessageId?: string
}

const initialState: FlowState = {
  currentBranchId: undefined,
  currentMessageId: undefined
}

const flowSlice = createSlice({
  name: 'flow',
  initialState,
  reducers: {
    setBranchInfo: (state, action: PayloadAction<{ branchId?: string; messageId?: string }>) => {
      state.currentBranchId = action.payload.branchId
      state.currentMessageId = action.payload.messageId
    },
    clearBranchInfo: (state) => {
      state.currentBranchId = undefined
      state.currentMessageId = undefined
    }
  }
})

export const { setBranchInfo, clearBranchInfo } = flowSlice.actions
export default flowSlice.reducer
