/**
 * 职责：提供原子化的、无状态的API调用函数
 */
import { cacheService } from '@data/CacheService'
import { dataApiService } from '@data/DataApiService'
import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { buildStreamTextParams } from '@renderer/aiCore/prepareParams'
import type { AiSdkMiddlewareConfig } from '@renderer/aiCore/types/middlewareConfig'
import { isDedicatedImageGenerationModel, isEmbeddingModel, isFunctionCallingModel } from '@renderer/config/models'
import i18n from '@renderer/i18n'
import { hubMCPServer } from '@renderer/store/mcp'
import type { Assistant, MCPServer, MCPTool, Model, Provider } from '@renderer/types'
import { type FetchChatCompletionParams, getEffectiveMcpMode, isSystemProvider } from '@renderer/types'
import { type Chunk, ChunkType } from '@renderer/types/chunk'
import type { Message } from '@renderer/types/newMessage'
import { removeSpecialCharactersForTopicName } from '@renderer/utils'
import { isToolUseModeFunction } from '@renderer/utils/assistant'
import { isPromptToolUse, isSupportedToolUse } from '@renderer/utils/assistant'
import { getErrorMessage } from '@renderer/utils/error'
import { purifyMarkdownImages } from '@renderer/utils/markdown'
import { findFileBlocks, findImageBlocks, getMainTextContent } from '@renderer/utils/messageUtils/find'
import { containsSupportedVariables, replacePromptVariables } from '@renderer/utils/prompt'
import { NOT_SUPPORT_API_KEY_PROVIDER_TYPES, NOT_SUPPORT_API_KEY_PROVIDERS } from '@renderer/utils/provider'
import { isEmpty, takeRight } from 'lodash'

import { AiProvider } from '../aiCore'
import {
  // getAssistantProvider,
  // getAssistantSettings,
  getDefaultAssistant,
  getDefaultModel,
  getProviderByModel,
  getQuickModel
} from './AssistantService'
import { ConversationService } from './ConversationService'
import FileManager from './FileManager'
import { injectUserMessageWithKnowledgeSearchPrompt } from './KnowledgeService'
import type { BlockManager } from './messageStreaming'
import type { StreamProcessorCallbacks } from './StreamProcessingService'
// import { processKnowledgeSearch } from './KnowledgeService'
// import {
//   filterContextMessages,
//   filterEmptyMessages,
//   filterUsefulMessages,
//   filterUserRoleStartMessages
// } from './MessagesService'
// import WebSearchService from './WebSearchService'

// FIXME: 这里太多重复逻辑，需要重构

const logger = loggerService.withContext('ApiService')

/**
 * Fetch active MCP servers from the Data API.
 */
async function fetchActiveMcpServers(): Promise<MCPServer[]> {
  const response = await dataApiService.get('/mcp-servers', { query: { isActive: true } })
  return (response as { items: MCPServer[] }).items ?? []
}

/**
 * Get the MCP servers to use based on the assistant's MCP mode.
 */
export async function getMcpServersForAssistant(assistant: Assistant): Promise<MCPServer[]> {
  const mode = getEffectiveMcpMode(assistant)

  switch (mode) {
    case 'disabled':
      return []
    case 'auto':
      return [hubMCPServer]
    case 'manual': {
      const activedMcpServers = await fetchActiveMcpServers()
      const assistantMcpServers = assistant.mcpServers || []
      return activedMcpServers.filter((server) => assistantMcpServers.some((s) => s.id === server.id))
    }
    default:
      return []
  }
}

export async function fetchAllActiveServerTools(): Promise<MCPTool[]> {
  const activedMcpServers = await fetchActiveMcpServers()

  if (activedMcpServers.length === 0) {
    return []
  }

  try {
    const toolPromises = activedMcpServers.map(async (mcpServer: MCPServer) => {
      try {
        const tools = await window.api.mcp.listTools(mcpServer)
        return tools.filter((tool: any) => !mcpServer.disabledTools?.includes(tool.name))
      } catch (error) {
        logger.error(`Error fetching tools from MCP server ${mcpServer.name}:`, error as Error)
        return []
      }
    })
    const results = await Promise.allSettled(toolPromises)
    return results
      .filter((result): result is PromiseFulfilledResult<MCPTool[]> => result.status === 'fulfilled')
      .map((result) => result.value)
      .flat()
  } catch (toolError) {
    logger.error('Error fetching all active server tools:', toolError as Error)
    return []
  }
}

