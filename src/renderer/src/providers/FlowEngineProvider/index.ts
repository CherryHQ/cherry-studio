import { IUploadFileResponse, IUserInputForm } from '@dify-chat/api'
import { Flow, FlowEngine } from '@renderer/types'
import { Chunk } from '@renderer/types/chunk'
import { Message } from '@renderer/types/newMessage'

import BaseFlowEngineProvider from './BaseFlowEngineProvider'
import FlowEngineProviderFactory from './FlowEngineProviderFactory'

export default class FlowEngineProvider {
  private sdk: BaseFlowEngineProvider

  constructor(provider: FlowEngine) {
    console.log('FlowEngineProvider', provider)
    this.sdk = FlowEngineProviderFactory.create(provider)
  }

  public async chatflowCompletion(
    flow: Flow,
    message: Message,
    conversationId: string,
    inputs: Record<string, string>,
    onChunk: (chunk: Chunk) => void
  ): Promise<void> {
    return await this.sdk.chatflowCompletion(flow, message, conversationId, inputs, onChunk)
  }

  public async check(flow: Flow): Promise<{ valid: boolean; error: Error | null }> {
    return await this.sdk.check(flow)
  }

  public async getAppParameters(flow: Flow): Promise<IUserInputForm[]> {
    return await this.sdk.getAppParameters(flow)
  }

  public async uploadFile(flow: Flow, file: File, userId: string): Promise<IUploadFileResponse> {
    return await this.sdk.uploadFile(flow, file, userId)
  }
  public async workflowCompletion(
    message: Message,
    flow: Flow,
    inputs: Record<string, string>,
    onChunk: (chunk: Chunk) => void
  ): Promise<void> {
    return await this.sdk.workflowCompletion(message, flow, inputs, onChunk)
  }
}
