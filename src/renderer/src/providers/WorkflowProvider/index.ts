import { FlowEngine, FlowConfig } from '@renderer/types'

import BaseWorkflowProvider from './BaseWorkflowProvider'
import WorkflowProviderFactory from './WorkflowProviderFactory'

export default class WorkflowProvider {
  private sdk: BaseWorkflowProvider

  constructor(provider: FlowEngine) {
    console.log('WorkflowProvider', provider)
    this.sdk = WorkflowProviderFactory.create(provider)
  }

  public async checkWorkflowApi(workflow: FlowConfig): Promise<{ valid: boolean; error: Error | null }> {
    return await this.sdk.checkWorkflowApi(workflow)
  }

  public async getParameters(workflow: FlowConfig): Promise<any> {
    return await this.sdk.getParameters(workflow)
  }
}
