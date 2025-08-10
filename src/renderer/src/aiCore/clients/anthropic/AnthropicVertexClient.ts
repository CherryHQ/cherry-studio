import Anthropic from '@anthropic-ai/sdk'
import AnthropicVertex from '@anthropic-ai/vertex-sdk'
import { loggerService } from '@logger'
import { getVertexAILocation, getVertexAIProjectId, getVertexAIServiceAccount } from '@renderer/hooks/useVertexAI'
import { Provider } from '@renderer/types'
import { isEmpty } from 'lodash'

import { AnthropicAPIClient } from './AnthropicAPIClient'

const logger = loggerService.withContext('AnthropicVertexClient')

export class AnthropicVertexClient extends AnthropicAPIClient {
  sdkInstance: AnthropicVertex | undefined = undefined
  private authHeaders?: Record<string, string>
  private authHeadersExpiry?: number

  constructor(provider: Provider) {
    super(provider)
  }

  private formatApiHost(host: string): string {
    const forceUseOriginalHost = () => {
      return host.endsWith('/')
    }

    if (!host) {
      return host
    }

    return forceUseOriginalHost() ? host : `${host}/v1/`
  }

  override getBaseURL() {
    return this.formatApiHost(this.provider.apiHost)
  }

  override async getSdkInstance(): Promise<AnthropicVertex> {
    if (this.sdkInstance) {
      return this.sdkInstance
    }

    const serviceAccount = getVertexAIServiceAccount()
    const projectId = getVertexAIProjectId()
    const location = getVertexAILocation()

    if (!serviceAccount.privateKey || !serviceAccount.clientEmail || !projectId || !location) {
      throw new Error('Vertex AI settings are not configured')
    }

    const authHeaders = await this.getServiceAccountAuthHeaders()

    this.sdkInstance = new AnthropicVertex({
      projectId: projectId,
      region: location,
      dangerouslyAllowBrowser: true,
      defaultHeaders: authHeaders,
      baseURL: isEmpty(this.getBaseURL()) ? undefined : this.getBaseURL()
    })

    return this.sdkInstance
  }

  override async listModels(): Promise<Anthropic.ModelInfo[]> {
    throw new Error('Vertex AI does not support listModels method.')
  }

  /**
   * 获取认证头，如果配置了 service account 则从主进程获取
   */
  private async getServiceAccountAuthHeaders(): Promise<Record<string, string> | undefined> {
    const serviceAccount = getVertexAIServiceAccount()
    const projectId = getVertexAIProjectId()

    // 检查是否配置了 service account
    if (!serviceAccount.privateKey || !serviceAccount.clientEmail || !projectId) {
      return undefined
    }

    // 检查是否已有有效的认证头（提前 5 分钟过期）
    const now = Date.now()
    if (this.authHeaders && this.authHeadersExpiry && this.authHeadersExpiry - now > 5 * 60 * 1000) {
      return this.authHeaders
    }

    try {
      // 从主进程获取认证头
      this.authHeaders = await window.api.vertexAI.getAuthHeaders({
        projectId,
        serviceAccount: {
          privateKey: serviceAccount.privateKey,
          clientEmail: serviceAccount.clientEmail
        }
      })

      // 设置过期时间（通常认证头有效期为 1 小时）
      this.authHeadersExpiry = now + 60 * 60 * 1000

      return this.authHeaders
    } catch (error: any) {
      logger.error('Failed to get auth headers:', error)
      throw new Error(`Service Account authentication failed: ${error.message}`)
    }
  }
}
