/**
 * AI SDK Configuration
 *
 * Shared utilities for converting Cherry Studio Provider to AI SDK configuration.
 * Environment-specific logic (renderer/main) is injected via context interfaces.
 */

import { formatPrivateKey, hasProviderConfig, ProviderConfigFactory } from '@cherrystudio/ai-core/provider'

import { routeToEndpoint } from '../api'
import { getAiSdkProviderId } from './mapping'
import type { MinimalProvider } from './types'
import { SystemProviderIds } from './types'

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
   * Get the rotated API key (for multi-key support)
   * Default: returns first key
   */
  getRotatedApiKey?: (provider: MinimalProvider) => string

  /**
   * Check if a model uses chat completion only (for OpenAI response mode)
   * Default: returns false
   */
  isOpenAIChatCompletionOnlyModel?: (modelId: string) => boolean

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
 * Default simple key rotator - returns first key
 */
function defaultGetRotatedApiKey(provider: MinimalProvider): string {
  const keys = provider.apiKey.split(',').map((k) => k.trim())
  return keys[0] || provider.apiKey
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
  const getRotatedApiKey = context.getRotatedApiKey || defaultGetRotatedApiKey
  const isOpenAIChatCompletionOnlyModel = context.isOpenAIChatCompletionOnlyModel || (() => false)

  const aiSdkProviderId = getAiSdkProviderId(provider)

  // Build base config
  const { baseURL, endpoint } = routeToEndpoint(provider.apiHost)
  const baseConfig = {
    baseURL,
    apiKey: getRotatedApiKey(provider)
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
      includeUsage: true
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
  if (provider.extra_headers) {
    extraOptions.headers = provider.extra_headers
    if (aiSdkProviderId === 'openai') {
      extraOptions.headers = {
        ...(extraOptions.headers as Record<string, string>),
        'HTTP-Referer': 'https://cherry-ai.com',
        'X-Title': 'Cherry Studio',
        'X-Api-Key': baseConfig.apiKey
      }
    }
  }

  // Handle Azure modes
  if (aiSdkProviderId === 'azure-responses') {
    extraOptions.mode = 'responses'
  } else if (aiSdkProviderId === 'azure') {
    extraOptions.mode = 'chat'
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
      includeUsage: true
    }
  }
}
