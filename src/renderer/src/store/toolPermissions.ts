import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export type ToolPermissionRequestPayload = {
  requestId: string
  toolName: string
  toolId: string
  description?: string
  requiresPermissions: boolean
  input: Record<string, unknown>
  inputPreview: string
  createdAt: number
  expiresAt: number
  suggestions: PermissionUpdate[]
}

export type ToolPermissionResultPayload = {
  requestId: string
  behavior: 'allow' | 'deny'
  message?: string
  reason: 'response' | 'timeout' | 'aborted' | 'no-window'
}

export type ToolPermissionStatus = 'pending' | 'submitting-allow' | 'submitting-deny'

export type ToolPermissionEntry = ToolPermissionRequestPayload & {
  status: ToolPermissionStatus
}

export interface ToolPermissionsState {
  requests: Record<string, ToolPermissionEntry>
}

const initialState: ToolPermissionsState = {
  requests: {}
}

const toolPermissionsSlice = createSlice({
  name: 'toolPermissions',
  initialState,
  reducers: {
    requestReceived: (state, action: PayloadAction<ToolPermissionRequestPayload>) => {
      const payload = action.payload
      state.requests[payload.requestId] = {
        ...payload,
        status: 'pending'
      }
    },
    submissionSent: (state, action: PayloadAction<{ requestId: string; behavior: 'allow' | 'deny' }>) => {
      const { requestId, behavior } = action.payload
      const entry = state.requests[requestId]
      if (!entry) return

      entry.status = behavior === 'allow' ? 'submitting-allow' : 'submitting-deny'
    },
    submissionFailed: (state, action: PayloadAction<{ requestId: string }>) => {
      const entry = state.requests[action.payload.requestId]
      if (!entry) return
      entry.status = 'pending'
    },
    requestResolved: (state, action: PayloadAction<ToolPermissionResultPayload>) => {
      const { requestId } = action.payload
      delete state.requests[requestId]
    },
    clearAll: (state) => {
      state.requests = {}
    }
  }
})

export const toolPermissionsActions = toolPermissionsSlice.actions

export const selectActiveToolPermission = (state: ToolPermissionsState): ToolPermissionEntry | null => {
  const activeEntries = Object.values(state.requests).filter(
    (entry) => entry.status === 'pending' || entry.status === 'submitting-allow' || entry.status === 'submitting-deny'
  )

  if (activeEntries.length === 0) return null

  activeEntries.sort((a, b) => a.createdAt - b.createdAt)
  return activeEntries[0]
}

export const selectPendingPermissionByToolName = (
  state: ToolPermissionsState,
  toolName: string
): ToolPermissionEntry | undefined => {
  const activeEntries = Object.values(state.requests)
    .filter((entry) => entry.toolName === toolName)
    .filter(
      (entry) => entry.status === 'pending' || entry.status === 'submitting-allow' || entry.status === 'submitting-deny'
    )

  if (activeEntries.length === 0) return undefined

  activeEntries.sort((a, b) => a.createdAt - b.createdAt)
  return activeEntries[0]
}

export default toolPermissionsSlice.reducer
