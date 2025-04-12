import { WorkflowProviderType } from '@renderer/types'

import BaseWorkflowProvider from './BaseWorkflowProvider'
import DefaultWorkflowProvider from './DefaultWorkflowProvider'
import DifyWorkflowProvider from './DifyWorkflowProvider'

export default class WorkflowProviderFactory {
  static create(provider: WorkflowProviderType): BaseWorkflowProvider {
    switch (provider.id) {
      case 'dify':
        return new DifyWorkflowProvider(provider)
      default:
        return new DefaultWorkflowProvider(provider)
    }
  }
}
