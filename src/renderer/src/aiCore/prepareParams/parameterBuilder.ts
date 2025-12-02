/**
 * 参数构建模块
 * 构建AI SDK的流式和非流式参数
 */

import { anthropic } from '@ai-sdk/anthropic'
import { azure } from '@ai-sdk/azure'
import { google } from '@ai-sdk/google'
import { vertexAnthropic } from '@ai-sdk/google-vertex/anthropic/edge'
import { vertex } from '@ai-sdk/google-vertex/edge'
import { combineHeaders } from '@ai-sdk/provider-utils'
import type { AnthropicSearchConfig, WebSearchPluginConfig } from '@cherrystudio/ai-core/built-in/plugins'
import { isBaseProvider } from '@cherrystudio/ai-core/core/providers/schemas'
import { loggerService } from '@logger'
import {
  isAnthropicModel,
  isGenerateImageModel,
  isOpenRouterBuiltInWebSearchModel,
  isReasoningModel,
  isSupportedReasoningEffortModel,
  isSupportedThinkingTokenModel,
  isWebSearchModel
} from '@renderer/config/models'
import { getDefaultModel } from '@renderer/services/AssistantService'
import store from '@renderer/store'
import type { CherryWebSearchConfig } from '@renderer/store/websearch'
import { type Assistant, type MCPTool, type Provider } from '@renderer/types'
import type { StreamTextParams } from '@renderer/types/aiCoreTypes'
import { mapRegexToPatterns } from '@renderer/utils/blacklistMatchPattern'
import { replacePromptVariables } from '@renderer/utils/prompt'
import { isAwsBedrockProvider } from '@renderer/utils/provider'
import type { ModelMessage, Tool } from 'ai'
import { stepCountIs } from 'ai'

import { getAiSdkProviderId } from '../provider/factory'
import { setupToolsConfig } from '../utils/mcp'
import { buildProviderOptions } from '../utils/options'
import { buildProviderBuiltinWebSearchConfig } from '../utils/websearch'
import { addAnthropicHeaders } from './header'
import { getMaxTokens, getTemperature, getTopP } from './modelParameters'

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
    webSearchConfig?: CherryWebSearchConfig
    requestOptions?: {
      signal?: AbortSignal
      timeout?: number
      headers?: Record<string, string>
    }
  }
): Promise<{
  params: StreamTextParams
  modelId: string
  capabilities: {
    enableReasoning: boolean
    enableWebSearch: boolean
    enableGenerateImage: boolean
    enableUrlContext: boolean
  }
  webSearchPluginConfig?: WebSearchPluginConfig
}> {
  const { mcpTools } = options

  const model = assistant.model || getDefaultModel()
  const aiSdkProviderId = getAiSdkProviderId(provider)

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

  // 构建真正的 providerOptions
  const webSearchConfig: CherryWebSearchConfig = {
    maxResults: store.getState().websearch.maxResults,
    excludeDomains: store.getState().websearch.excludeDomains,
    searchWithTime: store.getState().websearch.searchWithTime
  }

  const { providerOptions, standardParams, bodyParams } = buildProviderOptions(assistant, model, provider, {
    enableReasoning,
    enableWebSearch,
    enableGenerateImage
  })

  let webSearchPluginConfig: WebSearchPluginConfig | undefined = undefined
  if (enableWebSearch) {
    if (isBaseProvider(aiSdkProviderId)) {
      webSearchPluginConfig = buildProviderBuiltinWebSearchConfig(aiSdkProviderId, webSearchConfig, model)
    }
    if (!tools) {
      tools = {}
    }
    if (aiSdkProviderId === 'google-vertex') {
      tools.google_search = vertex.tools.googleSearch({}) as ProviderDefinedTool
    } else if (aiSdkProviderId === 'google-vertex-anthropic') {
      const blockedDomains = mapRegexToPatterns(webSearchConfig.excludeDomains)
      tools.web_search = vertexAnthropic.tools.webSearch_20250305({
        maxUses: webSearchConfig.maxResults,
        blockedDomains: blockedDomains.length > 0 ? blockedDomains : undefined
      }) as ProviderDefinedTool
    } else if (aiSdkProviderId === 'azure-responses') {
      tools.web_search_preview = azure.tools.webSearchPreview({
        searchContextSize: webSearchPluginConfig?.openai!.searchContextSize
      }) as ProviderDefinedTool
    } else if (aiSdkProviderId === 'azure-anthropic') {
      const blockedDomains = mapRegexToPatterns(webSearchConfig.excludeDomains)
      const anthropicSearchOptions: AnthropicSearchConfig = {
        maxUses: webSearchConfig.maxResults,
        blockedDomains: blockedDomains.length > 0 ? blockedDomains : undefined
      }
      tools.web_search = anthropic.tools.webSearch_20250305(anthropicSearchOptions) as ProviderDefinedTool
    }
  }

  if (enableUrlContext) {
    if (!tools) {
      tools = {}
    }
    const blockedDomains = mapRegexToPatterns(webSearchConfig.excludeDomains)

    switch (aiSdkProviderId) {
      case 'google-vertex':
        tools.url_context = vertex.tools.urlContext({}) as ProviderDefinedTool
        break
      case 'google':
        tools.url_context = google.tools.urlContext({}) as ProviderDefinedTool
        break
      case 'anthropic':
      case 'azure-anthropic':
      case 'google-vertex-anthropic':
        tools.web_fetch = (
          ['anthropic', 'azure-anthropic'].includes(aiSdkProviderId)
            ? anthropic.tools.webFetch_20250910({
                maxUses: webSearchConfig.maxResults,
                blockedDomains: blockedDomains.length > 0 ? blockedDomains : undefined
              })
            : vertexAnthropic.tools.webFetch_20250910({
                maxUses: webSearchConfig.maxResults,
                blockedDomains: blockedDomains.length > 0 ? blockedDomains : undefined
              })
        ) as ProviderDefinedTool
        break
    }
  }

  let headers: Record<string, string | undefined> = options.requestOptions?.headers ?? {}

  if (isAnthropicModel(model) && !isAwsBedrockProvider(provider)) {
    const betaHeaders = addAnthropicHeaders(assistant, model)
    // Only add the anthropic-beta header if there are actual beta headers to include
    if (betaHeaders.length > 0) {
      const newBetaHeaders = { 'anthropic-beta': betaHeaders.join(',') }
      headers = combineHeaders(headers, newBetaHeaders)
    }
  }

  // 构建基础参数
  // Note: standardParams (topK, frequencyPenalty, presencePenalty, stopSequences, seed)
  // are extracted from custom parameters and passed directly to streamText()
  // instead of being placed in providerOptions
  // Note: bodyParams are custom parameters for AI Gateway that should be at body level
  const params: StreamTextParams = {
    messages: sdkMessages,
    maxOutputTokens: getMaxTokens(assistant, model),
    temperature: getTemperature(assistant, model),
    topP: getTopP(assistant, model),
    // Include AI SDK standard params extracted from custom parameters
    ...standardParams,
    // Include body-level params for AI Gateway custom parameters
    ...bodyParams,
    abortSignal: options.requestOptions?.signal,
    headers,
    providerOptions,
    stopWhen: stepCountIs(20),
    maxRetries: 0
  }

  if (tools) {
    params.tools = tools
  }

  if (assistant.prompt) {
    params.system = await replacePromptVariables(assistant.prompt, model.name)
  }

  logger.debug('params', params)

  return {
    params,
    modelId: model.id,
    capabilities: { enableReasoning, enableWebSearch, enableGenerateImage, enableUrlContext },
    webSearchPluginConfig
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
