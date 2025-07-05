import { Model, Provider, WebSearchProvider } from '@renderer/types'

/**
 * API key 连通性检查的状态接口
 */
export type ApiKeyStatus = {
  key: string
  connectivity: 'success' | 'error' | 'not_checked'
  checking?: boolean
  error?: string
  model?: Model
  latency?: number
}

/**
 * API Key 连通性检查的 UI 状态接口
 */
export type ConnectivityState = Omit<ApiKeyStatus, 'key'>

/**
 * API key 格式有效性
 */
export type ApiKeyValidity = {
  isValid: boolean
  error?: string
}

export type ProviderUnion = Provider | WebSearchProvider

export type ApiKeySourceType = 'llm-provider' | 'websearch-provider'
