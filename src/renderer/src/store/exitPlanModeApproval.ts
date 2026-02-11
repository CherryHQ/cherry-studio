/**
 * Store slice for ExitPlanMode approval dialog state management
 */
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

export type ExitPlanModeApprovalRequest = {
  requestId: string
  plan: string
  currentPermissionMode: string
  toolCallId: string
  createdAt: number
  expiresAt: number
}

export interface ExitPlanModeApprovalState {
  approvalRequest: ExitPlanModeApprovalRequest | null
}

const initialState: ExitPlanModeApprovalState = {
  approvalRequest: null
}

const exitPlanModeApprovalSlice = createSlice({
  name: 'exitPlanModeApproval',
  initialState,
  reducers: {
    exitPlanModeApprovalRequested: (state, action: PayloadAction<ExitPlanModeApprovalRequest>) => {
      state.approvalRequest = action.payload
    },
    exitPlanModeApprovalCleared: (state) => {
      state.approvalRequest = null
    }
  }
})

export const exitPlanModeApprovalActions = exitPlanModeApprovalSlice.actions
export default exitPlanModeApprovalSlice.reducer
