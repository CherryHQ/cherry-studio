/**
 * 职责：提供原子化的、无状态的API调用函数
 */
import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import type { AiSdkMiddlewareConfig } from '@renderer/aiCore/middleware/AiSdkMiddlewareBuilder'
import { buildStreamTextParams } from '@renderer/aiCore/prepareParams'
import { isDedicatedImageGenerationModel, isEmbeddingModel, isFunctionCallingModel } from '@renderer/config/models'
import i18n from '@renderer/i18n'
import store from '@renderer/store'
import type { FetchChatCompletionParams } from '@renderer/types'
import type { Assistant, MCPServer, MCPTool, Model, Provider } from '@renderer/types'
import type { StreamTextParams } from '@renderer/types/aiCoreTypes'
import { type Chunk, ChunkType } from '@renderer/types/chunk'
import type { Message } from '@renderer/types/newMessage'
import type { SdkModel } from '@renderer/types/sdk'
import { removeSpecialCharactersForTopicName, uuid } from '@renderer/utils'
import { abortCompletion, readyToAbort } from '@renderer/utils/abortController'
import { isToolUseModeFunction } from '@renderer/utils/assistant'
import { isAbortError } from '@renderer/utils/error'
import { purifyMarkdownImages } from '@renderer/utils/markdown'
import { isPromptToolUse, isSupportedToolUse } from '@renderer/utils/mcp-tools'
import { findFileBlocks, getMainTextContent } from '@renderer/utils/messageUtils/find'
import { containsSupportedVariables, replacePromptVariables } from '@renderer/utils/prompt'
import { isEmpty, takeRight } from 'lodash'

