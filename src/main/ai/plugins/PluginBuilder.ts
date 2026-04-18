import type { AiPlugin } from '@cherrystudio/ai-core'
import { createPromptToolUsePlugin, providerToolPlugin } from '@cherrystudio/ai-core/built-in/plugins'
import type { Assistant } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isGemini3Model, isQwen35to39Model, isSupportedThinkingTokenQwenModel } from '@shared/utils/model'
import { isAzureOpenAIProvider, isOllamaProvider, isSupportEnableThinkingProvider } from '@shared/utils/provider'
import { SystemProviderIds } from '@types'

import type { ResolvedCapabilities } from '../capabilities'
import { getAiSdkProviderId } from '../provider/factory'
import { getReasoningTagName } from '../utils/reasoning'
import { createAnthropicCachePlugin } from './anthropicCachePlugin'
import { createNoThinkPlugin } from './noThinkPlugin'
import { createOpenrouterReasoningPlugin } from './openrouterReasoningPlugin'
import { createPdfCompatibilityPlugin } from './pdfCompatibilityPlugin'
import { createQwenThinkingPlugin } from './qwenThinkingPlugin'
import { createReasoningExtractionPlugin } from './reasoningExtractionPlugin'
import { createSimulateStreamingPlugin } from './simulateStreamingPlugin'
import { createSkipGeminiThoughtSignaturePlugin } from './skipGeminiThoughtSignaturePlugin'

export interface BuildPluginsContext {
  provider: Provider
  model: Model
  assistant: Assistant
  capabilities: ResolvedCapabilities
  /** MCP tool ids attached to this request — only `length > 0` is needed by plugins. */
  mcpToolIds?: string[]
  topicId?: string
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
 * `telemetryPlugin` and `searchOrchestrationPlugin` are intentionally NOT
 * wired yet — they depend on Main-side infrastructure (`SpanManagerService`
 * equivalent for telemetry, `MemoryProcessor` + `KnowledgeSearchTool` for
 * search orchestration) that was deleted with the renderer aiCore and has
 * not been re-implemented on Main. Wiring them here would crash at import.
 */
export function buildPlugins(ctx: BuildPluginsContext): AiPlugin[] {
  const { provider, model, assistant, capabilities, mcpToolIds } = ctx
  const plugins: AiPlugin<any, any>[] = []

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
    aiSdkProviderId === 'openai-responses' ||
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
