import type { AiPlugin } from '@cherrystudio/ai-core'
import { createPromptToolUsePlugin, webSearchPlugin } from '@cherrystudio/ai-core/built-in/plugins'
import { loggerService } from '@logger'
import { isGemini3Model, isSupportedThinkingTokenQwenModel } from '@renderer/config/models'
import { getEnableDeveloperMode } from '@renderer/hooks/useSettings'
import type { Assistant, Model, Provider } from '@renderer/types'
import { SystemProviderIds } from '@renderer/types'
import { isOllamaProvider, isSupportEnableThinkingProvider } from '@renderer/utils/provider'

import { getAiSdkProviderId } from '../provider/factory'
import type { AiSdkMiddlewareConfig } from '../types/middlewareConfig'
import { isOpenRouterGeminiGenerateImageModel } from '../utils/image'
import { getReasoningTagName } from '../utils/reasoning'
import { createAnthropicCachePlugin } from './anthropicCachePlugin'
import { createNoThinkPlugin } from './noThinkPlugin'
import { createOpenrouterGenerateImagePlugin } from './openrouterGenerateImagePlugin'
import { createOpenrouterReasoningPlugin } from './openrouterReasoningPlugin'
import { createQwenThinkingPlugin } from './qwenThinkingPlugin'
import { createReasoningExtractionPlugin } from './reasoningExtractionPlugin'
import { searchOrchestrationPlugin } from './searchOrchestrationPlugin'
import { createSimulateStreamingPlugin } from './simulateStreamingPlugin'
import { createSkipGeminiThoughtSignaturePlugin } from './skipGeminiThoughtSignaturePlugin'
import { createTelemetryPlugin } from './telemetryPlugin'

const logger = loggerService.withContext('PluginBuilder')

/**
 * 构建插件的上下文参数
 *
 * provider 和 model 是必选的 — 由 ModernAiProvider 内部注入，
 * 不再依赖调用方手动传入，从根本上避免遗漏。
 */
export interface BuildPluginsContext {
  provider: Provider
  model: Model
  config: AiSdkMiddlewareConfig & { assistant: Assistant; topicId?: string }
}

/**
 * 根据条件构建插件数组
 */
export function buildPlugins({ provider, model, config }: BuildPluginsContext): AiPlugin[] {
  const plugins: AiPlugin<any, any>[] = []

  if (config.topicId && getEnableDeveloperMode()) {
    // 0. 添加 telemetry 插件
    plugins.push(
      createTelemetryPlugin({
        enabled: true,
        topicId: config.topicId,
        assistant: config.assistant
      })
    )
  }

  // === AI SDK Middleware Plugins ===
  // 注意：wrapLanguageModel 会 .reverse() middleware 数组，
  // 数组中靠前的 middleware 反转后变成最外层包装。
  // extractReasoning 必须在 simulateStreaming 之前推入，
  // 这样反转后 extractReasoning 在外层，其 wrapStream（状态机）
  // 能处理 simulateStreaming 生成的模拟流中的未闭合 <think> 标签。

  // 0.1 Reasoning extraction for OpenAI/Azure providers
  const providerType = provider.type
  if (providerType === 'openai' || providerType === 'azure-openai') {
    const tagName = getReasoningTagName(model.id.toLowerCase())
    plugins.push(createReasoningExtractionPlugin({ tagName }))
  }

  // 0.2 Simulate streaming for non-streaming requests (must be AFTER reasoning extraction in array)
  if (!config.streamOutput) {
    plugins.push(createSimulateStreamingPlugin())
  }

  if (providerType === 'anthropic' && provider.anthropicCacheControl?.tokenThreshold) {
    plugins.push(createAnthropicCachePlugin())
  }

  // 0.3 OpenRouter reasoning redaction
  if (provider.id === SystemProviderIds.openrouter) {
    plugins.push(createOpenrouterReasoningPlugin())
  }

  // 0.4 OVMS no-think for MCP tools
  if (provider.id === 'ovms' && config.mcpTools && config.mcpTools.length > 0) {
    plugins.push(createNoThinkPlugin())
  }

  // 0.5 Qwen thinking control for providers without enable_thinking support
  if (
    !isOllamaProvider(provider) &&
    isSupportedThinkingTokenQwenModel(model) &&
    !isSupportEnableThinkingProvider(provider)
  ) {
    const enableThinking = config.assistant?.settings?.reasoning_effort !== undefined
    plugins.push(createQwenThinkingPlugin(enableThinking))
  }

  // 0.6 OpenRouter Gemini image generation
  if (isOpenRouterGeminiGenerateImageModel(model, provider)) {
    plugins.push(createOpenrouterGenerateImagePlugin())
  }

  // 0.7 Skip Gemini3 thought signature
  if (isGemini3Model(model)) {
    const aiSdkId = getAiSdkProviderId(provider)
    plugins.push(createSkipGeminiThoughtSignaturePlugin(aiSdkId))
  }

  // 1. 模型内置搜索
  if (config.enableWebSearch && config.webSearchPluginConfig) {
    plugins.push(webSearchPlugin(config.webSearchPluginConfig))
  }
  // 2. 支持工具调用时添加搜索插件
  if (config.isSupportedToolUse || config.isPromptToolUse) {
    plugins.push(searchOrchestrationPlugin(config.assistant, config.topicId || ''))
  }

  // 3. 推理模型时添加推理插件
  // if (config.enableReasoning) {
  //   plugins.push(reasoningTimePlugin)
  // }

  // 4. 启用Prompt工具调用时添加工具插件
  if (config.isPromptToolUse) {
    plugins.push(
      createPromptToolUsePlugin({
        enabled: true,
        mcpMode: config.mcpMode
      })
    )
  }

  // if (config.enableUrlContext && config.) {
  //   plugins.push(googleToolsPlugin({ urlContext: true }))
  // }

  logger.debug(
    'Final plugin list:',
    plugins.map((p) => p.name)
  )
  return plugins
}
