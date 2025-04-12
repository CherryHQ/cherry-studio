import { WorkflowType } from '@renderer/types'

import BaseWorkflowProvider from './BaseWorkflowProvider'

export default class DifyWorkflowProvider extends BaseWorkflowProvider {
  public async checkWorkflowApi(workflow: WorkflowType): Promise<{ valid: boolean; error: Error | null }> {
    try {
      const response = await fetch(`${workflow.apiHost}/info`, {
        method: 'GET',
        headers: {
          ...this.defaultHeaders(workflow)
        }
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        const statusText = response.statusText || 'Unknown Error'
        const errorMessage = errorData?.message || `Request failed with status ${response.status}: ${statusText}`
        return { valid: false, error: new Error(errorMessage) }
      }

      return { valid: true, error: null }
    } catch (error) {
      return { valid: false, error: error as Error }
    }
  }
}
