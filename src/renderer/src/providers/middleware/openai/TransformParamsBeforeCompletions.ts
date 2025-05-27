import {
  isReasoningModel,
  isSupportedReasoningEffortModel,
  isSupportedReasoningEffortOpenAIModel,
  isSupportedThinkingTokenModel,
  isSupportedThinkingTokenQwenModel,
  isWebSearchModel
} from '@renderer/config/models'
import { getAssistantSettings, getDefaultModel } from '@renderer/services/AssistantService'
import {
  filterContextMessages,
  filterEmptyMessages,
  filterUserRoleStartMessages
} from '@renderer/services/MessagesService'
import { processPostsuffixQwen3Model, processReqMessages } from '@renderer/services/ModelMessageService'
import { addImageFileToContents } from '@renderer/utils/formats'
import { isEnabledToolUse } from '@renderer/utils/mcp-tools'
import { buildSystemPrompt } from '@renderer/utils/prompt'
import { takeRight } from 'lodash'
import { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources'

import type { CompletionsParams } from '../../AiProvider'
import { AiProviderMiddlewareCompletionsContext, CompletionsMiddleware } from '../middlewareTypes'

const MIDDLEWARE_NAME = 'TransformParamsBeforeCompletions'

/**
 * 参数转换中间件
 * 负责将 CompletionsParams 转换为标准化的格式，提取 completions 函数中的参数处理逻辑
 */
export const TransformParamsBeforeCompletions: CompletionsMiddleware =
  () => (next) => async (context: AiProviderMiddlewareCompletionsContext, params: CompletionsParams) => {
    console.log(`🔄 [${MIDDLEWARE_NAME}] Starting parameter transformation`)

    try {
      // 检查参数是否已经包含转换后的数据（递归调用时避免重复转换）
      if (params._internal?.sdkParams) {
        console.log(`🔄 [${MIDDLEWARE_NAME}] Parameters already transformed, skipping transformation`)
        return next(context, params)
      }

      // 获取 provider 实例
      const provider = context._providerInstance
      if (!provider) {
        throw new Error('Provider instance not found in context')
      }

      // 1. 基础参数处理
      const defaultModel = getDefaultModel()
      const model = params.assistant.model || defaultModel
      const { contextCount, maxTokens, streamOutput } = getAssistantSettings(params.assistant)

      // 2. 消息预处理 - 完整实现
      const processedMessages = addImageFileToContents(params.messages)
      // 内置网络搜索
      const isEnabledBultinWebSearch = params.assistant.enableWebSearch && isWebSearchModel(model)

      // 3. 推理模式检测 - 完整实现
      const enableReasoning =
        ((isSupportedThinkingTokenModel(model) || isSupportedReasoningEffortModel(model)) &&
          params.assistant.settings?.reasoning_effort !== undefined) ||
        (isReasoningModel(model) && (!isSupportedThinkingTokenModel(model) || !isSupportedReasoningEffortModel(model)))

      // 4. 系统消息构建 - 完整实现
      let systemMessage = { role: 'system', content: params.assistant.prompt || '' }

      if (isSupportedReasoningEffortOpenAIModel(model)) {
        systemMessage = {
          role: 'developer',
          content: `Formatting re-enabled${systemMessage ? '\n' + systemMessage.content : ''}`
        }
      }

      if (model.id.includes('o1-preview') || model.id.includes('o1-mini')) {
        systemMessage = {
          role: 'assistant',
          content: `Formatting re-enabled${systemMessage ? '\n' + systemMessage.content : ''}`
        }
      }

      // 5. 工具配置 - 完整实现
      const { tools } = provider.setupToolsConfig<ChatCompletionTool>({
        mcpTools: params.mcpTools,
        model,
        enableToolUse: isEnabledToolUse(params.assistant)
      })

      // 6. 系统提示词工具增强 - 完整实现
      if (provider.useSystemPromptForTools) {
        systemMessage.content = buildSystemPrompt(systemMessage.content || '', params.mcpTools)
      }

      // 7. 用户消息处理 - 完整实现
      const userMessages: ChatCompletionMessageParam[] = []
      const _messages = filterUserRoleStartMessages(
        filterEmptyMessages(filterContextMessages(takeRight(processedMessages, contextCount + 1)))
      )

      // 调用消息过滤回调
      params.onFilterMessages?.(_messages)

      // 转换消息格式
      for (const message of _messages) {
        userMessages.push(await provider.getMessageParam(message, model))
      }

      // 8. 特殊模型处理（Qwen思考模式）- 完整实现
      const lastUserMsg = userMessages.findLast((m) => m.role === 'user')
      if (lastUserMsg && isSupportedThinkingTokenQwenModel(model)) {
        const postsuffix = '/no_think'
        const qwenThinkModeEnabled = params.assistant.settings?.qwenThinkMode === true
        const currentContent = lastUserMsg.content

        lastUserMsg.content = processPostsuffixQwen3Model(currentContent, postsuffix, qwenThinkModeEnabled) as any
      }

      // 9. 构建请求消息数组
      let reqMessages: ChatCompletionMessageParam[]
      if (!systemMessage.content) {
        reqMessages = [...userMessages]
      } else {
        reqMessages = [systemMessage, ...userMessages].filter(Boolean) as ChatCompletionMessageParam[]
      }

      // 10. 消息后处理 - 完整实现
      reqMessages = processReqMessages(model, reqMessages)

      // 将转换后的参数附加到 params 的 _internal 字段中

      const _internal = {
        // SDK接口需要的参数
        sdkParams: {
          reqMessages,
          tools,
          systemMessage,
          model,
          maxTokens,
          streamOutput
        },
        // 内部处理可能会需要的参数
        enableReasoning,
        userMessages,
        contextCount,
        processedMessages: _messages,
        isEnabledBultinWebSearch
      }
      params._internal = _internal

      console.log(`🔄 [${MIDDLEWARE_NAME}] Parameter transformation completed`)
      console.log(`🔄 [${MIDDLEWARE_NAME}] Model: ${model.id}`)
      console.log(`🔄 [${MIDDLEWARE_NAME}] Messages count: ${reqMessages.length}`)
      console.log(`🔄 [${MIDDLEWARE_NAME}] Tools count: ${tools?.length || 0}`)
      console.log(`🔄 [${MIDDLEWARE_NAME}] Max tokens: ${maxTokens}`)
      console.log(`🔄 [${MIDDLEWARE_NAME}] Stream output: ${streamOutput}`)
      console.log(`🔄 [${MIDDLEWARE_NAME}] Enable reasoning: ${enableReasoning}`)

      return next(context, params)
    } catch (error) {
      console.error(`🔄 [${MIDDLEWARE_NAME}] Error during parameter transformation:`, error)
      throw error
    }
  }

export default TransformParamsBeforeCompletions
