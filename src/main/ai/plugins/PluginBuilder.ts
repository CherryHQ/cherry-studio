import type { AiPlugin } from '@cherrystudio/ai-core'
import { createPromptToolUsePlugin, providerToolPlugin } from '@cherrystudio/ai-core/built-in/plugins'
import { application } from '@main/core/application'
import type { WebSearchProviderId } from '@shared/data/preference/preferenceTypes'
import type { Assistant } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import {
  isAnthropicModel,
  isGemini3Model,
  isQwen35to39Model,
  isSupportedThinkingTokenQwenModel
} from '@shared/utils/model'
import {
  isAwsBedrockProvider,
  isAzureOpenAIProvider,
  isOllamaProvider,
  isSupportEnableThinkingProvider
} from '@shared/utils/provider'
import { SystemProviderIds } from '@types'

import type { ResolvedCapabilities } from '../capabilities'
import { getAiSdkProviderId } from '../provider/factory'
import { getReasoningTagName } from '../utils/reasoning'
import { createAnthropicCachePlugin } from './anthropicCachePlugin'
import { createAnthropicHeadersPlugin } from './anthropicHeadersPlugin'
import { createModelParamsPlugin } from './modelParamsPlugin'
import { createNoThinkPlugin } from './noThinkPlugin'
import { createOpenrouterReasoningPlugin } from './openrouterReasoningPlugin'
import { createPdfCompatibilityPlugin } from './pdfCompatibilityPlugin'
import { createQwenThinkingPlugin } from './qwenThinkingPlugin'
import { createReasoningExtractionPlugin } from './reasoningExtractionPlugin'
import { searchOrchestrationPlugin } from './searchOrchestrationPlugin'
import { createSimulateStreamingPlugin } from './simulateStreamingPlugin'
import { createSkipGeminiThoughtSignaturePlugin } from './skipGeminiThoughtSignaturePlugin'
import { createSystemPromptPlugin } from './systemPromptPlugin'
import { createTelemetryPlugin } from './telemetryPlugin'

export interface BuildPluginsContext {
  provider: Provider
  model: Model
  assistant: Assistant
  capabilities: ResolvedCapabilities
  /** MCP tool ids attached to this request — only `length > 0` is needed by plugins. */
  mcpToolIds?: string[]
  topicId?: string
  /** External 3rd-party web search provider id (Tavily / Bocha / etc.). When
   *  set, `searchOrchestrationPlugin` will inject the `builtin_web_search` tool.
   *  TODO: Plumb this through from the AiStreamRequest once the renderer chat
   *  flow surfaces a per-assistant web search provider selection. */
  webSearchProviderId?: WebSearchProviderId
}

/**
 * Build the conditional plugin list for an AI request.
 *
 * Mirrors the original renderer `PluginBuilder` decision tree (now deleted),
 * adapted to Main-side context sources.
 *
 * `reasoningTimePlugin` was commented out in the original renderer builder
 * and remains unwired here to preserve parity.
 *
 * `searchOrchestrationPlugin` is wired but only fires when at least one of
 * its tools has a viable execution path:
 *   - `webSearchProviderId` is provided (external 3rd-party search), OR
 *   - the assistant has `knowledgeBaseIds.length > 0`.
 * Memory storage is gone — `MemoryProcessor` was deleted upstream.
 */
