import { FlowEngine } from '@renderer/types'

import BaseFlowEngineProvider from './BaseFlowEngineProvider'
import DefaultFlowEngineProvider from './DefaultWorkflowProvider'
import DifyFlowEngineProvider from './DifyWorkflowProvider'

export default class FlowEngineProviderFactory {
  static create(provider: FlowEngine): BaseFlowEngineProvider {
    switch (provider.id) {
      case 'dify':
        return new DifyFlowEngineProvider(provider)
      default:
        return new DefaultFlowEngineProvider(provider)
    }
  }
}
