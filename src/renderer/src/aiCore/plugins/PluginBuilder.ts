import type { AiPlugin } from '@cherrystudio/ai-core'
import { createPromptToolUsePlugin, webSearchPlugin } from '@cherrystudio/ai-core/built-in/plugins'
import { loggerService } from '@logger'
import { isGemini3Model, isSupportedThinkingTokenQwenModel } from '@renderer/config/models'
import { getEnableDeveloperMode } from '@renderer/hooks/useSettings'
import type { Assistant } from '@renderer/types'
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
 * 根据条件构建插件数组
 */
export function buildPlugins(
  middlewareConfig: AiSdkMiddlewareConfig & { assistant: Assistant; topicId?: string }
): AiPlugin[] {
  const plugins: AiPlugin<any, any>[] = []

  if (middlewareConfig.topicId && getEnableDeveloperMode()) {
    // 0. 添加 telemetry 插件
    plugins.push(
      createTelemetryPlugin({
        enabled: true,
        topicId: middlewareConfig.topicId,
        assistant: middlewareConfig.assistant
      })
    )
  }

  // === AI SDK Middleware Plugins ===

  // 0.1 Simulate streaming for non-streaming requests
  if (!middlewareConfig.streamOutput) {
    plugins.push(createSimulateStreamingPlugin())
  }

  // 0.2 Reasoning extraction for OpenAI/Azure providers
  if (middlewareConfig.provider) {
    const providerType = middlewareConfig.provider.type
    if (providerType === 'openai' || providerType === 'azure-openai') {
      const tagName = getReasoningTagName(middlewareConfig.model?.id.toLowerCase())
      plugins.push(createReasoningExtractionPlugin({ tagName }))
    }

    if (providerType === 'anthropic' && middlewareConfig.provider.anthropicCacheControl?.tokenThreshold) {
      plugins.push(createAnthropicCachePlugin())
    }
  }

  // 0.3 OpenRouter reasoning redaction
  if (middlewareConfig.provider?.id === SystemProviderIds.openrouter) {
    plugins.push(createOpenrouterReasoningPlugin())
  }

  // 0.4 OVMS no-think for MCP tools
  if (middlewareConfig.provider?.id === 'ovms' && middlewareConfig.mcpTools && middlewareConfig.mcpTools.length > 0) {
    plugins.push(createNoThinkPlugin())
  }

  // 0.5 Qwen thinking control for providers without enable_thinking support
  if (
    middlewareConfig.provider &&
    middlewareConfig.model &&
    !isOllamaProvider(middlewareConfig.provider) &&
    isSupportedThinkingTokenQwenModel(middlewareConfig.model) &&
    !isSupportEnableThinkingProvider(middlewareConfig.provider)
  ) {
    const enableThinking = middlewareConfig.assistant?.settings?.reasoning_effort !== undefined
    plugins.push(createQwenThinkingPlugin(enableThinking))
  }

  // 0.6 OpenRouter Gemini image generation
  if (
    middlewareConfig.model &&
    middlewareConfig.provider &&
    isOpenRouterGeminiGenerateImageModel(middlewareConfig.model, middlewareConfig.provider)
  ) {
    plugins.push(createOpenrouterGenerateImagePlugin())
  }

  // 0.7 Skip Gemini3 thought signature
  if (middlewareConfig.model && middlewareConfig.provider && isGemini3Model(middlewareConfig.model)) {
    const aiSdkId = getAiSdkProviderId(middlewareConfig.provider)
    plugins.push(createSkipGeminiThoughtSignaturePlugin(aiSdkId))
  }

  // 1. 模型内置搜索
  if (middlewareConfig.enableWebSearch && middlewareConfig.webSearchPluginConfig) {
    plugins.push(webSearchPlugin(middlewareConfig.webSearchPluginConfig))
  }
  // 2. 支持工具调用时添加搜索插件
  if (middlewareConfig.isSupportedToolUse || middlewareConfig.isPromptToolUse) {
    plugins.push(searchOrchestrationPlugin(middlewareConfig.assistant, middlewareConfig.topicId || ''))
  }

  // 3. 推理模型时添加推理插件
  // if (middlewareConfig.enableReasoning) {
  //   plugins.push(reasoningTimePlugin)
  // }

  // 4. 启用Prompt工具调用时添加工具插件
  if (middlewareConfig.isPromptToolUse) {
    plugins.push(
      createPromptToolUsePlugin({
        enabled: true,
        mcpMode: middlewareConfig.mcpMode
      })
    )
  }

  // if (middlewareConfig.enableUrlContext && middlewareConfig.) {
  //   plugins.push(googleToolsPlugin({ urlContext: true }))
  // }

  logger.debug(
    'Final plugin list:',
    plugins.map((p) => p.name)
  )
  return plugins
}
