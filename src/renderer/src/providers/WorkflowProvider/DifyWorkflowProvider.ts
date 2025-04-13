import { FlowConfig } from '@renderer/types'

import BaseWorkflowProvider from './BaseWorkflowProvider'

export default class DifyWorkflowProvider extends BaseWorkflowProvider {
  public async checkWorkflowApi(workflow: FlowConfig): Promise<{ valid: boolean; error: Error | null }> {
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

  public async getParameters(workflow: FlowConfig): Promise<any> {
    try {
      const response = await fetch(`${workflow.apiHost}/parameters`, {
        method: 'GET',
        headers: {
          ...this.defaultHeaders(workflow)
        }
      }).then((res) => res.json())
      console.log('getParameters:', response)
      return response
    } catch (error) {
      console.error('Error fetching parameters:', error)
      throw error
    }
  }
}
