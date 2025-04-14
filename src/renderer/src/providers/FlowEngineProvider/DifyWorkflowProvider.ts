import { FlowConfig, FlowEngine } from '@renderer/types'

import BaseFlowEngineProvider from './BaseFlowEngineProvider'

export default class DifyFlowEngineProvider extends BaseFlowEngineProvider {
  constructor(provider: FlowEngine) {
    super(provider)
  }

  public async completion(flow: FlowConfig): Promise<void> {
    if (!this.isChatflow(flow)) {
      throw new Error('Dify completion only supports Chatflow')
    }

    return
  }

  public async check(flow: FlowConfig): Promise<{ valid: boolean; error: Error | null }> {
    if (this.isChatflow(flow)) {
      await this.completion(flow)
      return { valid: true, error: null }
    }

    try {
      // const checkUrl = this.isChatflow(flow) ? flow.apiHost : flow.url
      const checkUrl = flow.url

      const response = await fetch(checkUrl, {
        method: 'GET',
        headers: this.defaultHeaders(flow)
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
