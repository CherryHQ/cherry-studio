import { GoogleAuth } from 'google-auth-library'

interface ServiceAccountCredentials {
  privateKey: string
  clientEmail: string
}

interface VertexAIAuthParams {
  projectId: string
  serviceAccount?: ServiceAccountCredentials
}

const REQUIRED_VERTEX_AI_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'

class VertexAIService {
  private static instance: VertexAIService
  private authClients: Map<string, GoogleAuth> = new Map()

  static getInstance(): VertexAIService {
    if (!VertexAIService.instance) {
      VertexAIService.instance = new VertexAIService()
    }
    return VertexAIService.instance
  }

  /**
   * 格式化私钥，确保它包含正确的PEM头部和尾部
   */
  private formatPrivateKey(privateKey: string): string {
    if (!privateKey || typeof privateKey !== 'string') {
      throw new Error('Private key must be a non-empty string')
    }

    // 处理JSON字符串中的转义换行符
    let key = privateKey.replace(/\\n/g, '\n')

    // 如果已经是正确格式的PEM，直接返回
    if (key.includes('-----BEGIN PRIVATE KEY-----') && key.includes('-----END PRIVATE KEY-----')) {
      return key
    }

    // 移除所有换行符和空白字符（为了重新格式化）
    key = key.replace(/\s+/g, '')

    // 移除可能存在的头部和尾部
    key = key.replace(/-----BEGIN[^-]*-----/g, '')
    key = key.replace(/-----END[^-]*-----/g, '')

    // 确保私钥不为空
    if (!key) {
      throw new Error('Private key is empty after formatting')
    }

    // 添加正确的PEM头部和尾部，并格式化为64字符一行
    const formattedKey = key.match(/.{1,64}/g)?.join('\n') || key

    return `-----BEGIN PRIVATE KEY-----\n${formattedKey}\n-----END PRIVATE KEY-----`
  }

  /**
   * 获取认证头用于 Vertex AI 请求
   */
  async getAuthHeaders(params: VertexAIAuthParams): Promise<Record<string, string>> {
    const { projectId, serviceAccount } = params

    if (!serviceAccount?.privateKey || !serviceAccount?.clientEmail) {
      throw new Error('Service account credentials are required')
    }

    // 创建缓存键
    const cacheKey = `${projectId}-${serviceAccount.clientEmail}`

    // 检查是否已有客户端实例
    let auth = this.authClients.get(cacheKey)

    if (!auth) {
      try {
        // 格式化私钥
        const formattedPrivateKey = this.formatPrivateKey(serviceAccount.privateKey)

        // 创建新的认证客户端
        auth = new GoogleAuth({
          credentials: {
            private_key: formattedPrivateKey,
            client_email: serviceAccount.clientEmail
          },
          projectId,
          scopes: [REQUIRED_VERTEX_AI_SCOPE]
        })

        this.authClients.set(cacheKey, auth)
      } catch (formatError: any) {
        throw new Error(`Invalid private key format: ${formatError.message}`)
      }
    }

    try {
      // 获取认证头
      const authHeaders = await auth.getRequestHeaders()

      // 转换为普通对象
      const headers: Record<string, string> = {}
      for (const [key, value] of Object.entries(authHeaders)) {
        if (typeof value === 'string') {
          headers[key] = value
        }
      }

      return headers
    } catch (error: any) {
      // 如果认证失败，清除缓存的客户端
      this.authClients.delete(cacheKey)
      throw new Error(`Failed to authenticate with service account: ${error.message}`)
    }
  }

  async getAccessToken(params: VertexAIAuthParams): Promise<string> {
    const { projectId, serviceAccount } = params

    if (!serviceAccount?.privateKey || !serviceAccount?.clientEmail) {
      throw new Error('Service account credentials are required')
    }

    const formattedPrivateKey = this.formatPrivateKey(serviceAccount.privateKey)

    const cacheKey = `${projectId}-${serviceAccount.clientEmail}`

    let auth = this.authClients.get(cacheKey)

    if (!auth) {
      auth = new GoogleAuth({
        credentials: {
          private_key: formattedPrivateKey,
          client_email: serviceAccount.clientEmail
        },
        projectId,
        scopes: [REQUIRED_VERTEX_AI_SCOPE]
      })

      this.authClients.set(cacheKey, auth)
    }

    const accessToken = await auth.getAccessToken()

    return accessToken || ''
  }

  /**
   * 清理指定项目的认证缓存
   */
  clearAuthCache(projectId: string, clientEmail?: string): void {
    if (clientEmail) {
      const cacheKey = `${projectId}-${clientEmail}`
      this.authClients.delete(cacheKey)
    } else {
      // 清理该项目的所有缓存
      for (const [key] of this.authClients) {
        if (key.startsWith(`${projectId}-`)) {
          this.authClients.delete(key)
        }
      }
    }
  }

  /**
   * 清理所有认证缓存
   */
  clearAllAuthCache(): void {
    this.authClients.clear()
  }
}

export default VertexAIService
