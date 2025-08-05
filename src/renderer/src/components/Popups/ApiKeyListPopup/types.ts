import { PreprocessProvider, Provider, WebSearchProvider } from '@renderer/types'

/**
 * API key 格式有效性
 */
export type ApiKeyValidity = {
  isValid: boolean
  error?: string
}

export type ApiProviderUnion = Provider | WebSearchProvider | PreprocessProvider

export type ApiProviderKind = 'llm' | 'websearch' | 'doc-preprocess'
