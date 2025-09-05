import { AiPlugin } from '@cherrystudio/ai-core'
import { createPromptToolUsePlugin, webSearchPlugin } from '@cherrystudio/ai-core/built-in/plugins'
import { loggerService } from '@logger'
import { getEnableDeveloperMode } from '@renderer/hooks/useSettings'
import { Assistant } from '@renderer/types'

import { AiSdkMiddlewareConfig } from '../middleware/AiSdkMiddlewareBuilder'
import reasoningTimePlugin from './reasoningTimePlugin'
import { searchOrchestrationPlugin } from './searchOrchestrationPlugin'
import { createTelemetryPlugin } from './telemetryPlugin'

const logger = loggerService.withContext('PluginBuilder')
/**
 * 根据条件构建插件数组
 */
export function buildPlugins(
  middlewareConfig: AiSdkMiddlewareConfig & { assistant: Assistant; topicId?: string }
): AiPlugin[] {
  const plugins: AiPlugin[] = []

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

  // 1. 模型内置搜索
  if (middlewareConfig.enableWebSearch) {
    // 内置了默认搜索参数，如果改的话可以传config进去
    plugins.push(webSearchPlugin())
  }
  // 2. 支持工具调用时添加搜索插件
  if (middlewareConfig.isSupportedToolUse) {
    plugins.push(searchOrchestrationPlugin(middlewareConfig.assistant, middlewareConfig.topicId || ''))
  }

  // 3. 推理模型时添加推理插件
  if (middlewareConfig.enableReasoning) {
    plugins.push(reasoningTimePlugin)
  }

  // 4. 启用Prompt工具调用时添加工具插件
  if (middlewareConfig.isPromptToolUse && middlewareConfig.mcpTools && middlewareConfig.mcpTools.length > 0) {
    plugins.push(
      createPromptToolUsePlugin({
        enabled: true,
        createSystemMessage: (systemPrompt, params, context) => {
          if (context.modelId.includes('o1-mini') || context.modelId.includes('o1-preview')) {
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

  // if (!middlewareConfig.enableTool && middlewareConfig.mcpTools && middlewareConfig.mcpTools.length > 0) {
  //   plugins.push(createNativeToolUsePlugin())
  // }
  logger.info(
    'Final plugin list:',
    plugins.map((p) => p.name)
  )
  return plugins
}
