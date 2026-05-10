import type { PreprocessProvider, Provider } from '@renderer/types'
import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'
import type { WebSearchProviderFormUpdate } from '@shared/data/utils/webSearchPreferences'

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

export type ApiProvider = Provider | ResolvedWebSearchProvider | PreprocessProvider

export type UpdateProviderFunc = (p: Partial<Provider>) => void

export type UpdateWebSearchProviderFunc = (p: WebSearchProviderFormUpdate) => void

export type UpdatePreprocessProviderFunc = (p: Partial<PreprocessProvider>) => void

export type UpdateApiProviderFunc = UpdateProviderFunc | UpdateWebSearchProviderFunc | UpdatePreprocessProviderFunc
