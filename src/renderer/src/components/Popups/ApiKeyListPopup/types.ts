import type { PreprocessProvider, Provider } from '@renderer/types'

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

export type ApiProvider = Provider | PreprocessProvider

export type UpdateProviderFunc = (p: Partial<Provider>) => void

export type UpdatePreprocessProviderFunc = (p: Partial<PreprocessProvider>) => void

export type UpdateApiProviderFunc = UpdateProviderFunc | UpdatePreprocessProviderFunc
