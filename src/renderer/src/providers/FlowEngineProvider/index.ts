import { FlowConfig, FlowEngine } from '@renderer/types'

import BaseFlowEngineProvider from './BaseFlowEngineProvider'
import FlowEngineProviderFactory from './WorkflowProviderFactory'

export default class FlowEngineProvider {
  private sdk: BaseFlowEngineProvider

  constructor(provider: FlowEngine) {
    console.log('FlowEngineProvider', provider)
    this.sdk = FlowEngineProviderFactory.create(provider)
  }

  public async check(flow: FlowConfig): Promise<{ valid: boolean; error: Error | null }> {
    return await this.sdk.check(flow)
  }
}
