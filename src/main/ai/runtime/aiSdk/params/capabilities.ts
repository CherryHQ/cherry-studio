/**
 * Derive per-request capability flags + provider-builtin web search config
 * from (model, provider, assistant).
 *
 * Replaces the capability-detection half of the dead `parameterBuilder.ts`.
 * Read by `agentParams/features/*` to gate plugins like
 * `providerToolPlugin('webSearch' / 'urlContext')` and to let callers
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
  isFixedReasoningModel,
  isFunctionCallingModel,
  isGeminiModel,
  isGenerateImageModel,
  isGrokModel,
  isOpenAIModel,
  isPureGenerateImageModel,
  isSupportedReasoningEffortModel,
  isSupportedThinkingTokenModel
} from '@shared/utils/model'
import { isAIGatewayProvider, isBuiltinWebSearchAvailable, isSupportUrlContextProvider } from '@shared/utils/provider'
import { SystemProviderIds } from '@shared/utils/systemProviderId'

import { getAiSdkProviderId } from '../../../provider/factory'
import type { AppProviderId } from '../../../types'
import { buildProviderBuiltinWebSearchConfig } from '../../../utils/websearch'

export interface ResolvedCapabilities {
  enableReasoning: boolean
  enableWebSearch: boolean
  enableUrlContext: boolean
  enableGenerateImage: boolean
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
  // This flag means the model exposes reasoning behavior, not that the persisted assistant setting
  // enabled it. The request snapshot may legitimately be `none`, `default`, or a freshly selected
  // effort that has not reached assistant persistence yet; the resolver/profile decides what emits.
  const enableReasoning =
    isSupportedThinkingTokenModel(model) || isSupportedReasoningEffortModel(model) || isFixedReasoningModel(model)

  // Built-in web search follows the provider registry's model scope. Most hosts
  // are model-dependent; provider-wide hosts such as OpenRouter can serve every
  // chat model. Non-supporting pairs fall back to the app's own web-search tool.
  const hasExternalSearch = !!options.webSearchProviderId
  const enableWebSearch =
    !hasExternalSearch && !!assistant.settings?.enableWebSearch && isBuiltinWebSearchAvailable(model, provider)

  // Provider-native URL context: the provider must serve it (`serverTools`), the
  // model must be a Gemini/Anthropic-family SKU, and the user must enable it.
  const urlContextSupported =
    isSupportUrlContextProvider(provider) &&
    !isPureGenerateImageModel(model) &&
    (isGeminiModel(model) || isAnthropicModel(model))
  const enableUrlContext = urlContextSupported && !!assistant.settings?.enableUrlContext

  // Native chat-model image output (Gemini `responseModalities`) stays disabled intentionally:
  // image generation is delivered via the `generate_image` tool (gated on `settings.enableGenerateImage`),
  // not this capability. Kept `&& false` so the provider-option plumbing below never fires.
  const enableGenerateImage = isGenerateImageModel(model) && false

  const isSupportedToolUse = isFunctionCallingModel(model)

  const streamOutput = assistant.settings?.streamOutput !== false

  // Build provider-builtin web search config when enabled
  let webSearchPluginConfig: WebSearchPluginConfig | undefined
  if (enableWebSearch) {
    const preferenceService = application.get('PreferenceService')
    const webSearchConfig = {
      maxResults: preferenceService.get('chat.web_search.max_results'),
      excludeDomains: preferenceService.get('chat.web_search.exclude_domains')
    }
    const aiSdkProviderId = getAiSdkProviderId(provider, model)
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
    isSupportedToolUse,
    streamOutput,
    webSearchPluginConfig
  }
}
