import WorkflowProvider from '@renderer/providers/WorkflowProvider'
import { WorkflowProviderType, WorkflowType } from '@renderer/types'

export async function checkWorkflowApi(provider: WorkflowProviderType, workflow: WorkflowType) {
  const workflowProvider = new WorkflowProvider(provider)
  return await workflowProvider.checkWorkflowApi(workflow)
}