export function buildPlugins(ctx: BuildPluginsContext): AiPlugin[] {
  const { provider, model, assistant, capabilities, mcpToolIds, topicId, webSearchProviderId } = ctx
  const plugins: AiPlugin<any, any>[] = []

  // Telemetry — only when developer mode is on AND we have a topicId to
  // attribute spans to. Must run first so the tracer is injected before any
  // other plugin transforms `experimental_telemetry`.
  if (topicId && application.get('PreferenceService').get('app.developer_mode.enabled')) {
    plugins.push(createTelemetryPlugin({ topicId, modelName: model.name ?? model.id }))
  }

  // Model params — temperature / topP / maxOutputTokens. Capability-aware:
  // handles Claude reasoning disabling temperature, isMaxTemperatureOneModel
  // clamping, mutually exclusive temp/topP, Claude thinking-token budget
  // subtraction, and Claude reasoning topP clamping.
  plugins.push(createModelParamsPlugin({ assistant, model, provider }))

  // System prompt — resolves `{{date}}` / `{{username}}` / `{{model_name}}`
  // etc. and appends the hub-mode system prompt when MCP mode is 'auto'.
  // Owns `params.system` entirely; AiService leaves agentSettings.instructions
  // undefined so this is the single source of truth.
  plugins.push(createSystemPromptPlugin({ assistant, model }))

  // PDF compatibility — must run before Anthropic cache so cache token
  // estimation accounts for the extracted text (PDFs become TextParts for
  // providers that can't natively consume `file` content).
  plugins.push(createPdfCompatibilityPlugin(provider, model))

  // Reasoning extraction for OpenAI-family and Azure-OpenAI providers.
  // Must be pushed BEFORE simulateStreaming so that after `wrapLanguageModel`
  // reverses the middleware chain, extractReasoning wraps simulateStreaming
  // and can resolve unclosed <think> tags produced by the simulated stream.
  const aiSdkProviderId = getAiSdkProviderId(provider)
  const isOpenAIFamilyProvider =
    isAzureOpenAIProvider(provider) ||
    aiSdkProviderId === 'openai' ||
    aiSdkProviderId === 'openai-chat' ||
    aiSdkProviderId === 'openai-response' ||
    aiSdkProviderId === 'openai-compatible'
  if (isOpenAIFamilyProvider) {
    const tagName = getReasoningTagName(model.id.toLowerCase())
    plugins.push(createReasoningExtractionPlugin({ tagName }))
  }

  // Non-streaming models: wrap generate() as a single-chunk stream.
  if (!capabilities.streamOutput) {
    plugins.push(createSimulateStreamingPlugin())
  }

  // Anthropic prompt caching — gate on provider-level cacheControl settings.
  if (provider.settings?.cacheControl?.enabled && provider.settings.cacheControl.tokenThreshold) {
    plugins.push(createAnthropicCachePlugin(provider))
  }

  // Anthropic beta headers — Claude 4.5 reasoning + tool use, Claude 4 +
  // Vertex + web search. Bedrock handles this via `providerOptions.bedrock.
  // anthropicBeta` inside `buildBedrockProviderOptions`, so skip it here.
  if (isAnthropicModel(model) && !isAwsBedrockProvider(provider)) {
    plugins.push(createAnthropicHeadersPlugin({ assistant, model, provider }))
  }

  // OpenRouter reasoning-redacted block stripping.
  if (provider.id === SystemProviderIds.openrouter) {
    plugins.push(createOpenrouterReasoningPlugin())
  }

  // OVMS backend needs /no_think suffix when MCP tools are present.
  if (provider.id === 'ovms' && mcpToolIds && mcpToolIds.length > 0) {
    plugins.push(createNoThinkPlugin())
  }

  // Qwen thinking toggle for providers that don't support the native
  // `enable_thinking` parameter (e.g. non-Ollama Qwen serving).
  if (
    !isOllamaProvider(provider) &&
    isSupportedThinkingTokenQwenModel(model) &&
    !isQwen35to39Model(model) &&
    !isSupportEnableThinkingProvider(provider)
  ) {
    const enableThinking = assistant.settings?.reasoning_effort !== undefined
    plugins.push(createQwenThinkingPlugin(enableThinking))
  }

  // Gemini 3 via OpenAI-compatible API: inject thought_signature on tool calls.
  if (isGemini3Model(model)) {
    plugins.push(createSkipGeminiThoughtSignaturePlugin())
  }

  // Provider built-in tools — dispatched by ai-core's extension registry.
  if (capabilities.enableWebSearch && capabilities.webSearchPluginConfig) {
    plugins.push(providerToolPlugin('webSearch', capabilities.webSearchPluginConfig))
  }

  if (capabilities.enableUrlContext) {
    plugins.push(providerToolPlugin('urlContext'))
  }

  // Search orchestration — runs an LLM intent analyser then conditionally
  // injects `builtin_web_search` and / or `builtin_knowledge_search` tools.
  // Skipped entirely when neither source is configured to avoid the wasted
  // intent-analysis LLM round-trip.
  const hasExternalWebSearch = !!webSearchProviderId
  const hasKnowledgeBases = (assistant.knowledgeBaseIds?.length ?? 0) > 0
  if (hasExternalWebSearch || hasKnowledgeBases) {
    plugins.push(
      searchOrchestrationPlugin({
        assistant,
        topicId: topicId ?? '',
        webSearchProviderId
      })
    )
  }

  // Prompt-mode tool use (XML <tool_use> blocks) for models that don't support
  // native function calling or when the user opts into prompt mode.
  if (capabilities.isPromptToolUse) {
    plugins.push(
      createPromptToolUsePlugin({
        enabled: true,
        mcpMode: assistant.settings?.mcpMode ?? 'auto'
      })
    )
  }

  return plugins
}
