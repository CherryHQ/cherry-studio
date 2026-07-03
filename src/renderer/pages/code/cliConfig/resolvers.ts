import type { EndpointType, Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { formatApiHost } from '@shared/utils/api'

import {
  CODEX_CHAT_ENDPOINT,
  CODEX_RESPONSES_ENDPOINT,
  GEMINI_AGGREGATOR_BASE_URLS,
  OPEN_CODE_ENDPOINTS
} from './constants'

export interface OpenCodeNpmInfo {
  npm: string
  providerType: 'anthropic' | 'google' | 'openai' | 'openai-compatible'
  endpointType: EndpointType
}

export function resolveGeminiBaseUrl(provider: Provider): string {
  return (
    GEMINI_AGGREGATOR_BASE_URLS[provider.id] ?? provider.endpointConfigs?.['google-generate-content']?.baseUrl ?? ''
  )
}

export function resolveOpenAIBaseUrl(provider: Provider): string {
  const responses = provider.endpointConfigs?.[CODEX_RESPONSES_ENDPOINT]?.baseUrl
  const chat = provider.endpointConfigs?.[CODEX_CHAT_ENDPOINT]?.baseUrl
  return formatApiHost(responses ?? chat)
}

function toOpenCodeNpmInfo(endpointType: EndpointType): OpenCodeNpmInfo {
  switch (endpointType) {
    case 'google-generate-content':
      return { npm: '@ai-sdk/google', providerType: 'google', endpointType }
    case 'anthropic-messages':
      return { npm: '@ai-sdk/anthropic', providerType: 'anthropic', endpointType }
    case 'openai-responses':
      return { npm: '@ai-sdk/openai', providerType: 'openai', endpointType }
    default:
      return { npm: '@ai-sdk/openai-compatible', providerType: 'openai-compatible', endpointType }
  }
}

export function resolveOpenCodeNpmInfo(provider: Provider, modelEndpointTypes?: EndpointType[]): OpenCodeNpmInfo {
  const hasEndpoint = (type: EndpointType) => Boolean(provider.endpointConfigs?.[type]?.baseUrl)
  const isSupported = (type: EndpointType | undefined): type is EndpointType =>
    Boolean(type && OPEN_CODE_ENDPOINTS.includes(type))

  const endpointType =
    modelEndpointTypes?.find((type) => isSupported(type) && hasEndpoint(type)) ??
    (isSupported(provider.defaultChatEndpoint) && hasEndpoint(provider.defaultChatEndpoint)
      ? provider.defaultChatEndpoint
      : undefined) ??
    OPEN_CODE_ENDPOINTS.find(hasEndpoint) ??
    'openai-chat-completions'

  return toOpenCodeNpmInfo(endpointType)
}

export function modelSupportsReasoningEffort(modelRecord: Model | null): boolean {
  return !!modelRecord?.reasoning?.supportedEfforts?.length
}
