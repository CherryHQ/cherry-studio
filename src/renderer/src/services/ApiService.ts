/**
 * 职责：提供原子化的、无状态的API调用函数
 */
import { StreamTextParams } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import AiProvider from '@renderer/aiCore'
import { CompletionsParams } from '@renderer/aiCore/legacy/middleware/schemas'
import { AiSdkMiddlewareConfig } from '@renderer/aiCore/middleware/AiSdkMiddlewareBuilder'
import { buildStreamTextParams } from '@renderer/aiCore/transformParameters'
import { isDedicatedImageGenerationModel, isEmbeddingModel } from '@renderer/config/models'
import { getStoreSetting } from '@renderer/hooks/useSettings'
import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { Assistant, MCPServer, MCPTool, Model, Provider } from '@renderer/types'
import { type Chunk, ChunkType } from '@renderer/types/chunk'
import { Message } from '@renderer/types/newMessage'
import { SdkModel } from '@renderer/types/sdk'
import { removeSpecialCharactersForTopicName } from '@renderer/utils'
import { isPromptToolUse, isSupportedToolUse } from '@renderer/utils/mcp-tools'
import { findFileBlocks, getMainTextContent } from '@renderer/utils/messageUtils/find'
import { containsSupportedVariables, replacePromptVariables } from '@renderer/utils/prompt'
import { isEmpty, takeRight } from 'lodash'

import AiProviderNew from '../aiCore/index_new'
import {
  // getAssistantProvider,
  // getAssistantSettings,
  getDefaultAssistant,
  getDefaultModel,
  getProviderByModel,
  getTopNamingModel
} from './AssistantService'
// import { processKnowledgeSearch } from './KnowledgeService'
// import {
//   filterContextMessages,
//   filterEmptyMessages,
//   filterUsefulMessages,
//   filterUserRoleStartMessages
// } from './MessagesService'
// import WebSearchService from './WebSearchService'

const logger = loggerService.withContext('ApiService')

export async function fetchMcpTools(assistant: Assistant) {
  // Get MCP tools (Fix duplicate declaration)
  let mcpTools: MCPTool[] = [] // Initialize as empty array
  const allMcpServers = store.getState().mcp.servers || []
  const activedMcpServers = allMcpServers.filter((s) => s.isActive)
  const assistantMcpServers = assistant.mcpServers || []

  const enabledMCPs = activedMcpServers.filter((server) => assistantMcpServers.some((s) => s.id === server.id))

  if (enabledMCPs && enabledMCPs.length > 0) {
    try {
      const toolPromises = enabledMCPs.map<Promise<MCPTool[]>>(async (mcpServer: MCPServer) => {
        try {
          const tools = await window.api.mcp.listTools(mcpServer)
          return tools.filter((tool: any) => !mcpServer.disabledTools?.includes(tool.name))
        } catch (error) {
          logger.error(`Error fetching tools from MCP server ${mcpServer.name}:`, error as Error)
          return []
        }
      })
      const results = await Promise.allSettled(toolPromises)
      mcpTools = results
        .filter((result): result is PromiseFulfilledResult<MCPTool[]> => result.status === 'fulfilled')
        .map((result) => result.value)
        .flat()
    } catch (toolError) {
      logger.error('Error fetching MCP tools:', toolError as Error)
    }
  }
  return mcpTools
}

