import type { Provider } from '@shared/data/types/provider'
import { isApiGatewayProviderId } from '@shared/types/codeCli'
import { withoutTrailingSlash } from '@shared/utils/api'

const GEMINI_AGGREGATOR_BASE_URLS: Readonly<Record<string, string>> = {
  aihubmix: 'https://aihubmix.com/gemini'
}

/** Resolve the Gemini-compatible base URL shared by file config and session launch. */
export function resolveGeminiBaseUrl(provider: Provider): string {
  if (isApiGatewayProviderId(provider.id)) {
    const configs = provider.endpointConfigs ?? {}
    return configs['anthropic-messages']?.baseUrl ?? Object.values(configs)[0]?.baseUrl ?? ''
  }

  const dedicated = provider.endpointConfigs?.['google-generate-content']?.baseUrl
  if (dedicated) return dedicated

  const chatBaseUrl = provider.defaultChatEndpoint
    ? provider.endpointConfigs?.[provider.defaultChatEndpoint]?.baseUrl
    : undefined
  if (GEMINI_AGGREGATOR_BASE_URLS[provider.id]) {
    if (!chatBaseUrl) return GEMINI_AGGREGATOR_BASE_URLS[provider.id]
    return `${withoutTrailingSlash(chatBaseUrl).replace(/\/v1$/, '')}/gemini`
  }
  return chatBaseUrl || ''
}
