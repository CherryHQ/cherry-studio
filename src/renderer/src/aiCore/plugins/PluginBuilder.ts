import type { AiPlugin } from '@cherrystudio/ai-core'
import { createPromptToolUsePlugin, webSearchPlugin } from '@cherrystudio/ai-core/built-in/plugins'
import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import type { Assistant } from '@renderer/types'

import type { AiSdkMiddlewareConfig } from '../middleware/AiSdkMiddlewareBuilder'
import { searchOrchestrationPlugin } from './searchOrchestrationPlugin'
import { createTelemetryPlugin } from './telemetryPlugin'

const logger = loggerService.withContext('PluginBuilder')
/**
 * 根据条件构建插件数组
 */
export async function buildPlugins(
  middlewareConfig: AiSdkMiddlewareConfig & { assistant: Assistant; topicId?: string }
): Promise<AiPlugin[]> {
  const plugins: AiPlugin[] = []

  if (middlewareConfig.topicId && (await preferenceService.get('app.developer_mode.enabled'))) {
    // 0. 添加 telemetry 插件
    plugins.push(
      createTelemetryPlugin({
        enabled: true,
        topicId: middlewareConfig.topicId,
        assistant: middlewareConfig.assistant
      })
    )
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
        createSystemMessage: (systemPrompt, params, context) => {
          const modelId = typeof context.model === 'string' ? context.model : context.model.modelId
          if (modelId.includes('o1-mini') || modelId.includes('o1-preview')) {
            if (context.isRecursiveCall) {
              return null
            }
            params.messages = [
              {
                role: 'assistant',
                content: systemPrompt
              },
              ...params.messages
            ]
            return null
          }
          return systemPrompt
        }
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