export async function fetchMcpTools(assistant: Assistant) {
  let mcpTools: MCPTool[] = []
  const enabledMCPs = await getMcpServersForAssistant(assistant)

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

/**
 * 将用户消息转换为LLM可以理解的格式并发送请求
 * @param request - 包含消息内容和助手信息的请求对象
 * @param onChunkReceived - 接收流式响应数据的回调函数
 */
// 目前先按照函数来写,后续如果有需要到class的地方就改回来
export async function transformMessagesAndFetch(
  request: {
    messages: Message[]
    assistant: Assistant
    blockManager: BlockManager
    assistantMsgId: string
    callbacks: StreamProcessorCallbacks
    topicId?: string // 添加 topicId 用于 trace
    allowedTools?: string[]
    options: {
      signal?: AbortSignal
      timeout?: number
      headers?: Record<string, string>
    }
  },
  onChunkReceived: (chunk: Chunk) => void
) {
  const { messages, assistant } = request

  try {
    const { modelMessages, uiMessages } = await ConversationService.prepareMessagesForModel(messages, assistant)

    // replace prompt variables
    assistant.prompt = await replacePromptVariables(assistant.prompt, assistant.model?.name)

    // 专用图像生成模型直接走 fetchImageGeneration
    const model = assistant.model || getDefaultModel()
    if (isDedicatedImageGenerationModel(model)) {
      await fetchImageGeneration({
        messages: uiMessages,
        assistant,
        onChunkReceived
      })
      return
    }

    // inject knowledge search prompt into model messages
    await injectUserMessageWithKnowledgeSearchPrompt({
      modelMessages,
      assistant,
      assistantMsgId: request.assistantMsgId,
      topicId: request.topicId,
      blockManager: request.blockManager,
      setCitationBlockId: request.callbacks.setCitationBlockId!
    })

    await fetchChatCompletion({
      messages: modelMessages,
      assistant: assistant,
      topicId: request.topicId,
      allowedTools: request.allowedTools,
      requestOptions: request.options,
      uiMessages,
      onChunkReceived
    })
  } catch (error: any) {
    onChunkReceived({ type: ChunkType.ERROR, error })
  }
}

/**
 * Note: This path always uses AI SDK streaming under the hood via `streamText`.
 * There is no `generateText` (non-stream) branch inside this function.
 */
export async function fetchChatCompletion({
  messages,
  prompt,
  assistant,
  requestOptions,
  onChunkReceived,
  topicId,
  uiMessages,
  allowedTools
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

  // Get base provider and apply API key rotation
  // NOTE: Shallow copy is intentional. Provider objects are not mutated by downstream code.
  // Nested properties (if any) are never modified after creation.
  const baseProvider = getProviderByModel(assistant.model || getDefaultModel())
  const providerWithRotatedKey = {
    ...baseProvider,
    apiKey: getRotatedApiKey(baseProvider)
  }

  const AI = new AiProvider(assistant.model || getDefaultModel(), providerWithRotatedKey)
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
    allowedTools,
    webSearchProviderId: assistant.webSearchProviderId,
    requestOptions
  })

  // Safely fallback to prompt tool use when function calling is not supported by model.
  const usePromptToolUse =
    isPromptToolUse(assistant) || (isToolUseModeFunction(assistant) && !isFunctionCallingModel(assistant.model))

  const mcpMode = getEffectiveMcpMode(assistant)
  const middlewareConfig: AiSdkMiddlewareConfig = {
    streamOutput: assistant.settings?.streamOutput ?? true,
    onChunk: onChunkReceived,
    enableReasoning: capabilities.enableReasoning,
    isPromptToolUse: usePromptToolUse,
    isSupportedToolUse: isSupportedToolUse(assistant),
    webSearchPluginConfig: webSearchPluginConfig,
    enableWebSearch: capabilities.enableWebSearch,
    enableGenerateImage: capabilities.enableGenerateImage,
    enableUrlContext: capabilities.enableUrlContext,
    mcpMode,
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

/**
 * 从消息中收集图像（用于图像编辑）
 * 收集用户消息中上传的图像和助手消息中生成的图像
 */
async function collectImagesFromMessages(userMessage: Message, assistantMessage?: Message): Promise<string[]> {
  const images: string[] = []

  // 收集用户消息中的图像
  const userImageBlocks = findImageBlocks(userMessage)
  for (const block of userImageBlocks) {
    if (block.file) {
      const base64 = await FileManager.readBase64File(block.file)
      const mimeType = block.file.type || 'image/png'
      images.push(`data:${mimeType};base64,${base64}`)
    }
  }

  // 收集助手消息中的图像（用于继续编辑生成的图像）
  if (assistantMessage) {
    const assistantImageBlocks = findImageBlocks(assistantMessage)
    for (const block of assistantImageBlocks) {
      if (block.url) {
        images.push(block.url)
      }
    }
  }

  return images
}

/**
 * 独立的图像生成函数
 * 专用于 DALL-E、GPT-Image-1 等专用图像生成模型
 * 通过 Main IPC (window.api.ai.generateImage) 执行
 */
export async function fetchImageGeneration({
  messages,
  assistant,
  onChunkReceived
}: {
  messages: Message[]
  assistant: Assistant
  onChunkReceived: (chunk: Chunk) => void
}) {
  const model = assistant.model || getDefaultModel()

  onChunkReceived({ type: ChunkType.LLM_RESPONSE_CREATED })
  onChunkReceived({ type: ChunkType.IMAGE_CREATED })

  const startTime = Date.now()

  try {
    const lastUserMessage = messages.findLast((m) => m.role === 'user')
    const lastAssistantMessage = messages.findLast((m) => m.role === 'assistant')

    if (!lastUserMessage) {
      throw new Error('No user message found for image generation.')
    }

    const prompt = getMainTextContent(lastUserMessage)
    const inputImages = await collectImagesFromMessages(lastUserMessage, lastAssistantMessage)

    const { images } = await window.api.ai.generateImage({
      providerId: model.provider,
      modelId: model.id,
      prompt: prompt || '',
      inputImages: inputImages.length > 0 ? inputImages : undefined,
      n: 1,
      size: '1024x1024'
    })

    const imageType = images[0]?.startsWith('data:') ? 'base64' : 'url'
    onChunkReceived({
      type: ChunkType.IMAGE_COMPLETE,
      image: { type: imageType, images }
    })

    onChunkReceived({
      type: ChunkType.LLM_RESPONSE_COMPLETE,
      response: {
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        metrics: {
          completion_tokens: 0,
          time_first_token_millsec: 0,
          time_completion_millsec: Date.now() - startTime
        }
      }
    })
  } catch (error) {
    onChunkReceived({ type: ChunkType.ERROR, error: error as Error })
    throw error
  }
}

export async function fetchMessagesSummary({
  messages
}: {
  messages: Message[]
}): Promise<{ text: string | null; error?: string }> {
  let prompt = (await preferenceService.get('topic.naming_prompt')) || i18n.t('prompts.title')
  const model = getQuickModel()

  if (prompt && containsSupportedVariables(prompt)) {
    prompt = await replacePromptVariables(prompt, model.name)
  }

  // 取最后5条消息，结构化为 JSON
  const contextMessages = takeRight(messages, 5)
  const structuredMessages = contextMessages.map((message) => {
    const fileBlocks = findFileBlocks(message)
    const fileList = fileBlocks.map((b) => b.file.origin_name).filter(Boolean)
    return {
      role: message.role,
      mainText: purifyMarkdownImages(getMainTextContent(message)),
      files: fileList.length > 0 ? fileList : undefined
    }
  })
  const conversation = JSON.stringify(structuredMessages)

  try {
    const { text } = await window.api.ai.generateText({
      providerId: model.provider,
      modelId: model.id,
      system: prompt,
      prompt: conversation
    })

    const result = removeSpecialCharactersForTopicName(text)
    return result ? { text: result } : { text: null, error: i18n.t('error.no_response') }
  } catch (error: unknown) {
    return { text: null, error: getErrorMessage(error) }
  }
}

export async function fetchNoteSummary({ content, assistant }: { content: string; assistant?: Assistant }) {
  let prompt = (await preferenceService.get('topic.naming_prompt')) || i18n.t('prompts.title')
  const resolvedAssistant = assistant || getDefaultAssistant()
  const model = getQuickModel() || resolvedAssistant.model || getDefaultModel()

  if (prompt && containsSupportedVariables(prompt)) {
    prompt = await replacePromptVariables(prompt, model.name)
  }

  // only 2000 chars, no images
  const purifiedContent = purifyMarkdownImages(content.substring(0, 2000))

  try {
    const { text } = await window.api.ai.generateText({
      providerId: model.provider,
      modelId: model.id,
      system: prompt,
      prompt: purifiedContent
    })
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
  try {
    const resolvedModel = model || getDefaultModel()
    const { text } = await window.api.ai.generateText({
      providerId: resolvedModel.provider,
      modelId: resolvedModel.id,
      system: prompt,
      prompt: content
    })
    return text || ''
  } catch (error: any) {
    logger.error('fetchGenerate failed', error)
    return ''
  }
}

export function hasApiKey(provider: Provider) {
  if (!provider) return false
  if (provider.id === 'cherryai') return true
  if (
    (isSystemProvider(provider) && NOT_SUPPORT_API_KEY_PROVIDERS.includes(provider.id)) ||
    NOT_SUPPORT_API_KEY_PROVIDER_TYPES.includes(provider.type)
  )
    return true
  return !isEmpty(provider.apiKey)
}

/**
 * Get rotated API key for providers that support multiple keys
 * Returns empty string for providers that don't require API keys
 */
function getRotatedApiKey(provider: Provider): string {
  // Handle providers that don't require API keys
  if (!provider.apiKey || provider.apiKey.trim() === '') {
    return ''
  }

  const keys = provider.apiKey
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean)

  if (keys.length === 0) {
    return ''
  }

  const keyName = `provider:${provider.id}:last_used_key`

  // If only one key, return it directly
  if (keys.length === 1) {
    return keys[0]
  }

  const lastUsedKey = cacheService.getCasual<string>(keyName)
  if (!lastUsedKey) {
    cacheService.setCasual(keyName, keys[0])
    return keys[0]
  }

  const currentIndex = keys.indexOf(lastUsedKey)

  // Log when the last used key is no longer in the list
  if (currentIndex === -1) {
    logger.debug('Last used API key no longer found in provider keys, falling back to first key', {
      providerId: provider.id,
      lastUsedKey: lastUsedKey.substring(0, 8) + '...' // Only log first 8 chars for security
    })
  }

  const nextIndex = (currentIndex + 1) % keys.length
  const nextKey = keys[nextIndex]
  cacheService.setCasual(keyName, nextKey)

  return nextKey
}

export async function fetchModels(provider: Provider): Promise<Model[]> {
  try {
    return await window.api.ai.listModels({ providerId: provider.id })
  } catch (error) {
    logger.error('Failed to fetch models from provider', {
      providerId: provider.id,
      providerName: provider.name,
      error: error as Error
    })
    return []
  }
}

export function checkApiProvider(provider: Provider): void {
  const isExcludedProvider =
    (isSystemProvider(provider) && NOT_SUPPORT_API_KEY_PROVIDERS.includes(provider.id)) ||
    NOT_SUPPORT_API_KEY_PROVIDER_TYPES.includes(provider.type)

  if (!isExcludedProvider) {
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

/**
 * Validates that a provider/model pair is working by sending a minimal request.
 * Non-embedding models: via Main IPC (window.api.ai.checkModel)
 * Embedding models: still uses renderer-side AiProvider (TODO: migrate to Main)
 */
export async function checkApi(provider: Provider, model: Model, timeout = 15000): Promise<void> {
  checkApiProvider(provider)

  if (isEmbeddingModel(model)) {
    const timerPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout))
    await Promise.race([
      window.api.ai.embedMany({ providerId: provider.id, modelId: model.id, values: ['test'] }),
      timerPromise
    ])
  } else {
    await window.api.ai.checkModel({ providerId: provider.id, modelId: model.id, timeout })
  }
}

export async function checkModel(provider: Provider, model: Model, timeout = 15000): Promise<{ latency: number }> {
  const startTime = performance.now()
  await checkApi(provider, model, timeout)
  return { latency: performance.now() - startTime }
}
