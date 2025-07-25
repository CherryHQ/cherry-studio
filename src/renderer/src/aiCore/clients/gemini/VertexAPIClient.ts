import { GoogleGenAI } from '@google/genai'
import { loggerService } from '@logger'
import { getVertexAILocation, getVertexAIProjectId, getVertexAIServiceAccount } from '@renderer/hooks/useVertexAI'
import { Model, Provider } from '@renderer/types'
import { isEmpty } from 'lodash'

import { AnthropicVertexClient } from '../anthropic/AnthropicVertexClient'
import { GeminiAPIClient } from './GeminiAPIClient'

const logger = loggerService.withContext('VertexAPIClient')
export class VertexAPIClient extends GeminiAPIClient {
  private authHeaders?: Record<string, string>
  private authHeadersExpiry?: number
  private anthropicVertexClient: AnthropicVertexClient

  constructor(provider: Provider) {
    super(provider)
    this.anthropicVertexClient = new AnthropicVertexClient(provider)
  }

  override getClientCompatibilityType(model?: Model): string[] {
    if (!model) {
      return [this.constructor.name]
    }

    const actualClient = this.getClient(model)
    if (actualClient === this) {
      return [this.constructor.name]
    }

    return actualClient.getClientCompatibilityType(model)
  }

  public getClient(model: Model) {
    if (model.id.includes('claude')) {
      return this.anthropicVertexClient
    }
    return this
  }

  private formatApiHost(baseUrl: string) {
    if (baseUrl.endsWith('/v1/')) {
      baseUrl = baseUrl.slice(0, -4)
    } else if (baseUrl.endsWith('/v1')) {
      baseUrl = baseUrl.slice(0, -3)
    }
    return baseUrl
  }

  override getBaseURL() {
    return this.formatApiHost(this.provider.apiHost)
  }

  override async getSdkInstance() {
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

    this.sdkInstance = new GoogleGenAI({
      vertexai: true,
      project: projectId,
      location: location,
      httpOptions: {
        apiVersion: this.getApiVersion(),
        headers: authHeaders,
        baseUrl: isEmpty(this.getBaseURL()) ? undefined : this.getBaseURL()
      }
    })

    return this.sdkInstance
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

  /**
   * 清理认证缓存并重新初始化
   */
  clearAuthCache(): void {
    this.authHeaders = undefined
    this.authHeadersExpiry = undefined

    const serviceAccount = getVertexAIServiceAccount()
    const projectId = getVertexAIProjectId()

    if (projectId && serviceAccount.clientEmail) {
      window.api.vertexAI.clearAuthCache(projectId, serviceAccount.clientEmail)
    }
  }
}
