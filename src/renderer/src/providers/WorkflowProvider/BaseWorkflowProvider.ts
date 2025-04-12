import { WorkflowProviderType, WorkflowType } from '@renderer/types'

export default abstract class BaseWorkflowProvider {
  protected provider: WorkflowProviderType

  constructor(provider: WorkflowProviderType) {
    this.provider = provider
  }

  abstract checkWorkflowApi(workflow: WorkflowType): Promise<{ valid: boolean; error: Error | null }>

  public defaultHeaders(workflow: WorkflowType) {
    return {
      'HTTP-Referer': 'https://cherry-ai.com',
      'X-Title': 'Cherry Studio',
      Authorization: `Bearer ${workflow.apiKey}`
    }
  }
}