export async function fetchChatCompletion({
  messages,
  assistant,
  options,
  onChunkReceived,
  topicId
}: {
  messages: StreamTextParams['messages']
  assistant: Assistant
  options: {
    signal?: AbortSignal
    timeout?: number
    headers?: Record<string, string>
  }
  onChunkReceived: (chunk: Chunk) => void
  topicId?: string // 添加 topicId 参数
  // TODO
  // onChunkStatus: (status: 'searching' | 'processing' | 'success' | 'error') => void
}) {
  logger.info('fetchChatCompletion called with detailed context', {
    messageCount: messages?.length || 0,
    assistantId: assistant.id,
    topicId,
    hasTopicId: !!topicId,
    modelId: assistant.model?.id,
    modelName: assistant.model?.name
  })

  const AI = new AiProviderNew(assistant.model || getDefaultModel())
  const provider = AI.getActualProvider()

  const mcpTools: MCPTool[] = []

  if (isSupportedToolUse(assistant)) {
    mcpTools.push(...(await fetchMcpTools(assistant)))
  }

  // 使用 transformParameters 模块构建参数
  const {
    params: aiSdkParams,
    modelId,
    capabilities
  } = await buildStreamTextParams(messages, assistant, provider, {
    mcpTools: mcpTools,
    webSearchProviderId: assistant.webSearchProviderId,
    requestOptions: options
  })

  // const _messages = filterUserRoleStartMessages(
  //   filterEmptyMessages(filterContextMessages(takeRight(filteredMessages, contextCount + 2))) // 取原来几个provider的最大值
  // )

  // const enableReasoning =
  //   ((isSupportedThinkingTokenModel(model) || isSupportedReasoningEffortModel(model)) &&
  //     assistant.settings?.reasoning_effort !== undefined) ||
  //   (isReasoningModel(model) && (!isSupportedThinkingTokenModel(model) || !isSupportedReasoningEffortModel(model)))

  // const enableWebSearch =
  //   (assistant.enableWebSearch && isWebSearchModel(model)) ||
  //   isOpenRouterBuiltInWebSearchModel(model) ||
  //   model.id.includes('sonar') ||
  //   false

  // const enableGenerateImage =
  //   isGenerateImageModel(model) && (isSupportedDisableGenerationModel(model) ? assistant.enableGenerateImage : true)
  //   const enableUrlContext = assistant.enableUrlContext || false

  const middlewareConfig: AiSdkMiddlewareConfig = {
    streamOutput: assistant.settings?.streamOutput ?? true,
    onChunk: onChunkReceived,
    model: assistant.model,
    provider: provider,
    enableReasoning: capabilities.enableReasoning,
    isPromptToolUse: isPromptToolUse(assistant),
    isSupportedToolUse: isSupportedToolUse(assistant),
    isImageGenerationEndpoint: isDedicatedImageGenerationModel(assistant.model || getDefaultModel()),
    enableWebSearch: capabilities.enableWebSearch,
    enableGenerateImage: capabilities.enableGenerateImage,
    mcpTools
  }
  // if (capabilities.enableWebSearch) {
  //   onChunkReceived({ type: ChunkType.LLM_WEB_SEARCH_IN_PROGRESS })
  // }
  // --- Call AI Completions ---
  onChunkReceived({ type: ChunkType.LLM_RESPONSE_CREATED })

  // 在 AI SDK 调用时设置正确的 OpenTelemetry 上下文
  if (topicId) {
    logger.info('Attempting to set OpenTelemetry context', { topicId })
    const { currentSpan } = await import('@renderer/services/SpanManagerService')

    const parentSpan = currentSpan(topicId, modelId)
    logger.info('Parent span lookup result', {
      topicId,
      hasParentSpan: !!parentSpan,
      parentSpanId: parentSpan?.spanContext().spanId,
      parentTraceId: parentSpan?.spanContext().traceId
    })

    if (parentSpan) {
      logger.info('Found parent span, using completionsForTrace for proper span hierarchy', {
        topicId,
        parentSpanId: parentSpan.spanContext().spanId,
        parentTraceId: parentSpan.spanContext().traceId
      })
    } else {
      logger.warn('No parent span found for topicId, using completionsForTrace anyway', { topicId })
    }

    // 使用带trace支持的completions方法，它会自动创建子span并关联到父span
    await AI.completionsForTrace(modelId, aiSdkParams, {
      ...middlewareConfig,
      assistant,
      topicId,
      callType: 'chat'
    })
  } else {
    logger.warn('No topicId provided, using regular completions')
    // 没有topicId时，禁用telemetry以避免警告
    const configWithoutTelemetry = {
      ...middlewareConfig,
      topicId: undefined // 确保telemetryPlugin不会尝试查找span
    }
    await AI.completions(modelId, aiSdkParams, {
      ...configWithoutTelemetry,
      assistant,
      callType: 'chat'
    })
  }
}

// interface FetchTranslateProps {
//   content: string
//   assistant: TranslateAssistant
//   onResponse?: (text: string, isComplete: boolean) => void
// }

// export async function fetchTranslate({ content, assistant, onResponse }: FetchTranslateProps) {
//   const model = getTranslateModel() || assistant.model || getDefaultModel()

//   if (!model) {
//     throw new Error(i18n.t('error.provider_disabled'))
//   }

//   const provider = getProviderByModel(model)

//   if (!hasApiKey(provider)) {
//     throw new Error(i18n.t('error.no_api_key'))
//   }

//   const isSupportedStreamOutput = () => {
//     if (!onResponse) {
//       return false
//     }
//     return true
//   }

