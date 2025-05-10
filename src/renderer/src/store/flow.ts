import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { Flow, FlowEngine } from '@renderer/types'

/**
 * 定义 Workflow 功能的整体状态
 */
export interface FlowEngineState {
  providers: FlowEngine[]
  // 可以添加全局设置，例如默认工作流等
  // defaultWorkflowId?: string;
}

export const INITIAL_FLOW_ENGINE_PROVIDERS: FlowEngine[] = [
  {
    id: 'dify',
    name: 'Dify',
    flows: [],
    enabled: true,
    isSystem: true
  }
]

const initialState: FlowEngineState = {
  providers: INITIAL_FLOW_ENGINE_PROVIDERS
}

const flowSlice = createSlice({
  name: 'flow',
  initialState,
  reducers: {
    updateFlowEngineProvider: (state, action: PayloadAction<FlowEngine>) => {
      state.providers = state.providers.map((p) =>
        p.id === action.payload.id
          ? {
              ...p,
              ...action.payload
            }
          : p
      )
    },
    updateFlowEngineProviders: (state, action: PayloadAction<FlowEngine[]>) => {
      state.providers = action.payload
    },
    addFlowEngineProvider: (state, action: PayloadAction<FlowEngine>) => {
      state.providers.unshift(action.payload)
    },
    removeFlowEngineProvider: (state, action: PayloadAction<FlowEngine>) => {
      const providerIndex = state.providers.findIndex((p) => p.id === action.payload.id)
      if (providerIndex !== -1) {
        state.providers.splice(providerIndex, 1)
      }
    },
    addFlow: (state, action: PayloadAction<Flow>) => {
      state.providers = state.providers.map((p) =>
        p.id === action.payload.providerId
          ? {
              ...p,
              flows: [...p.flows, action.payload]
            }
          : p
      )
    },
    removeFlow: (state, action: PayloadAction<Flow>) => {
      state.providers = state.providers.map((p) =>
        p.id === action.payload.providerId
          ? {
              ...p,
              flows: p.flows.filter((w) => w.id !== action.payload.id)
            }
          : p
      )
    },
    updateFlow: (state, action: PayloadAction<Flow>) => {
      const provider = state.providers.find((p) => p.id === action.payload.providerId)
      if (provider) {
        const workflowIndex = provider.flows.findIndex((w) => w.id === action.payload.id)
        if (workflowIndex !== -1) {
          provider.flows[workflowIndex] = action.payload
        }
      }
    }
  }
})

export const {
  updateFlowEngineProvider,
  updateFlowEngineProviders,
  addFlowEngineProvider,
  removeFlowEngineProvider,
  addFlow,
  removeFlow,
  updateFlow
} = flowSlice.actions

export default flowSlice.reducer
