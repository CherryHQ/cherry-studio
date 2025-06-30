import { GoogleGenAI } from '@google/genai'
import { createVertexProvider, isVertexProvider } from '@renderer/hooks/useVertexAI'
import { Provider, VertexProvider } from '@renderer/types'

import { GeminiAPIClient } from './GeminiAPIClient'

export class VertexAPIClient extends GeminiAPIClient {
  private authHeaders?: Record<string, string>
  private authHeadersExpiry?: number
  private vertexProvider: VertexProvider

  constructor(provider: Provider) {
    super(provider)

    // 如果传入的是普通 Provider，转换为 VertexProvider
    if (isVertexProvider(provider)) {
      this.vertexProvider = provider
    } else {
      this.vertexProvider = createVertexProvider(provider)
    }
  }

  override async getSdkInstance() {
    if (this.sdkInstance) {
      return this.sdkInstance
    }

    const { googleCredentials, project, location } = this.vertexProvider

    if (!googleCredentials.privateKey || !googleCredentials.clientEmail || !project || !location) {
      throw new Error('Vertex AI settings are not configured')
    }

    const authHeaders = await this.getServiceAccountAuthHeaders()

    this.sdkInstance = new GoogleGenAI({
      vertexai: true,
      project: project,
      location: location,
      httpOptions: {
        apiVersion: this.getApiVersion(),
        headers: authHeaders
      }
    })

    return this.sdkInstance
  }

  /**
   * 获取认证头，如果配置了 service account 则从主进程获取
   */
  private async getServiceAccountAuthHeaders(): Promise<Record<string, string> | undefined> {
    const { googleCredentials, project } = this.vertexProvider

    // 检查是否配置了 service account
    if (!googleCredentials.privateKey || !googleCredentials.clientEmail || !project) {
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
        projectId: project,
        serviceAccount: {
          privateKey: googleCredentials.privateKey,
          clientEmail: googleCredentials.clientEmail
        }
      })

      // 设置过期时间（通常认证头有效期为 1 小时）
      this.authHeadersExpiry = now + 60 * 60 * 1000

      return this.authHeaders
    } catch (error: any) {
      console.error('Failed to get auth headers:', error)
      throw new Error(`Service Account authentication failed: ${error.message}`)
    }
  }

  /**
   * 清理认证缓存并重新初始化
   */
  clearAuthCache(): void {
    this.authHeaders = undefined
    this.authHeadersExpiry = undefined

    const { googleCredentials, project } = this.vertexProvider

    if (project && googleCredentials.clientEmail) {
      window.api.vertexAI.clearAuthCache(project, googleCredentials.clientEmail)
    }
  }
}
