/**
 * 参数构建模块
 * 构建AI SDK的流式和非流式参数
 */

import { vertexAnthropic } from '@ai-sdk/google-vertex/anthropic/edge'
import { vertex } from '@ai-sdk/google-vertex/edge'
import { loggerService } from '@logger'
import {
  isGenerateImageModel,
  isOpenRouterBuiltInWebSearchModel,
  isReasoningModel,
  isSupportedReasoningEffortModel,
  isSupportedThinkingTokenClaudeModel,
  isSupportedThinkingTokenModel,
  isWebSearchModel
} from '@renderer/config/models'
import { getAssistantSettings, getDefaultModel } from '@renderer/services/AssistantService'
import { type Assistant, type MCPTool, type Provider } from '@renderer/types'
import type { StreamTextParams } from '@renderer/types/aiCoreTypes'
import type { ModelMessage, Tool } from 'ai'
import { stepCountIs } from 'ai'

import { getAiSdkProviderId } from '../provider/factory'
import { setupToolsConfig } from '../utils/mcp'
import { buildProviderOptions } from '../utils/options'
import { getAnthropicThinkingBudget } from '../utils/reasoning'
import { getTemperature, getTopP } from './modelParameters'

const logger = loggerService.withContext('parameterBuilder')

type ProviderDefinedTool = Extract<Tool<any, any>, { type: 'provider-defined' }>

/**
 * 构建 AI SDK 流式参数
 * 这是主要的参数构建函数，整合所有转换逻辑
 */
export async function buildStreamTextParams(
  sdkMessages: StreamTextParams['messages'] = [],
  assistant: Assistant,
  provider: Provider,
  options: {
    mcpTools?: MCPTool[]
    webSearchProviderId?: string
    requestOptions?: {
      signal?: AbortSignal
      timeout?: number
      headers?: Record<string, string>
    }
  } = {}
): Promise<{
  params: StreamTextParams
  modelId: string
  capabilities: {
    enableReasoning: boolean
    enableWebSearch: boolean
    enableGenerateImage: boolean
    enableUrlContext: boolean
  }
}> {
  const { mcpTools } = options

  const model = assistant.model || getDefaultModel()
  const aiSdkProviderId = getAiSdkProviderId(provider)

  let { maxTokens } = getAssistantSettings(assistant)

  // 这三个变量透传出来，交给下面启用插件/中间件
  // 也可以在外部构建好再传入buildStreamTextParams
  // FIXME: qwen3即使关闭思考仍然会导致enableReasoning的结果为true
  const enableReasoning =
    ((isSupportedThinkingTokenModel(model) || isSupportedReasoningEffortModel(model)) &&
      assistant.settings?.reasoning_effort !== undefined) ||
    (isReasoningModel(model) && (!isSupportedThinkingTokenModel(model) || !isSupportedReasoningEffortModel(model)))

  // 判断是否使用内置搜索
  // 条件：没有外部搜索提供商 && (用户开启了内置搜索 || 模型强制使用内置搜索)
  const hasExternalSearch = !!options.webSearchProviderId
  const enableWebSearch =
    !hasExternalSearch &&
    ((assistant.enableWebSearch && isWebSearchModel(model)) ||
      isOpenRouterBuiltInWebSearchModel(model) ||
      model.id.includes('sonar'))

  const enableUrlContext = assistant.enableUrlContext || false

  const enableGenerateImage = !!(isGenerateImageModel(model) && assistant.enableGenerateImage)

  let tools = setupToolsConfig(mcpTools)

  // if (webSearchProviderId) {
  //   tools['builtin_web_search'] = webSearchTool(webSearchProviderId)
  // }

  // 构建真正的 providerOptions
  const providerOptions = buildProviderOptions(assistant, model, provider, {
    enableReasoning,
    enableWebSearch,
    enableGenerateImage
  })

  // NOTE: ai-sdk会把maxToken和budgetToken加起来
  if (
    enableReasoning &&
    maxTokens !== undefined &&
    isSupportedThinkingTokenClaudeModel(model) &&
    (provider.type === 'anthropic' || provider.type === 'aws-bedrock')
  ) {
    maxTokens -= getAnthropicThinkingBudget(assistant, model)
  }

  // google-vertex | google-vertex-anthropic
  if (enableWebSearch) {
    if (!tools) {
      tools = {}
    }
    if (aiSdkProviderId === 'google-vertex') {
      tools.google_search = vertex.tools.googleSearch({}) as ProviderDefinedTool
    } else if (aiSdkProviderId === 'google-vertex-anthropic') {
      tools.web_search = vertexAnthropic.tools.webSearch_20250305({}) as ProviderDefinedTool
    }
  }

  // google-vertex
  if (enableUrlContext && aiSdkProviderId === 'google-vertex') {
    if (!tools) {
      tools = {}
    }
    tools.url_context = vertex.tools.urlContext({}) as ProviderDefinedTool
  }

  // 构建基础参数
  const params: StreamTextParams = {
    messages: sdkMessages,
    maxOutputTokens: maxTokens,
    temperature: getTemperature(assistant, model),
    topP: getTopP(assistant, model),
    abortSignal: options.requestOptions?.signal,
    headers: options.requestOptions?.headers,
    providerOptions,
    stopWhen: stepCountIs(10),
    maxRetries: 0
  }
  if (tools) {
    params.tools = tools
  }
  if (assistant.prompt) {
    params.system = assistant.prompt
  }
  logger.debug('params', params)
  return {
    params,
    modelId: model.id,
    capabilities: { enableReasoning, enableWebSearch, enableGenerateImage, enableUrlContext }
  }
}

/**
 * 构建非流式的 generateText 参数
 */
export async function buildGenerateTextParams(
  messages: ModelMessage[],
  assistant: Assistant,
  provider: Provider,
  options: {
    mcpTools?: MCPTool[]
    enableTools?: boolean
  } = {}
): Promise<any> {
  // 复用流式参数的构建逻辑
  return await buildStreamTextParams(messages, assistant, provider, options)
}
