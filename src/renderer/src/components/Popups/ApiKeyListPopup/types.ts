import type { PreprocessProvider, WebSearchProvider } from '@renderer/types'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

/**
 * API key 格式有效性
 */
export type ApiKeyValidity =
  | {
      isValid: true
      error?: never
    }
  | {
      isValid: false
      error: string
    }

export type LlmApiProvider = {
  kind: 'llm'
  id: string
  apiKey: string
  enabled: boolean
  models: Model[]
  sourceProvider: Provider
}

export type ApiProvider = LlmApiProvider | WebSearchProvider | PreprocessProvider

export type UpdateLlmApiProviderFunc = (p: { apiKey: string }) => void

export type UpdateWebSearchProviderFunc = (p: Partial<WebSearchProvider>) => void

export type UpdatePreprocessProviderFunc = (p: Partial<PreprocessProvider>) => void

export type UpdateApiProviderFunc =
  | UpdateLlmApiProviderFunc
  | UpdateWebSearchProviderFunc
  | UpdatePreprocessProviderFunc
