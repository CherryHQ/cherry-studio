import { IUploadFileResponse, IUserInputForm } from '@dify-chat/api'
import { Flow, FlowEngine } from '@renderer/types'

import BaseFlowEngineProvider from './BaseFlowEngineProvider'
import FlowEngineProviderFactory from './FlowEngineProviderFactory'

export default class FlowEngineProvider {
  private sdk: BaseFlowEngineProvider

  constructor(provider: FlowEngine) {
    console.log('FlowEngineProvider', provider)
    this.sdk = FlowEngineProviderFactory.create(provider)
  }

  public async completion(flow: Flow): Promise<void> {
    return await this.sdk.completion(flow)
  }

  public async check(flow: Flow): Promise<{ valid: boolean; error: Error | null }> {
    return await this.sdk.check(flow)
  }

  public async getAppParameters(flow: Flow): Promise<IUserInputForm[]> {
    return await this.sdk.getAppParameters(flow)
  }

  public async uploadFile(flow: Flow, file: File): Promise<IUploadFileResponse> {
    return await this.sdk.uploadFile(flow, file)
  }
}
