/**
 * AI SDK Configuration
 *
 * Shared utilities for converting Cherry Studio Provider to AI SDK configuration.
 * Environment-specific logic (renderer/main) is injected via context interfaces.
 */

import { formatPrivateKey, hasProviderConfig, ProviderConfigFactory } from '@cherrystudio/ai-core/provider'
import { type MinimalProvider, SystemProviderIds } from '@shared/types'
import { defaultAppHeaders } from '@shared/utils'
import {
  isAnthropicProvider,
  isAzureOpenAIProvider,
  isCherryAIProvider,
  isGeminiProvider,
  isOllamaProvider,
  isPerplexityProvider,
  isVertexProvider
} from '@shared/utils/provider'
import { isEmpty } from 'lodash'

import {
  formatApiHost,
  formatAzureOpenAIApiHost,
  formatOllamaApiHost,
  formatVertexApiHost,
  isWithTrailingSharp,
  routeToEndpoint,
  withoutTrailingSlash
} from '../utils/url'
import { getAiSdkProviderId } from './utils'

/**
 * AI SDK configuration result
 */
export interface AiSdkConfig {
  providerId: string
  options: Record<string, unknown>
}

/**
 * Context for environment-specific implementations
 */
export interface AiSdkConfigContext {
  /**
   * Check if a model uses chat completion only (for OpenAI response mode)
   * Default: returns false
   */
  isOpenAIChatCompletionOnlyModel?: (modelId: string) => boolean

  /**
   * Check if provider supports stream options
   * Default: returns true
   */
  isSupportStreamOptionsProvider?: (provider: MinimalProvider) => boolean

  /**
   * Get includeUsage setting for stream options
   * Default: returns undefined
   */
  getIncludeUsageSetting?: () => boolean | undefined | Promise<boolean | undefined>

  /**
   * Get Copilot default headers (constants)
   * Default: returns empty object
   */
  getCopilotDefaultHeaders?: () => Record<string, string>

  /**
   * Get Copilot stored headers from state
   * Default: returns empty object
   */
  getCopilotStoredHeaders?: () => Record<string, string>

  /**
   * Get AWS Bedrock configuration
   * Default: returns undefined (not configured)
   */
  getAwsBedrockConfig?: () =>
    | {
        authType: 'apiKey' | 'iam'
        region: string
        apiKey?: string
        accessKeyId?: string
        secretAccessKey?: string
      }
    | undefined

  /**
   * Get Vertex AI configuration
   * Default: returns undefined (not configured)
   */
  getVertexConfig?: (provider: MinimalProvider) =>
    | {
        project: string
        location: string
        googleCredentials: {
          privateKey: string
          clientEmail: string
        }
      }
    | undefined

  /**
   * Get endpoint type for cherryin provider
   */
  getEndpointType?: (modelId: string) => string | undefined

  /**
   * Custom fetch implementation
   * Main process: use Electron net.fetch
   * Renderer process: use browser fetch (default)
   */
  fetch?: typeof globalThis.fetch

  /**
   * Get CherryAI signed fetch wrapper
   * Returns a fetch function that adds signature headers to requests
   */
  getCherryAISignedFetch?: () => typeof globalThis.fetch
}

/**
 * Convert Cherry Studio Provider to AI SDK configuration
 *
 * @param provider - The formatted provider (after formatProviderApiHost)
 * @param modelId - The model ID to use
 * @param context - Environment-specific implementations
 * @returns AI SDK configuration
 */
