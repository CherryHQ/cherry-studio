import { IUploadFileResponse, IUserInputForm } from '@dify-chat/api'
import { Chatflow, Flow, FlowEngine } from '@renderer/types'

export default abstract class BaseFlowEngineProvider {
  protected provider: FlowEngine

  constructor(provider: FlowEngine) {
    this.provider = provider
  }

  abstract completion(flow: Flow): Promise<void>

  abstract check(flow: Flow): Promise<{ valid: boolean; error: Error | null }>

  abstract getAppParameters(flow: Flow): Promise<IUserInputForm[]>

  abstract uploadFile(flow: Flow, file: File): Promise<IUploadFileResponse>

  abstract runWorkflow(flow: Flow, inputs: Record<string, string>): Promise<void>

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
