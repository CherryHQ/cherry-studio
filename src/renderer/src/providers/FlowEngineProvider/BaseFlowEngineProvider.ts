import { IUploadFileResponse, IUserInputForm } from '@dify-chat/api'
import { Chatflow, Flow, FlowEngine } from '@renderer/types'
import { Chunk } from '@renderer/types/chunk'
import { Message } from '@renderer/types/newMessage'

export default abstract class BaseFlowEngineProvider {
  protected provider: FlowEngine

  constructor(provider: FlowEngine) {
    this.provider = provider
  }

  abstract chatflowCompletion(flow: Flow, message: Message, onChunk: (chunk: Chunk) => void): Promise<void>

  abstract check(flow: Flow): Promise<{ valid: boolean; error: Error | null }>

  abstract getAppParameters(flow: Flow): Promise<IUserInputForm[]>

  abstract uploadFile(flow: Flow, file: File): Promise<IUploadFileResponse>

  abstract workflowCompletion(
    flow: Flow,
    inputs: Record<string, string>,
    onChunk: (chunk: Chunk) => void
  ): Promise<void>

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