export function providerToAiSdkConfig(
  provider: MinimalProvider,
  modelId: string,
  context: AiSdkConfigContext = {}
): AiSdkConfig {
  const isOpenAIChatCompletionOnlyModel = context.isOpenAIChatCompletionOnlyModel || (() => false)
  const isSupportStreamOptionsProvider = context.isSupportStreamOptionsProvider || (() => true)
  const getIncludeUsageSetting = context.getIncludeUsageSetting || (() => undefined)

  const aiSdkProviderId = getAiSdkProviderId(provider)

  // Build base config
  const { baseURL, endpoint } = routeToEndpoint(provider.apiHost)
  const baseConfig = {
    baseURL,
    apiKey: provider.apiKey
  }

  let includeUsage: boolean | undefined = undefined
  if (isSupportStreamOptionsProvider(provider)) {
    const setting = getIncludeUsageSetting()
    includeUsage = setting instanceof Promise ? undefined : setting
  }

  // Handle Copilot specially
  if (provider.id === SystemProviderIds.copilot) {
    const defaultHeaders = context.getCopilotDefaultHeaders?.() ?? {}
    const storedHeaders = context.getCopilotStoredHeaders?.() ?? {}
    const copilotExtraOptions: Record<string, unknown> = {
      headers: {
        ...defaultHeaders,
        ...storedHeaders,
        ...provider.extra_headers
      },
      name: provider.id,
      includeUsage
    }
    if (context.fetch) {
      copilotExtraOptions.fetch = context.fetch
    }
    const options = ProviderConfigFactory.fromProvider(
      'github-copilot-openai-compatible',
      baseConfig,
      copilotExtraOptions
    )

    return {
      providerId: 'github-copilot-openai-compatible',
      options
    }
  }

  if (isOllamaProvider(provider)) {
    return {
      providerId: 'ollama',
      options: {
        ...baseConfig,
        headers: {
          ...provider.extra_headers,
          Authorization: !isEmpty(baseConfig.apiKey) ? `Bearer ${baseConfig.apiKey}` : undefined
        }
      }
    }
  }

  // Build extra options
  const extraOptions: Record<string, unknown> = {}
  if (endpoint) {
    extraOptions.endpoint = endpoint
  }

  // Handle OpenAI mode
  if (provider.type === 'openai-response' && !isOpenAIChatCompletionOnlyModel(modelId)) {
    extraOptions.mode = 'responses'
  } else if (aiSdkProviderId === 'openai' || (aiSdkProviderId === 'cherryin' && provider.type === 'openai')) {
    extraOptions.mode = 'chat'
  }

  // Add extra headers
  const headers: Record<string, string | undefined> = {
    ...defaultAppHeaders(),
    ...provider.extra_headers
  }

  if (aiSdkProviderId === 'openai') {
    headers['X-Api-Key'] = baseConfig.apiKey
  }

  extraOptions.headers = headers

  // Handle Azure modes
  if (aiSdkProviderId === 'azure-responses') {
    extraOptions.mode = 'responses'
  } else if (aiSdkProviderId === 'azure') {
    extraOptions.mode = 'chat'
  }

  if (isAzureOpenAIProvider(provider)) {
    const apiVersion = provider.apiVersion?.trim()
    if (apiVersion) {
      extraOptions.apiVersion = apiVersion
      if (!['preview', 'v1'].includes(apiVersion)) {
        extraOptions.useDeploymentBasedUrls = true
      }
    }
  }

  // Handle AWS Bedrock
  if (aiSdkProviderId === 'bedrock') {
    const bedrockConfig = context.getAwsBedrockConfig?.()
    if (bedrockConfig) {
      extraOptions.region = bedrockConfig.region
      if (bedrockConfig.authType === 'apiKey') {
        extraOptions.apiKey = bedrockConfig.apiKey
      } else {
        extraOptions.accessKeyId = bedrockConfig.accessKeyId
        extraOptions.secretAccessKey = bedrockConfig.secretAccessKey
      }
    }
  }

  // Handle Vertex AI
  if (aiSdkProviderId === 'google-vertex' || aiSdkProviderId === 'google-vertex-anthropic') {
    const vertexConfig = context.getVertexConfig?.(provider)
    if (vertexConfig) {
      extraOptions.project = vertexConfig.project
      extraOptions.location = vertexConfig.location
      extraOptions.googleCredentials = {
        ...vertexConfig.googleCredentials,
        privateKey: formatPrivateKey(vertexConfig.googleCredentials.privateKey)
      }
      baseConfig.baseURL += aiSdkProviderId === 'google-vertex' ? '/publishers/google' : '/publishers/anthropic/models'
    }
  }

  // Handle cherryin endpoint type
  if (aiSdkProviderId === 'cherryin') {
    const endpointType = context.getEndpointType?.(modelId)
    if (endpointType) {
      extraOptions.endpointType = endpointType
    }
  }

  // Handle cherryai signed fetch
  if (provider.id === 'cherryai') {
    const signedFetch = context.getCherryAISignedFetch?.()
    if (signedFetch) {
      extraOptions.fetch = signedFetch
    }
  } else if (context.fetch) {
    extraOptions.fetch = context.fetch
  }

  // Check if AI SDK supports this provider natively
  if (hasProviderConfig(aiSdkProviderId) && aiSdkProviderId !== 'openai-compatible') {
    const options = ProviderConfigFactory.fromProvider(aiSdkProviderId, baseConfig, extraOptions)
    return {
      providerId: aiSdkProviderId,
      options
    }
  }

  // Fallback to openai-compatible
  const options = ProviderConfigFactory.createOpenAICompatible(baseConfig.baseURL, baseConfig.apiKey)
  return {
    providerId: 'openai-compatible',
    options: {
      ...options,
      name: provider.id,
      ...extraOptions,
      includeUsage
    }
  }
}

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
