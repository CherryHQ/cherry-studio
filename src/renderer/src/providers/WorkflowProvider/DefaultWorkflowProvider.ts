import BaseWorkflowProvider from './BaseWorkflowProvider'

export default class DefaultWorkflowProvider extends BaseWorkflowProvider {
  checkWorkflowApi(): Promise<{ valid: boolean; error: Error | null }> {
    throw new Error('Method not implemented.')
  }
}