//   const stream = isSupportedStreamOutput()
//   const enableReasoning =
//     ((isSupportedThinkingTokenModel(model) || isSupportedReasoningEffortModel(model)) &&
//       assistant.settings?.reasoning_effort !== undefined) ||
//     (isReasoningModel(model) && (!isSupportedThinkingTokenModel(model) || !isSupportedReasoningEffortModel(model)))

//   const params: StreamTextParams = {
//     system: assistant.prompt,
//     prompt: content
//   }

//   const AI = new AiProviderNew(model)

//   const middlewareConfig: AiSdkMiddlewareConfig = {
//     streamOutput: stream,
//     enableReasoning,
//     isPromptToolUse: false,
//     isSupportedToolUse: false,
//     isImageGenerationEndpoint: false,
//     enableWebSearch: false,
//     enableGenerateImage: false,
//     onChunk: onResponse
//       ? (chunk) => {
//           if (chunk.type === ChunkType.TEXT_DELTA) {
//             onResponse(chunk.text, false)
//           } else if (chunk.type === ChunkType.TEXT_COMPLETE) {
//             onResponse(chunk.text, true)
//           }
//         }
//       : undefined
//   }

//   try {
//     return (
//       (
//         await AI.completions(model.id, params, {
//           ...middlewareConfig,
//           assistant,
//           callType: 'translate'
//         })
//       ).getText() || ''
//     )
//   } catch (error: any) {
//     return ''
//   }
// }

export async function fetchMessagesSummary({ messages, assistant }: { messages: Message[]; assistant: Assistant }) {
  let prompt = (getStoreSetting('topicNamingPrompt') as string) || i18n.t('prompts.title')
  const model = getTopNamingModel() || assistant.model || getDefaultModel()

  if (prompt && containsSupportedVariables(prompt)) {
    prompt = await replacePromptVariables(prompt, model.name)
  }

  // 总结上下文总是取最后5条消息
  const contextMessages = takeRight(messages, 5)

  const provider = getProviderByModel(model)

  if (!hasApiKey(provider)) {
    return null
  }

  const AI = new AiProviderNew(model)

  const topicId = messages?.find((message) => message.topicId)?.topicId || undefined

  // LLM对多条消息的总结有问题，用单条结构化的消息表示会话内容会更好
  const structredMessages = contextMessages.map((message) => {
    const structredMessage = {
      role: message.role,
      mainText: getMainTextContent(message)
    }

    // 让LLM知道消息中包含的文件，但只提供文件名
    // 对助手消息而言，没有提供工具调用结果等更多信息，仅提供文本上下文。
    const fileBlocks = findFileBlocks(message)
    let fileList: Array<string> = []
    if (fileBlocks.length && fileBlocks.length > 0) {
      fileList = fileBlocks.map((fileBlock) => fileBlock.file.origin_name)
    }
    return {
      ...structredMessage,
      files: fileList.length > 0 ? fileList : undefined
    }
  })
  const conversation = JSON.stringify(structredMessages)

  // // 复制 assistant 对象，并强制关闭思考预算
  // const summaryAssistant = {
  //   ...assistant,
  //   settings: {
  //     ...assistant.settings,
  //     reasoning_effort: undefined,
  //     qwenThinkMode: false
  //   }
  // }
  const summaryAssistant = {
    ...assistant,
    settings: {
      ...assistant.settings,
      reasoning_effort: undefined,
      qwenThinkMode: false
    },
    prompt,
    model
  }

  const llmMessages = {
    system: prompt,
    prompt: conversation
  }

  const middlewareConfig: AiSdkMiddlewareConfig = {
    streamOutput: false,
    enableReasoning: false,
    isPromptToolUse: false,
    isSupportedToolUse: false,
    isImageGenerationEndpoint: false,
    enableWebSearch: false,
    enableGenerateImage: false,
    mcpTools: []
  }
  try {
    const { getText } = await AI.completionsForTrace(model.id, llmMessages, {
      ...middlewareConfig,
      assistant: summaryAssistant,
      topicId,
      callType: 'summary'
    })
    const text = getText()
    return removeSpecialCharactersForTopicName(text) || null
  } catch (error: any) {
    return null
  }
}

