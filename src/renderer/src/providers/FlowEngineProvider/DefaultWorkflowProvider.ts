import BaseFlowEngineProvider from './BaseFlowEngineProvider'

export default class DefaultFlowEngineProvider extends BaseFlowEngineProvider {
  check(): Promise<{ valid: boolean; error: Error | null }> {
    throw new Error('Method not implemented.')
  }
}
