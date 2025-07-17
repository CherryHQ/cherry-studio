/**
 * Provider 相关核心类型定义
 * 只定义必要的接口，其他类型直接使用 AI SDK
 */

// Provider 配置接口（简化版）
export interface ProviderConfig {
  id: string
  name: string
  import: () => Promise<any>
  creatorFunctionName: string
}

// API 客户端工厂接口
export interface ApiClientFactory {
  createAiSdkClient(providerId: string, options?: any): Promise<any>
  getCachedClient(providerId: string, options?: any): any
  clearCache(): void
}

// 客户端配置
export interface ClientConfig {
  providerId: string
  apiKey?: string
  baseURL?: string
  [key: string]: any
}

// 错误类型
export class ProviderError extends Error {
  constructor(
    message: string,
    public providerId: string,
    public code?: string,
    public cause?: Error
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

// 缓存统计信息
export interface CacheStats {
  size: number
  keys: string[]
  lastCleanup?: Date
}
