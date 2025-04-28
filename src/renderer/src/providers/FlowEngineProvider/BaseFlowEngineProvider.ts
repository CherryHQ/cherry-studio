import { Chatflow, Flow, FlowEngine } from '@renderer/types'

export default abstract class BaseFlowEngineProvider {
  protected provider: FlowEngine

  constructor(provider: FlowEngine) {
    this.provider = provider
  }

  abstract completion(flow: Flow): Promise<void>

  abstract check(flow: Flow): Promise<{ valid: boolean; error: Error | null }>

  public isChatflow(workflow: Flow): workflow is Chatflow {
    return workflow.type === 'chatflow'
  }
  public defaultHeaders(workflow: Flow) {
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
