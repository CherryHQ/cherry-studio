import { createSelector } from '@reduxjs/toolkit'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  addWorkflow,
  addWorkflowProvider,
  removeWorkflow,
  removeWorkflowProvider,
  updateWorkflow,
  updateWorkflowProvider,
  updateWorkflowProviders
} from '@renderer/store/workflow'
import { FlowConfig, FlowEngine } from '@renderer/types'

const selectEnabledWorkflowProviders = createSelector(
  (state) => state.workflow.providers,
  (providers) => providers.filter((p) => p.enabled)
)

export function useWorkflowProviders() {
  const workflowProviders: FlowEngine[] = useAppSelector(selectEnabledWorkflowProviders)
  const dispatch = useAppDispatch()

  return {
    workflowProviders: workflowProviders || [],
    addWorkflowProvider: (provider: FlowEngine) => dispatch(addWorkflowProvider(provider)),
    removeWorkflowProvider: (provider: FlowEngine) => dispatch(removeWorkflowProvider(provider)),
    updateWorkflowProviders: (providers: FlowEngine[]) => dispatch(updateWorkflowProviders(providers))
  }
}

export function useAllWorkflowProviders() {
  return useAppSelector((state) => state.workflow.providers)
}

export function useWorkflowProvider(id: string) {
  const workflowProvider = useAppSelector(
    (state) => state.workflow.providers.find((p) => p.id === id) as FlowEngine
  )
  const workflows = workflowProvider.workflows
  const dispatch = useAppDispatch()

  return {
    workflowProvider,
    workflows,
    updateWorkflowProvider: (provider: FlowEngine) => dispatch(updateWorkflowProvider(provider)),
    addWorkflow: (workflow: FlowConfig) => dispatch(addWorkflow(workflow)),
    updateWorkflow: (workflow: FlowConfig) => dispatch(updateWorkflow(workflow)),
    removeWorkflow: (workflow: FlowConfig) => dispatch(removeWorkflow(workflow))
  }
}
