/**
 * Derive per-request capability flags + provider-builtin web search config
 * from (model, provider, assistant).
 *
 * Web tool routing is NOT decided here: `scope.webToolRoutes` (the finalized
 * plan from `resolveWebToolRoutes`/`finalizeWebToolRoutes`) is the single
 * source of truth that gates both the client tools and the server features.
 * This module only materialises the server web-search plugin config for the
 * side the plan already selected.
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
  isSupportedReasoningEffortModel,
  isSupportedThinkingTokenModel
} from '@shared/utils/model'
import { isAIGatewayProvider, type WebToolRoutes } from '@shared/utils/provider'
import { SystemProviderIds } from '@shared/utils/systemProviderId'

import { getAiSdkProviderId } from '../../../provider/factory'
import type { AppProviderId } from '../../../types'
import { buildProviderBuiltinWebSearchConfig } from '../../../utils/websearch'

export interface ResolvedCapabilities {
  enableReasoning: boolean
  enableGenerateImage: boolean
  isSupportedToolUse: boolean
  streamOutput: boolean
  webSearchPluginConfig?: WebSearchPluginConfig
}

export interface ResolveCapabilitiesOptions {
  /** The finalized web-tool plan; web routing itself lives on the request scope, not here. */
  webToolRoutes?: WebToolRoutes
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

  // Native chat-model image output (Gemini `responseModalities`) stays disabled intentionally:
  // image generation is delivered via the `generate_image` tool (gated on `settings.enableGenerateImage`),
  // not this capability. Kept `&& false` so the provider-option plumbing below never fires.
  const enableGenerateImage = isGenerateImageModel(model) && false

  const isSupportedToolUse = isFunctionCallingModel(model)

  const streamOutput = assistant.settings?.streamOutput !== false

  // Build provider-builtin web search config when the plan routed search to the server side
  let webSearchPluginConfig: WebSearchPluginConfig | undefined
  if (options.webToolRoutes?.webSearch === 'server') {
    const preferenceService = application.get('PreferenceService')
    const webSearchConfig = {
      maxResults: preferenceService.get('chat.web_search.max_results'),
      excludeDomains: preferenceService.get('chat.web_search.exclude_domains')
    }
    const aiSdkProviderId = getAiSdkProviderId(provider, model)
    if (extensionRegistry.has(aiSdkProviderId)) {
      webSearchPluginConfig = buildProviderBuiltinWebSearchConfig(aiSdkProviderId, webSearchConfig, model, provider)
    } else if (isAIGatewayProvider(provider) || provider.id === SystemProviderIds.gateway) {
      const gatewayProviderId = mapVertexAIGatewayModelToProviderId(model)
      if (gatewayProviderId) {
        webSearchPluginConfig = buildProviderBuiltinWebSearchConfig(gatewayProviderId, webSearchConfig, model, provider)
      }
    }
  }

  return {
    enableReasoning,
    enableGenerateImage,
    isSupportedToolUse,
    streamOutput,
    webSearchPluginConfig
  }
}
