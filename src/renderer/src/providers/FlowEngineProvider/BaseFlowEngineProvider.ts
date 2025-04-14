import { ChatflowSpecificConfig, FlowConfig, FlowEngine } from '@renderer/types'

export default abstract class BaseFlowEngineProvider {
  protected provider: FlowEngine

  constructor(provider: FlowEngine) {
    this.provider = provider
  }

  abstract completion(flow: FlowConfig): Promise<void>

  abstract check(flow: FlowConfig): Promise<{ valid: boolean; error: Error | null }>

  public isChatflow(workflow: FlowConfig): workflow is ChatflowSpecificConfig {
    return workflow.type === 'chatflow'
  }
  public defaultHeaders(workflow: FlowConfig) {
    const headers = {
      'HTTP-Referer': 'https://cherry-ai.com',
      'X-Title': 'Cherry Studio'
    }

    if (this.isChatflow(workflow)) {
      return {
        ...headers,
        Authorization: `Bearer ${workflow.apiKey}`
      }
    }

    return headers
  }
}
