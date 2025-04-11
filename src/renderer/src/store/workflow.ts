import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { Workflow, WorkflowProvider } from '@renderer/types'

/**
 * 定义 Workflow 功能的整体状态
 */
export interface WorkflowState {
  providers: WorkflowProvider[]
  // 可以添加全局设置，例如默认工作流等
  // defaultWorkflowId?: string;
}

export const INITIAL_WORKFLOW_PROVIDERS: WorkflowProvider[] = [
  {
    id: 'dify',
    name: 'Dify',
    workflows: [],
    enabled: true
  }
]

const initialState: WorkflowState = {
  providers: INITIAL_WORKFLOW_PROVIDERS
}

const workflowSlice = createSlice({
  name: 'workflow',
  initialState,
  reducers: {
    updateWorkflowProvider: (state, action: PayloadAction<WorkflowProvider>) => {
      state.providers = state.providers.map((p) => (p.id === action.payload.id ? { ...p, ...action.payload } : p))
    },
    addWorkflowProvider: (state, action: PayloadAction<WorkflowProvider>) => {
      state.providers.unshift(action.payload)
    },
    removeProvider: (state, action: PayloadAction<WorkflowProvider>) => {
      const providerIndex = state.providers.findIndex((p) => p.id === action.payload.id)
      if (providerIndex !== -1) {
        state.providers.splice(providerIndex, 1)
      }
    },
    addWorkflow: (state, action: PayloadAction<{ providerId: string; model: Workflow }>) => {
      state.providers = state.providers.map((p) =>
        p.id === action.payload.providerId
          ? {
              ...p,
              workflows: [...p.workflows, action.payload.model]
            }
          : p
      )
    },
    removeWorkflow: (state, action: PayloadAction<{ providerId: string; workflowId: string }>) => {
      state.providers = state.providers.map((p) =>
        p.id === action.payload.providerId
          ? {
              ...p,
              workflows: p.workflows.filter((w) => w.id !== action.payload.workflowId)
            }
          : p
      )
    },
    updateWorkflow: (state, action: PayloadAction<{ providerId: string; workflow: Workflow; model: Workflow }>) => {
      const provider = state.providers.find((p) => p.id === action.payload.providerId)
      if (provider) {
        const workflowIndex = provider.workflows.findIndex((w) => w.id === action.payload.workflow.id)
        if (workflowIndex !== -1) {
          provider.workflows[workflowIndex] = action.payload.workflow
        }
      }
    }
  }
})

export const {
  updateWorkflowProvider,
  addWorkflowProvider,
  removeProvider,
  addWorkflow,
  removeWorkflow,
  updateWorkflow
} = workflowSlice.actions

export default workflowSlice.reducer
