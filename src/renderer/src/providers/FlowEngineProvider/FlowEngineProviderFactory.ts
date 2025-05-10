import { FlowEngine } from '@renderer/types'

import BaseFlowEngineProvider from './BaseFlowEngineProvider'
import DefaultFlowEngineProvider from './DefaultFlowEngineProvider'
import DifyFlowEngineProvider from './DifyFlowEngineProvider'

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
