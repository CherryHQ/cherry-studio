/**
 * This type definition file is only for renderer.
 * It cannot be migrated to @renderer/types since files within it are actually being used by both main and renderer.
 * If we do that, main would throw an error because it cannot import a module which imports a type from a browser-enviroment-only package.
 * (ai-core package is set as browser-enviroment-only)
 *
 * TODO: We should separate them clearly. Keep renderer only types in renderer, and main only types in main, and shared types in shared.
 */

import type { StringKeys } from '@cherrystudio/ai-core/provider'

import type { AppProviderSettingsMap, AppRuntimeConfig } from './merged'

/**
 * Provider 配置
 * 基于 RuntimeConfig，用于构建 provider 实例的基础配置
 */
export type ProviderConfig<T extends StringKeys<AppProviderSettingsMap> = StringKeys<AppProviderSettingsMap>> = Omit<
  AppRuntimeConfig<T>,
  'plugins' | 'provider'
> & {
  /**
   * API endpoint path extracted from baseURL
   * Used for identifying image generation endpoints and other special cases
   * @example 'chat/completions', 'images/generations', 'predict'
   */
  endpoint?: string
}

export type { AppProviderId, AppProviderSettingsMap, AppRuntimeConfig } from './merged'
export { appProviderIds, getAllProviderIds, isRegisteredProviderId } from './merged'
/**
 * Model capability flags computed from model properties and assistant settings.
 * Used by provider-specific option builders to decide which parameters to include.
 */
export interface ProviderCapabilities {
  /**
   * Whether reasoning/thinking parameters should be sent to the provider.
   *
   * True when the model supports reasoning control (thinking token or reasoning effort)
   * AND the user has configured `reasoning_effort` (not `undefined`),
   * or when the model is a fixed reasoning model (e.g. DeepSeek R1).
   *
   * Note: This can be `true` even when `reasoning_effort` is `'none'` — in that case,
   * providers should explicitly disable thinking (e.g. Ollama sets `think: false`).
   */
  enableReasoning: boolean

  /**
   * Whether provider-native web search should be enabled.
   * True when no external search provider is configured AND the model supports built-in web search.
   */
  enableWebSearch: boolean

  /**
   * Whether the model should generate images inline.
   * True when the model supports image generation AND the assistant has it enabled.
   */
  enableGenerateImage: boolean

  /**
   * Whether provider-native URL context should be enabled.
   * True when the assistant has it enabled, the provider supports it,
   * and the model is compatible (currently Gemini or Anthropic).
   */
  enableUrlContext: boolean
}

/**
 * Result of completions operation
 * Simple interface with getText method to retrieve the generated text
 */
export type CompletionsResult = {
  getText: () => string
  usage?: any
}
