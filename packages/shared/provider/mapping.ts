/**
 * Provider ID Mapping
 *
 * Maps Cherry Studio provider IDs/types to AI SDK provider IDs.
 * This logic should match @renderer/aiCore/provider/factory.ts
 */

import { hasProviderConfigByAlias, type ProviderId, resolveProviderConfigId } from '@cherrystudio/ai-core/provider'

import { isAzureOpenAIProvider, isAzureResponsesEndpoint } from './detection'
import type { MinimalProvider } from './types'

/**
 * Static mapping from Cherry Studio provider ID/type to AI SDK provider ID
 * Matches STATIC_PROVIDER_MAPPING in @renderer/aiCore/provider/factory.ts
 */
export const STATIC_PROVIDER_MAPPING: Record<string, ProviderId> = {
  gemini: 'google', // Google Gemini -> google
  'azure-openai': 'azure', // Azure OpenAI -> azure
  'openai-response': 'openai', // OpenAI Responses -> openai
  grok: 'xai', // Grok -> xai
  copilot: 'github-copilot-openai-compatible'
}

/**
 * Try to resolve a provider identifier to an AI SDK provider ID
 * Matches tryResolveProviderId in @renderer/aiCore/provider/factory.ts
 *
 * @param identifier - The provider ID or type to resolve
 * @param checker - Provider config checker (defaults to static mapping only)
 * @returns The resolved AI SDK provider ID, or null if not found
 */
export function tryResolveProviderId(identifier: string): ProviderId | null {
  // 1. 检查静态映射
  const staticMapping = STATIC_PROVIDER_MAPPING[identifier]
  if (staticMapping) {
    return staticMapping
  }

  // 2. 检查AiCore是否支持（包括别名支持）
  if (hasProviderConfigByAlias(identifier)) {
    // 解析为真实的Provider ID
    return resolveProviderConfigId(identifier) as ProviderId
  }

  return null
}

/**
 * Get the AI SDK Provider ID for a Cherry Studio provider
 * Matches getAiSdkProviderId in @renderer/aiCore/provider/factory.ts
 *
 * Logic:
 * 1. Handle Azure OpenAI specially (check responses endpoint)
 * 2. Try to resolve from provider.id
 * 3. Try to resolve from provider.type (but not for generic 'openai' type)
 * 4. Check for OpenAI API host pattern
 * 5. Fallback to provider's own ID
 *
 * @param provider - The Cherry Studio provider
 * @param checker - Provider config checker (defaults to static mapping only)
 * @returns The AI SDK provider ID to use
 */
export function getAiSdkProviderId(provider: MinimalProvider): ProviderId {
  // 1. Handle Azure OpenAI specially - check this FIRST before other resolution
  if (isAzureOpenAIProvider(provider)) {
    if (isAzureResponsesEndpoint(provider)) {
      return 'azure-responses'
    }
    return 'azure'
  }

  // 2. 尝试解析provider.id
  const resolvedFromId = tryResolveProviderId(provider.id)
  if (resolvedFromId) {
    return resolvedFromId
  }

  // 3. 尝试解析provider.type
  // 会把所有类型为openai的自定义provider解析到aisdk的openaiProvider上
  if (provider.type !== 'openai') {
    const resolvedFromType = tryResolveProviderId(provider.type)
    if (resolvedFromType) {
      return resolvedFromType
    }
  }

  // 4. Check for OpenAI API host pattern
  if (provider.apiHost.includes('api.openai.com')) {
    return 'openai-chat'
  }

  // 5. 最后的fallback（使用provider本身的id）
  return provider.id
}
