import { Model, PreprocessProvider, Provider, WebSearchProvider } from '@renderer/types'

/**
 * API Key 连通性检查的状态
 */
export type ApiKeyConnectivity = {
  status: 'success' | 'error' | 'not_checked'
  checking?: boolean
  error?: string
  model?: Model
  latency?: number
}

/**
 * API key 及其连通性检查的状态
 */
export type ApiKeyWithStatus = {
  key: string
} & ApiKeyConnectivity

/**
 * API key 格式有效性
 */
export type ApiKeyValidity = {
  isValid: boolean
  error?: string
}

export type ApiProviderUnion = Provider | WebSearchProvider | PreprocessProvider

export type ApiProviderKind = 'llm' | 'websearch' | 'doc-preprocess'
