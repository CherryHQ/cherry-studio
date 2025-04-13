import BaseWorkflowProvider from './BaseWorkflowProvider'

export default class DefaultWorkflowProvider extends BaseWorkflowProvider {
  getParameters(): Promise<any> {
    throw new Error('Method not implemented.')
  }
  checkWorkflowApi(): Promise<{ valid: boolean; error: Error | null }> {
    throw new Error('Method not implemented.')
  }
}
