import BaseFlowEngineProvider from './BaseFlowEngineProvider'

export default class DefaultFlowEngineProvider extends BaseFlowEngineProvider {
  completion(): Promise<void> {
    throw new Error('Method not implemented.')
  }
  check(): Promise<{ valid: boolean; error: Error | null }> {
    throw new Error('Method not implemented.')
  }
}