export async function fetchGenerate({
  prompt,
  content,
  model
}: {
  prompt: string
  content: string
  model?: Model
}): Promise<string> {
  if (!model) {
    model = getDefaultModel()
  }
  const provider = getProviderByModel(model)

  if (!hasApiKey(provider)) {
    return ''
  }

  const AI = new AiProviderNew(model)

  const assistant = getDefaultAssistant()
  assistant.model = model
  assistant.prompt = prompt

  // const params: CompletionsParams = {
  //   callType: 'generate',
  //   messages: content,
  //   assistant,
  //   streamOutput: false
  // }

  const middlewareConfig: AiSdkMiddlewareConfig = {
    streamOutput: assistant.settings?.streamOutput ?? true,
    enableReasoning: false,
    isPromptToolUse: false,
    isSupportedToolUse: false,
    isImageGenerationEndpoint: false,
    enableWebSearch: false,
    enableGenerateImage: false
  }

  try {
    const result = await AI.completions(
      model.id,
      {
        prompt: content
      },
      {
        ...middlewareConfig,
        assistant,
        callType: 'generate'
      }
    )
    return result.getText() || ''
  } catch (error: any) {
    return ''
  }
}

export function hasApiKey(provider: Provider) {
  if (!provider) return false
  if (provider.id === 'ollama' || provider.id === 'lmstudio' || provider.type === 'vertexai') return true
  return !isEmpty(provider.apiKey)
}

/**
 * Get the first available embedding model from enabled providers
 */
// function getFirstEmbeddingModel() {
//   const providers = store.getState().llm.providers.filter((p) => p.enabled)

//   for (const provider of providers) {
//     const embeddingModel = provider.models.find((model) => isEmbeddingModel(model))
//     if (embeddingModel) {
//       return embeddingModel
//     }
//   }

//   return undefined
// }

export async function fetchModels(provider: Provider): Promise<SdkModel[]> {
  const AI = new AiProviderNew({} as Model, provider)

  try {
    return await AI.models()
  } catch (error) {
    return []
  }
}

export function checkApiProvider(provider: Provider): void {
  const key = 'api-check'
  const style = { marginTop: '3vh' }

  if (
    provider.id !== 'ollama' &&
    provider.id !== 'lmstudio' &&
    provider.type !== 'vertexai' &&
    provider.id !== 'copilot'
  ) {
    if (!provider.apiKey) {
      window.message.error({ content: i18n.t('message.error.enter.api.label'), key, style })
      throw new Error(i18n.t('message.error.enter.api.label'))
    }
  }

  if (!provider.apiHost && provider.type !== 'vertexai') {
    window.message.error({ content: i18n.t('message.error.enter.api.host'), key, style })
    throw new Error(i18n.t('message.error.enter.api.host'))
  }

  if (isEmpty(provider.models)) {
    window.message.error({ content: i18n.t('message.error.enter.model'), key, style })
    throw new Error(i18n.t('message.error.enter.model'))
  }
}

export async function checkApi(provider: Provider, model: Model, timeout = 15000): Promise<void> {
  checkApiProvider(provider)

  const ai = new AiProviderNew(model)

  const assistant = getDefaultAssistant()
  assistant.model = model
  try {
    if (isEmbeddingModel(model)) {
      // race 超时 15s
      logger.silly("it's a embedding model")
      const timerPromise = new Promise((_, reject) => setTimeout(() => reject('Timeout'), timeout))
      await Promise.race([ai.getEmbeddingDimensions(model), timerPromise])
    } else {
      const params: StreamTextParams = {
        system: assistant.prompt,
        prompt: 'hi'
      }
      const middlewareConfig: AiSdkMiddlewareConfig = {
        streamOutput: false,
        enableReasoning: false,
        isSupportedToolUse: false,
        isImageGenerationEndpoint: false,
        enableWebSearch: false,
        enableGenerateImage: false,
        isPromptToolUse: false
      }

      // Try streaming check first
      const result = await ai.completions(model.id, params, {
        ...middlewareConfig,
        assistant,
        callType: 'check'
      })
      if (!result.getText()) {
        throw new Error('No response received')
      }
    }
  } catch (error: any) {
    // 失败回退legacy
    const legacyAi = new AiProvider(provider)
    if (error.message.includes('stream')) {
      const params: CompletionsParams = {
        callType: 'check',
        messages: 'hi',
        assistant,
        streamOutput: false,
        shouldThrow: true
      }
      const result = await legacyAi.completions(params)
      if (!result.getText()) {
        throw new Error('No response received')
      }
    } else {
      throw error
    }
    // } finally {
    //   removeAbortController(taskId, abortFn)
    // }
  }
}

export async function checkModel(provider: Provider, model: Model, timeout = 15000): Promise<{ latency: number }> {
  const startTime = performance.now()
  await checkApi(provider, model, timeout)
  return { latency: performance.now() - startTime }
}
