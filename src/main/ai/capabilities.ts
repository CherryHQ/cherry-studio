/**
 * Derive per-request capability flags + provider-builtin web search config
 * from (model, provider, assistant).
 *
 * Replaces the capability-detection half of the dead `parameterBuilder.ts`.
 * Consumed by `PluginBuilder.buildPlugins` to conditionally wire plugins
 * like `providerToolPlugin('webSearch' / 'urlContext')` and to let callers
 * set `streamOutput` / tool-use flags without duplicating these checks.
 */

import { application } from '@application'
import type { WebSearchPluginConfig } from '@cherrystudio/ai-core/built-in/plugins'
import { extensionRegistry } from '@cherrystudio/ai-core/provider'
import type { Assistant } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import {
  isAnthropicModel,
  isFunctionCallingModel,
  isGeminiModel,
  isGenerateImageModel,
  isGrokModel,
  isOpenAIModel,
  isOpenRouterBuiltInWebSearchModel,
  isPureGenerateImageModel,
  isSupportedReasoningEffortModel,
  isSupportedThinkingTokenModel,
  isWebSearchModel
} from '@shared/utils/model'
import { isAIGatewayProvider, isSupportUrlContextProvider } from '@shared/utils/provider'
import { SystemProviderIds } from '@types'

import { getAiSdkProviderId } from './provider/factory'
import type { AppProviderId } from './types'
import { buildProviderBuiltinWebSearchConfig } from './utils/websearch'

export interface ResolvedCapabilities {
  enableReasoning: boolean
  enableWebSearch: boolean
  enableUrlContext: boolean
  enableGenerateImage: boolean
  isPromptToolUse: boolean
  isSupportedToolUse: boolean
  streamOutput: boolean
  webSearchPluginConfig?: WebSearchPluginConfig
}

export interface ResolveCapabilitiesOptions {
  /** Caller-supplied external web search provider id. When set, disables built-in web search. */
  webSearchProviderId?: string
}

function mapVertexAIGatewayModelToProviderId(model: Model): AppProviderId | undefined {
  if (isAnthropicModel(model)) return 'anthropic'
  if (isGeminiModel(model)) return 'google'
  if (isGrokModel(model)) return 'xai'
  if (isOpenAIModel(model)) return 'openai'
  return undefined
}

export function resolveCapabilities(
  model: Model,
  provider: Provider,
  assistant: Assistant,
  options: ResolveCapabilitiesOptions = {}
): ResolvedCapabilities {
  const enableReasoning =
    (isSupportedThinkingTokenModel(model) || isSupportedReasoningEffortModel(model)) &&
    assistant.settings?.reasoning_effort !== undefined

  const hasExternalSearch = !!options.webSearchProviderId
  const enableWebSearch =
    !hasExternalSearch &&
    ((!!assistant.settings?.enableWebSearch && isWebSearchModel(model)) ||
      isOpenRouterBuiltInWebSearchModel(model) ||
      model.id.includes('sonar'))

  // V1 renderer had top-level `assistant.enableUrlContext` / `enableGenerateImage`
  // toggles. The V2 shared `Assistant` schema has not migrated these yet, so the
  // remote-only checks stay guarded and the toggles default to `false`.
  const urlContextSupported =
    isSupportUrlContextProvider(provider) &&
    !isPureGenerateImageModel(model) &&
    (isGeminiModel(model) || isAnthropicModel(model))
  const enableUrlContext = urlContextSupported && false

  const enableGenerateImage = isGenerateImageModel(model) && false

  const toolUseMode = assistant.settings?.toolUseMode
  const isPromptToolUse = toolUseMode === 'prompt'
  const isSupportedToolUse = toolUseMode === 'function' && isFunctionCallingModel(model)

  const streamOutput = assistant.settings?.streamOutput !== false

  // Build provider-builtin web search config when enabled
  let webSearchPluginConfig: WebSearchPluginConfig | undefined
  if (enableWebSearch) {
    const preferenceService = application.get('PreferenceService')
    const webSearchConfig = {
      maxResults: preferenceService.get('chat.web_search.max_results'),
      excludeDomains: preferenceService.get('chat.web_search.exclude_domains')
    }
    const aiSdkProviderId = getAiSdkProviderId(provider)
    if (extensionRegistry.has(aiSdkProviderId)) {
      webSearchPluginConfig = buildProviderBuiltinWebSearchConfig(aiSdkProviderId, webSearchConfig, model)
    } else if (isAIGatewayProvider(provider) || provider.id === SystemProviderIds.gateway) {
      const gatewayProviderId = mapVertexAIGatewayModelToProviderId(model)
      if (gatewayProviderId) {
        webSearchPluginConfig = buildProviderBuiltinWebSearchConfig(gatewayProviderId, webSearchConfig, model)
      }
    }
  }

  return {
    enableReasoning,
    enableWebSearch,
    enableUrlContext,
    enableGenerateImage,
    isPromptToolUse,
    isSupportedToolUse,
    streamOutput,
    webSearchPluginConfig
  }
}
