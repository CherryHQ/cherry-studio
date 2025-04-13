import { FlowEngine, FlowConfig } from '@renderer/types'

export default abstract class BaseWorkflowProvider {
  protected provider: FlowEngine

  constructor(provider: FlowEngine) {
    this.provider = provider
  }

  abstract checkWorkflowApi(workflow: FlowConfig): Promise<{ valid: boolean; error: Error | null }>

  abstract getParameters(workflow: FlowConfig): Promise<any>

  public defaultHeaders(workflow: FlowConfig) {
    return {
      'HTTP-Referer': 'https://cherry-ai.com',
      'X-Title': 'Cherry Studio',
      Authorization: `Bearer ${workflow.apiKey}`
    }
  }
}
