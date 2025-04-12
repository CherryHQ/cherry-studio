import { WorkflowProviderType, WorkflowType } from '@renderer/types'

import BaseWorkflowProvider from './BaseWorkflowProvider'
import WorkflowProviderFactory from './WorkflowProviderFactory'

export default class WorkflowProvider {
  private sdk: BaseWorkflowProvider

  constructor(provider: WorkflowProviderType) {
    console.log('WorkflowProvider', provider)
    this.sdk = WorkflowProviderFactory.create(provider)
  }

  public async checkWorkflowApi(workflow: WorkflowType): Promise<{ valid: boolean; error: Error | null }> {
    return await this.sdk.checkWorkflowApi(workflow)
  }
}
