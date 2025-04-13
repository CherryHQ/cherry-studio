import WorkflowProvider from '@renderer/providers/WorkflowProvider'
import { FlowEngine, FlowConfig } from '@renderer/types'

export async function checkWorkflowApi(provider: FlowEngine, workflow: FlowConfig) {
  const workflowProvider = new WorkflowProvider(provider)
  return await workflowProvider.checkWorkflowApi(workflow)
}

export async function getParameters(provider: FlowEngine, workflow: FlowConfig) {
  const workflowProvider = new WorkflowProvider(provider)
  return await workflowProvider.getParameters(workflow)
}
