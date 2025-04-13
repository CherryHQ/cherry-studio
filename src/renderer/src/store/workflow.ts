import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { FlowConfig, FlowEngine } from '@renderer/types'

/**
 * 定义 Workflow 功能的整体状态
 */
export interface WorkflowState {
  providers: FlowEngine[]
  // 可以添加全局设置，例如默认工作流等
  // defaultWorkflowId?: string;
}

export const INITIAL_WORKFLOW_PROVIDERS: FlowEngine[] = [
  {
    id: 'dify',
    name: 'Dify',
    workflows: [],
    enabled: true,
    isSystem: true
  }
]

const initialState: WorkflowState = {
  providers: INITIAL_WORKFLOW_PROVIDERS
}

const workflowSlice = createSlice({
  name: 'workflow',
  initialState,
  reducers: {
    updateWorkflowProvider: (state, action: PayloadAction<FlowEngine>) => {
      state.providers = state.providers.map((p) =>
        p.id === action.payload.id
          ? {
              ...p,
              ...action.payload
            }
          : p
      )
    },
    updateWorkflowProviders: (state, action: PayloadAction<FlowEngine[]>) => {
      state.providers = action.payload
    },
    addWorkflowProvider: (state, action: PayloadAction<FlowEngine>) => {
      state.providers.unshift(action.payload)
    },
    removeWorkflowProvider: (state, action: PayloadAction<FlowEngine>) => {
      const providerIndex = state.providers.findIndex((p) => p.id === action.payload.id)
      if (providerIndex !== -1) {
        state.providers.splice(providerIndex, 1)
      }
    },
    addWorkflow: (state, action: PayloadAction<FlowConfig>) => {
      state.providers = state.providers.map((p) =>
        p.id === action.payload.providerId
          ? {
              ...p,
              workflows: [...p.workflows, action.payload]
            }
          : p
      )
    },
    removeWorkflow: (state, action: PayloadAction<FlowConfig>) => {
      state.providers = state.providers.map((p) =>
        p.id === action.payload.providerId
          ? {
              ...p,
              workflows: p.workflows.filter((w) => w.id !== action.payload.id)
            }
          : p
      )
    },
    updateWorkflow: (state, action: PayloadAction<FlowConfig>) => {
      const provider = state.providers.find((p) => p.id === action.payload.providerId)
      if (provider) {
        const workflowIndex = provider.workflows.findIndex((w) => w.id === action.payload.id)
        if (workflowIndex !== -1) {
          provider.workflows[workflowIndex] = action.payload
        }
      }
    }
  }
})

export const {
  updateWorkflowProvider,
  updateWorkflowProviders,
  addWorkflowProvider,
  removeWorkflowProvider,
  addWorkflow,
  removeWorkflow,
  updateWorkflow
} = workflowSlice.actions

export default workflowSlice.reducer