import type { ModernAiProviderConfig } from '../aiCore/index_new'
import AiProviderNew from '../aiCore/index_new'
import {
  // getAssistantProvider,
  // getAssistantSettings,
  getDefaultAssistant,
  getDefaultModel,
  getProviderByModel,
  getQuickModel
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
      const toolPromises = enabledMCPs.map(async (mcpServer: MCPServer) => {
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
  prompt,
  assistant,
  requestOptions,
  onChunkReceived,
  topicId,
  uiMessages
}: FetchChatCompletionParams) {
  logger.info('fetchChatCompletion called with detailed context', {
    messageCount: messages?.length || 0,
    prompt: prompt,
    assistantId: assistant.id,
    topicId,
    hasTopicId: !!topicId,
    modelId: assistant.model?.id,
    modelName: assistant.model?.name
  })
  const AI = new AiProviderNew(assistant.model || getDefaultModel())
  const provider = AI.getActualProvider()

  const mcpTools: MCPTool[] = []
  onChunkReceived({ type: ChunkType.LLM_RESPONSE_CREATED })

  if (isPromptToolUse(assistant) || isSupportedToolUse(assistant)) {
    mcpTools.push(...(await fetchMcpTools(assistant)))
  }
  if (prompt) {
    messages = [
      {
        role: 'user',
        content: prompt
      }
    ]
  }

  // 使用 transformParameters 模块构建参数
  const {
    params: aiSdkParams,
    modelId,
    capabilities,
    webSearchPluginConfig
  } = await buildStreamTextParams(messages, assistant, provider, {
    mcpTools: mcpTools,
    webSearchProviderId: assistant.webSearchProviderId,
    requestOptions
  })

  // Safely fallback to prompt tool use when function calling is not supported by model.
  const usePromptToolUse =
    isPromptToolUse(assistant) || (isToolUseModeFunction(assistant) && !isFunctionCallingModel(assistant.model))

  const middlewareConfig: AiSdkMiddlewareConfig = {
    streamOutput: assistant.settings?.streamOutput ?? true,
    onChunk: onChunkReceived,
    model: assistant.model,
    enableReasoning: capabilities.enableReasoning,
    isPromptToolUse: usePromptToolUse,
    isSupportedToolUse: isSupportedToolUse(assistant),
    isImageGenerationEndpoint: isDedicatedImageGenerationModel(assistant.model || getDefaultModel()),
    webSearchPluginConfig: webSearchPluginConfig,
    enableWebSearch: capabilities.enableWebSearch,
    enableGenerateImage: capabilities.enableGenerateImage,
    enableUrlContext: capabilities.enableUrlContext,
    mcpTools,
    uiMessages,
    knowledgeRecognition: assistant.knowledgeRecognition
  }

  // --- Call AI Completions ---
  await AI.completions(modelId, aiSdkParams, {
    ...middlewareConfig,
    assistant,
    topicId,
    callType: 'chat',
    uiMessages
  })
}

export async function fetchMessagesSummary({ messages, assistant }: { messages: Message[]; assistant: Assistant }) {
  let prompt = (await preferenceService.get('topic.naming_prompt')) || i18n.t('prompts.title')
  const model = getQuickModel() || assistant?.model || getDefaultModel()

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

  const topicId = messages?.find((message) => message.topicId)?.topicId || ''

  // LLM对多条消息的总结有问题，用单条结构化的消息表示会话内容会更好
  const structredMessages = contextMessages.map((message) => {
    const structredMessage = {
      role: message.role,
      mainText: purifyMarkdownImages(getMainTextContent(message))
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
    enableUrlContext: false,
    mcpTools: []
  }
  try {
    // 从 messages 中找到有 traceId 的助手消息，用于绑定现有 trace
    const messageWithTrace = messages.find((m) => m.role === 'assistant' && m.traceId)

    if (messageWithTrace && messageWithTrace.traceId) {
      // 导入并调用 appendTrace 来绑定现有 trace，传入summary使用的模型名
      const { appendTrace } = await import('@renderer/services/SpanManagerService')
      await appendTrace({ topicId, traceId: messageWithTrace.traceId, model })
    }

    const { getText } = await AI.completions(model.id, llmMessages, {
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

export async function fetchNoteSummary({ content, assistant }: { content: string; assistant?: Assistant }) {
  let prompt = (await preferenceService.get('topic.naming_prompt')) || i18n.t('prompts.title')
  const resolvedAssistant = assistant || getDefaultAssistant()
  const model = getQuickModel() || resolvedAssistant.model || getDefaultModel()

  if (prompt && containsSupportedVariables(prompt)) {
    prompt = await replacePromptVariables(prompt, model.name)
  }

  const provider = getProviderByModel(model)

  if (!hasApiKey(provider)) {
    return null
  }

  const AI = new AiProviderNew(model)

  // only 2000 char and no images
  const truncatedContent = content.substring(0, 2000)
  const purifiedContent = purifyMarkdownImages(truncatedContent)

  const summaryAssistant = {
    ...resolvedAssistant,
    settings: {
      ...resolvedAssistant.settings,
      reasoning_effort: undefined,
      qwenThinkMode: false
    },
    prompt,
    model
  }

  const llmMessages = {
    system: prompt,
    prompt: purifiedContent
  }

  const middlewareConfig: AiSdkMiddlewareConfig = {
    streamOutput: false,
    enableReasoning: false,
    isPromptToolUse: false,
    isSupportedToolUse: false,
    isImageGenerationEndpoint: false,
    enableWebSearch: false,
    enableGenerateImage: false,
    enableUrlContext: false,
    mcpTools: []
  }

  try {
    const { getText } = await AI.completions(model.id, llmMessages, {
      ...middlewareConfig,
      assistant: summaryAssistant,
      callType: 'summary'
    })
    const text = getText()
    return removeSpecialCharactersForTopicName(text) || null
  } catch (error: any) {
    return null
  }
}

// export async function fetchSearchSummary({ messages, assistant }: { messages: Message[]; assistant: Assistant }) {
//   const model = getQuickModel() || assistant.model || getDefaultModel()
//   const provider = getProviderByModel(model)

//   if (!hasApiKey(provider)) {
//     return null
//   }

//   const topicId = messages?.find((message) => message.topicId)?.topicId || undefined

//   const AI = new AiProvider(provider)

//   const params: CompletionsParams = {
//     callType: 'search',
//     messages: messages,
//     assistant,
//     streamOutput: false,
//     topicId
//   }

//   return await AI.completionsForTrace(params)
// }

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
    streamOutput: assistant.settings?.streamOutput ?? false,
    enableReasoning: false,
    isPromptToolUse: false,
    isSupportedToolUse: false,
    isImageGenerationEndpoint: false,
    enableWebSearch: false,
    enableGenerateImage: false,
    enableUrlContext: false
  }

  try {
    const result = await AI.completions(
      model.id,
      {
        system: prompt,
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
  if (['ollama', 'lmstudio', 'vertexai', 'cherryai'].includes(provider.id)) return true
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
  const AI = new AiProviderNew(provider)

  try {
    return await AI.models()
  } catch (error) {
    return []
  }
}

export function checkApiProvider(provider: Provider): void {
  if (
    provider.id !== 'ollama' &&
    provider.id !== 'lmstudio' &&
    provider.type !== 'vertexai' &&
    provider.id !== 'copilot'
  ) {
    if (!provider.apiKey) {
      window.toast.error(i18n.t('message.error.enter.api.label'))
      throw new Error(i18n.t('message.error.enter.api.label'))
    }
  }

  if (!provider.apiHost && provider.type !== 'vertexai') {
    window.toast.error(i18n.t('message.error.enter.api.host'))
    throw new Error(i18n.t('message.error.enter.api.host'))
  }

  if (isEmpty(provider.models)) {
    window.toast.error(i18n.t('message.error.enter.model'))
    throw new Error(i18n.t('message.error.enter.model'))
  }
}

export async function checkApi(provider: Provider, model: Model, timeout = 15000): Promise<void> {
  checkApiProvider(provider)

  // Don't pass in provider parameter. We need auto-format URL
  const ai = new AiProviderNew(model)

  const assistant = getDefaultAssistant()
  assistant.model = model
  assistant.prompt = 'test' // 避免部分 provider 空系统提示词会报错

  if (isEmbeddingModel(model)) {
    // race 超时 15s
    logger.silly("it's a embedding model")
    const timerPromise = new Promise((_, reject) => setTimeout(() => reject('Timeout'), timeout))
    await Promise.race([ai.getEmbeddingDimensions(model), timerPromise])
  } else {
    const abortId = uuid()
    const signal = readyToAbort(abortId)
    let chunkError
    const params: StreamTextParams = {
      system: assistant.prompt,
      prompt: 'hi',
      abortSignal: signal
    }
    const config: ModernAiProviderConfig = {
      streamOutput: true,
      enableReasoning: false,
      isSupportedToolUse: false,
      isImageGenerationEndpoint: false,
      enableWebSearch: false,
      enableGenerateImage: false,
      isPromptToolUse: false,
      enableUrlContext: false,
      assistant,
      callType: 'check',
      onChunk: (chunk: Chunk) => {
        if (chunk.type === ChunkType.ERROR) {
          chunkError = chunk.error
        } else {
          abortCompletion(abortId)
        }
      }
    }

    // Try streaming check
    try {
      await ai.completions(model.id, params, config)
    } catch (e) {
      if (!isAbortError(e) && !isAbortError(chunkError)) {
        throw e
      }
    }
  }
}

export async function checkModel(provider: Provider, model: Model, timeout = 15000): Promise<{ latency: number }> {
  const startTime = performance.now()
  await checkApi(provider, model, timeout)
  return { latency: performance.now() - startTime }
}
