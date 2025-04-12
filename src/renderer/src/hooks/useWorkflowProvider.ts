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
import { WorkflowType, WorkflowProviderType } from '@renderer/types'

const selectEnabledWorkflowProviders = createSelector(
  (state) => state.workflow.providers,
  (providers) => providers.filter((p) => p.enabled)
)

export function useWorkflowProviders() {
  const workflowProviders: WorkflowProviderType[] = useAppSelector(selectEnabledWorkflowProviders)
  const dispatch = useAppDispatch()

  return {
    workflowProviders: workflowProviders || [],
    addWorkflowProvider: (provider: WorkflowProviderType) => dispatch(addWorkflowProvider(provider)),
    removeWorkflowProvider: (provider: WorkflowProviderType) => dispatch(removeWorkflowProvider(provider)),
    updateWorkflowProviders: (providers: WorkflowProviderType[]) => dispatch(updateWorkflowProviders(providers))
  }
}

export function useAllWorkflowProviders() {
  return useAppSelector((state) => state.workflow.providers)
}

export function useWorkflowProvider(id: string) {
  const workflowProvider = useAppSelector(
    (state) => state.workflow.providers.find((p) => p.id === id) as WorkflowProviderType
  )
  const workflows = workflowProvider.workflows
  const dispatch = useAppDispatch()

  return {
    workflowProvider,
    workflows,
    updateWorkflowProvider: (provider: WorkflowProviderType) => dispatch(updateWorkflowProvider(provider)),
    addWorkflow: (workflow: WorkflowType) => dispatch(addWorkflow(workflow)),
    updateWorkflow: (workflow: WorkflowType) => dispatch(updateWorkflow(workflow)),
    removeWorkflow: (workflow: WorkflowType) => dispatch(removeWorkflow(workflow))
  }
}
