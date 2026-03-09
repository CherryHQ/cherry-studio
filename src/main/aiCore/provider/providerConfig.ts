import {
  formatAzureOpenAIApiHost,
  formatOllamaApiHost,
  isAnthropicProvider,
  isAzureOpenAIProvider,
  isCherryAIProvider,
  isGeminiProvider,
  isOllamaProvider,
  isPerplexityProvider,
  isVertexProvider
} from '@shared/aiCore/provider/utils'
import { formatApiHost, isWithTrailingSharp } from '@shared/utils'
import type { Provider } from '@types'
import { SystemProviderIds } from '@types'

import { formatVertexApiHost } from './utils/api'

/**
 * Format and normalize the API host URL for a provider.
 * Handles provider-specific URL formatting rules (e.g., appending version paths, Azure formatting).
 *
 * @param provider - The provider whose API host is to be formatted.
 * @returns A new provider instance with the formatted API host.
 */
export async function formatProviderApiHost(provider: Provider): Promise<Provider> {
  // WARNING: if any changes are made here, please sync it to src/renderer/src/aiCore/provider/providerConfig.ts:formatProviderApiHost
  // NOTE: It's async to support Vertex API host formatting
  const formatted = { ...provider }
  const appendApiVersion = !isWithTrailingSharp(provider.apiHost)
  if (formatted.anthropicApiHost) {
    formatted.anthropicApiHost = formatApiHost(formatted.anthropicApiHost, appendApiVersion)
  }

  if (isAnthropicProvider(provider)) {
    const baseHost = formatted.anthropicApiHost || formatted.apiHost
    // AI SDK needs /v1 in baseURL, Anthropic SDK will strip it in getSdkClient
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
    formatted.apiHost = await formatVertexApiHost(formatted.apiHost)
  } else if (isCherryAIProvider(formatted)) {
    formatted.apiHost = formatApiHost(formatted.apiHost, false)
  } else if (isPerplexityProvider(formatted)) {
    formatted.apiHost = formatApiHost(formatted.apiHost, false)
  } else {
    formatted.apiHost = formatApiHost(formatted.apiHost, appendApiVersion)
  }
  return formatted
}
