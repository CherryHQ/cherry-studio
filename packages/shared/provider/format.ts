/**
 * Provider API Host Formatting
 *
 * Utilities for formatting provider API hosts to work with AI SDK.
 * These handle the differences between how Cherry Studio stores API hosts
 * and how AI SDK expects them.
 */

import {
  formatApiHost,
  formatAzureOpenAIApiHost,
  formatOllamaApiHost,
  formatVertexApiHost,
  isWithTrailingSharp,
  routeToEndpoint,
  withoutTrailingSlash
} from '../api'
import {
  isAnthropicProvider,
  isAzureOpenAIProvider,
  isCherryAIProvider,
  isGeminiProvider,
  isOllamaProvider,
  isPerplexityProvider,
  isVertexProvider
} from './detection'
import type { MinimalProvider } from './types'
import { SystemProviderIds } from './types'

/**
 * Interface for environment-specific implementations
 * Renderer and Main process can provide their own implementations
 */
export interface ProviderFormatContext {
  vertex: {
    project: string
    location: string
  }
}

/**
 * Default Azure OpenAI API host formatter
 */
export function defaultFormatAzureOpenAIApiHost(host: string): string {
  const normalizedHost = withoutTrailingSlash(host)
    ?.replace(/\/v1$/, '')
    .replace(/\/openai$/, '')
  // AI SDK will add /v1
  return formatApiHost(normalizedHost + '/openai', false)
}

/**
 * Format provider API host for AI SDK
 *
 * This function normalizes the apiHost to work with AI SDK.
 * Different providers have different requirements:
 * - Most providers: add /v1 suffix
 * - Gemini: add /v1beta suffix
 * - Some providers: no suffix needed
 *
 * @param provider - The provider to format
 * @param context - Optional context with environment-specific implementations
 * @returns Provider with formatted apiHost (and anthropicApiHost if applicable)
 */
export function formatProviderApiHost<T extends MinimalProvider>(provider: T, context: ProviderFormatContext): T {
  const formatted = { ...provider }
  const appendApiVersion = !isWithTrailingSharp(provider.apiHost)
  // Format anthropicApiHost if present
  if (formatted.anthropicApiHost) {
    formatted.anthropicApiHost = formatApiHost(formatted.anthropicApiHost, appendApiVersion)
  }

  // Format based on provider type
  if (isAnthropicProvider(provider)) {
    const baseHost = formatted.anthropicApiHost || formatted.apiHost
    // AI SDK needs /v1 in baseURL
    formatted.apiHost = formatApiHost(baseHost, appendApiVersion)
    if (!formatted.anthropicApiHost) {
      formatted.anthropicApiHost = formatted.apiHost
    }
  } else if (formatted.id === SystemProviderIds.copilot || formatted.id === SystemProviderIds.github) {
    formatted.apiHost = formatApiHost(formatted.apiHost, false)
  } else if (isOllamaProvider(formatted)) {
    formatted.apiHost = formatOllamaApiHost(formatted.apiHost)
  } else if (isGeminiProvider(formatted)) {
    formatted.apiHost = formatApiHost(formatted.apiHost, appendApiVersion, 'v1beta')
  } else if (isAzureOpenAIProvider(formatted)) {
    formatted.apiHost = formatAzureOpenAIApiHost(formatted.apiHost)
  } else if (isVertexProvider(formatted)) {
    formatted.apiHost = formatVertexApiHost(formatted, context.vertex.project, context.vertex.location)
  } else if (isCherryAIProvider(formatted)) {
    formatted.apiHost = formatApiHost(formatted.apiHost, false)
  } else if (isPerplexityProvider(formatted)) {
    formatted.apiHost = formatApiHost(formatted.apiHost, false)
  } else {
    formatted.apiHost = formatApiHost(formatted.apiHost, appendApiVersion)
  }

  return formatted
}

/**
 * Get the base URL for AI SDK from a formatted provider
 *
 * This extracts the baseURL that AI SDK expects, handling
 * the '#' endpoint routing format if present.
 *
 * @param formattedApiHost - The formatted apiHost (after formatProviderApiHost)
 * @returns The baseURL for AI SDK
 */
export function getBaseUrlForAiSdk(formattedApiHost: string): string {
  const { baseURL } = routeToEndpoint(formattedApiHost)
  return baseURL
}

/**
 * Get rotated API key from comma-separated keys
 *
 * This is the interface for API key rotation. The actual implementation
 * depends on the environment (renderer uses window.keyv, main uses its own storage).
 */
export interface ApiKeyRotator {
  /**
   * Get the next API key in rotation
   * @param providerId - The provider ID for tracking rotation
   * @param keys - Comma-separated API keys
   * @returns The next API key to use
   */
  getRotatedKey(providerId: string, keys: string): string
}

/**
 * Simple API key rotator that always returns the first key
 * Use this when rotation is not needed
 */
export const simpleKeyRotator: ApiKeyRotator = {
  getRotatedKey(_providerId: string, keys: string): string {
    const keyList = keys.split(',').map((k) => k.trim())
    return keyList[0] || keys
  }
}
