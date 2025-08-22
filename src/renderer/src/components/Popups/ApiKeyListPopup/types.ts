import { PreprocessProvider, Provider, WebSearchProvider } from '@renderer/types'

/**
 * API key 格式有效性
 */
export type ApiKeyValidity = {
  isValid: boolean
  error?: string
}

export type ApiProvider = Provider | WebSearchProvider | PreprocessProvider

export type UpdateProviderFunc = (p: Partial<Provider>) => void

export type UpdateWebSearchProviderFunc = (p: Partial<WebSearchProvider>) => void

export type UpdatePreprocessProviderFunc = (p: Partial<PreprocessProvider>) => void

export type UpdateApiProviderFunc = UpdateProviderFunc | UpdateWebSearchProviderFunc | UpdatePreprocessProviderFunc
