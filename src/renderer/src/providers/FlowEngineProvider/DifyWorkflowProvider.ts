import { FlowConfig } from '@renderer/types'

import BaseFlowEngineProvider from './BaseFlowEngineProvider'

export default class DifyFlowEngineProvider extends BaseFlowEngineProvider {
  public async check(flow: FlowConfig): Promise<{ valid: boolean; error: Error | null }> {
    try {
      const checkUrl = this.isChatflow(flow) ? flow.apiHost : flow.url

      const response = await fetch(checkUrl, {
        method: 'GET',
        headers: this.defaultHeaders(flow)
      })
      console.log('dify response', response)
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
