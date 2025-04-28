import { createSelector } from '@reduxjs/toolkit'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  addFlow,
  addFlowEngineProvider,
  removeFlow,
  removeFlowEngineProvider,
  updateFlow,
  updateFlowEngineProvider,
  updateFlowEngineProviders
} from '@renderer/store/flow'
import { Flow, FlowEngine, Workflow } from '@renderer/types'

const selectEnabledFlowEngineProviders = createSelector(
  (state) => state.flow.providers,
  (providers) => providers.filter((p) => p.enabled)
)

export function useFlowEngineProviders() {
  const flowEngineProviders: FlowEngine[] = useAppSelector(selectEnabledFlowEngineProviders)
  const dispatch = useAppDispatch()

  return {
    flowEngineProviders: flowEngineProviders || [],
    addflowEngineProvider: (provider: FlowEngine) => dispatch(addFlowEngineProvider(provider)),
    removeflowEngineProvider: (provider: FlowEngine) => dispatch(removeFlowEngineProvider(provider)),
    updateflowEngineProviders: (providers: FlowEngine[]) => dispatch(updateFlowEngineProviders(providers))
  }
}

export function useAllFlowEngineProviders() {
  return useAppSelector((state) => state.flow.providers)
}

export function useFlowEngineProvider(id: string) {
  const flowEngineProvider = useAppSelector((state) => state.flow.providers.find((p) => p.id === id) as FlowEngine)
  const flows = flowEngineProvider.flows
  const dispatch = useAppDispatch()

  return {
    flowEngineProvider,
    flows,
    updateFlowEngineProvider: (provider: FlowEngine) => dispatch(updateFlowEngineProvider(provider)),
    addFlow: (flow: Flow) => dispatch(addFlow(flow)),
    updateFlow: (flow: Flow) => dispatch(updateFlow(flow)),
    removeFlow: (flow: Flow) => dispatch(removeFlow(flow))
  }
}

export function useWorkflows() {
  const workflows: Workflow[] = useAppSelector(selectEnabledFlowEngineProviders)
    .map((provider) => provider.flows)
    .flat()
    .filter((flow) => flow.type === 'workflow' && flow.enabled)

  return {
    workflows
  }
}

export function useChatflows() {
  const chatflows: Workflow[] = useAppSelector(selectEnabledFlowEngineProviders)
    .map((provider) => provider.flows)
    .flat()
    .filter((flow) => flow.type === 'chat' && flow.enabled)

  return {
    chatflows
  }
}
