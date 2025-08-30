/**
 * AI SDK 参数转换模块
 * 统一管理从各个 apiClient 提取的参数处理和转换功能
 */

import { loggerService } from '@logger'
import {
  isClaudeReasoningModel,
  isGenerateImageModel,
  isNotSupportTemperatureAndTopP,
  isOpenRouterBuiltInWebSearchModel,
  isReasoningModel,
  isSupportedDisableGenerationModel,
  isSupportedFlexServiceTier,
  isSupportedReasoningEffortModel,
  isSupportedThinkingTokenModel,
  isVisionModel,
  isWebSearchModel
} from '@renderer/config/models'
import { getAssistantSettings, getDefaultModel, getProviderByModel } from '@renderer/services/AssistantService'
import type { Assistant, MCPTool, Message, Model, Provider } from '@renderer/types'
import { FileTypes } from '@renderer/types'
import type { StreamTextParams } from '@renderer/types/aiCoreTypes'
import { FileMessageBlock, ImageMessageBlock, ThinkingMessageBlock } from '@renderer/types/newMessage'
// import { getWebSearchTools } from './utils/websearch'
import {
  findFileBlocks,
  findImageBlocks,
  findThinkingBlocks,
  getMainTextContent
} from '@renderer/utils/messageUtils/find'
import { defaultTimeout } from '@shared/config/constant'
import type { AssistantModelMessage, FilePart, ImagePart, ModelMessage, TextPart, UserModelMessage } from 'ai'
import { stepCountIs } from 'ai'

import { getAiSdkProviderId } from './provider/factory'
// import { webSearchTool } from './tools/WebSearchTool'
// import { jsonSchemaToZod } from 'json-schema-to-zod'
import { setupToolsConfig } from './utils/mcp'
import { buildProviderOptions } from './utils/options'

const logger = loggerService.withContext('transformParameters')

/**
 * 获取温度参数
 */
function getTemperature(assistant: Assistant, model: Model): number | undefined {
  if (assistant.settings?.reasoning_effort && isClaudeReasoningModel(model)) {
    return undefined
  }
  if (isNotSupportTemperatureAndTopP(model)) {
    return undefined
  }
  const assistantSettings = getAssistantSettings(assistant)
  return assistantSettings?.enableTemperature ? assistantSettings?.temperature : undefined
}

/**
 * 获取 TopP 参数
 */
function getTopP(assistant: Assistant, model: Model): number | undefined {
  if (assistant.settings?.reasoning_effort && isClaudeReasoningModel(model)) {
    return undefined
  }
  if (isNotSupportTemperatureAndTopP(model)) {
    return undefined
  }
  const assistantSettings = getAssistantSettings(assistant)
  return assistantSettings?.enableTopP ? assistantSettings?.topP : undefined
}

/**
 * 获取超时设置
 */
export function getTimeout(model: Model): number {
  if (isSupportedFlexServiceTier(model)) {
    return 15 * 1000 * 60
  }
  return defaultTimeout
}

/**
 * 提取文件内容
 */
export async function extractFileContent(message: Message): Promise<string> {
  const fileBlocks = findFileBlocks(message)
  if (fileBlocks.length > 0) {
    const textFileBlocks = fileBlocks.filter(
      (fb) => fb.file && [FileTypes.TEXT, FileTypes.DOCUMENT].includes(fb.file.type)
    )

    if (textFileBlocks.length > 0) {
      let text = ''
      const divider = '\n\n---\n\n'

      for (const fileBlock of textFileBlocks) {
        const file = fileBlock.file
        const fileContent = (await window.api.file.read(file.id + file.ext)).trim()
        const fileNameRow = 'file: ' + file.origin_name + '\n\n'
        text = text + fileNameRow + fileContent + divider
      }

      return text
    }
  }

  return ''
}

/**
 * 转换消息为 AI SDK 参数格式
 * 基于 OpenAI 格式的通用转换，支持文本、图片和文件
 */
export async function convertMessageToSdkParam(
  message: Message,
  isVisionModel = false,
  model?: Model
): Promise<ModelMessage> {
  const content = getMainTextContent(message)
  const fileBlocks = findFileBlocks(message)
  const imageBlocks = findImageBlocks(message)
  const reasoningBlocks = findThinkingBlocks(message)
  if (message.role === 'user' || message.role === 'system') {
    return convertMessageToUserModelMessage(content, fileBlocks, imageBlocks, isVisionModel, model)
  } else {
    return convertMessageToAssistantModelMessage(content, fileBlocks, reasoningBlocks, model)
  }
}

async function convertMessageToUserModelMessage(
  content: string,
  fileBlocks: FileMessageBlock[],
  imageBlocks: ImageMessageBlock[],
  isVisionModel = false,
  model?: Model
): Promise<UserModelMessage> {
  const parts: Array<TextPart | FilePart | ImagePart> = []
  if (content) {
    parts.push({ type: 'text', text: content })
  }

  // 处理图片（仅在支持视觉的模型中）
  if (isVisionModel) {
    for (const imageBlock of imageBlocks) {
      if (imageBlock.file) {
        try {
          const image = await window.api.file.base64Image(imageBlock.file.id + imageBlock.file.ext)
          parts.push({
            type: 'image',
            image: image.base64,
            mediaType: image.mime
          })
        } catch (error) {
          logger.warn('Failed to load image:', error as Error)
        }
      } else if (imageBlock.url) {
        parts.push({
          type: 'image',
          image: imageBlock.url
        })
      }
    }
  }

  // 处理文件
  for (const fileBlock of fileBlocks) {
    // 优先尝试原生文件支持（PDF等）
    if (model) {
      const filePart = await convertFileBlockToFilePart(fileBlock, model)
      if (filePart) {
        parts.push(filePart)
        continue
      }
    }

    // 回退到文本处理
    const textPart = await convertFileBlockToTextPart(fileBlock)
    if (textPart) {
      parts.push(textPart)
    }
  }

  return {
    role: 'user',
    content: parts
  }
}

async function convertMessageToAssistantModelMessage(
  content: string,
  fileBlocks: FileMessageBlock[],
  thinkingBlocks: ThinkingMessageBlock[],
  model?: Model
): Promise<AssistantModelMessage> {
  const parts: Array<TextPart | FilePart> = []
  if (content) {
    parts.push({ type: 'text', text: content })
  }

  for (const thinkingBlock of thinkingBlocks) {
    parts.push({ type: 'text', text: thinkingBlock.content })
  }

  for (const fileBlock of fileBlocks) {
    // 优先尝试原生文件支持（PDF等）
    if (model) {
      const filePart = await convertFileBlockToFilePart(fileBlock, model)
      if (filePart) {
        parts.push(filePart)
        continue
      }
    }

    // 回退到文本处理
    const textPart = await convertFileBlockToTextPart(fileBlock)
    if (textPart) {
      parts.push(textPart)
    }
  }

  return {
    role: 'assistant',
    content: parts
  }
}

async function convertFileBlockToTextPart(fileBlock: FileMessageBlock): Promise<TextPart | null> {
  const file = fileBlock.file

  if (file.type === FileTypes.TEXT) {
    try {
      const fileContent = await window.api.file.read(file.id + file.ext)
      return {
        type: 'text',
        text: `${file.origin_name}\n${fileContent.trim()}`
      }
    } catch (error) {
      logger.warn('Failed to read file:', error as Error)
    }
  }

  return null
}

/**
 * 检查模型是否支持原生PDF输入
 */
function supportsPdfInput(model: Model): boolean {
  // 基于AI SDK文档，这些提供商支持PDF输入
  const supportedProviders = [
    'openai',
    'azure-openai',
    'anthropic',
    'google',
    'google-generative-ai',
    'google-vertex',
    'bedrock',
    'amazon-bedrock'
  ]

  const provider = getProviderByModel(model)
  const aiSdkId = getAiSdkProviderId(provider)

  return supportedProviders.some((provider) => aiSdkId === provider)
}

/**
 * 将文件块转换为FilePart（用于原生文件支持）
 */
async function convertFileBlockToFilePart(fileBlock: FileMessageBlock, model: Model): Promise<FilePart | null> {
  const file = fileBlock.file

  if (file.type === FileTypes.DOCUMENT && file.ext === '.pdf' && supportsPdfInput(model)) {
    try {
      const base64Data = await window.api.file.base64File(file.id + file.ext)
      return {
        type: 'file',
        data: base64Data,
        mediaType: 'application/pdf',
        filename: file.origin_name
      }
    } catch (error) {
      logger.warn('Failed to read PDF file:', error as Error)
    }
  }

  return null
}

/**
 * 转换 Cherry Studio 消息数组为 AI SDK 消息数组
 */
export async function convertMessagesToSdkMessages(
  messages: Message[],
  model: Model
): Promise<StreamTextParams['messages']> {
  const sdkMessages: StreamTextParams['messages'] = []
  const isVision = isVisionModel(model)

  for (const message of messages) {
    const sdkMessage = await convertMessageToSdkParam(message, isVision, model)
    sdkMessages.push(sdkMessage)
  }

  return sdkMessages
}

/**
 * 构建 AI SDK 流式参数
 * 这是主要的参数构建函数，整合所有转换逻辑
 */
export async function buildStreamTextParams(
  sdkMessages: StreamTextParams['messages'],
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

  const { maxTokens } = getAssistantSettings(assistant)

  // 这三个变量透传出来，交给下面动态启用插件/中间件
  // 也可以在外部构建好再传入buildStreamTextParams
  // FIXME: qwen3即使关闭思考仍然会导致enableReasoning的结果为true
  const enableReasoning =
    ((isSupportedThinkingTokenModel(model) || isSupportedReasoningEffortModel(model)) &&
      assistant.settings?.reasoning_effort !== undefined) ||
    (isReasoningModel(model) && (!isSupportedThinkingTokenModel(model) || !isSupportedReasoningEffortModel(model)))

  const enableWebSearch =
    (assistant.enableWebSearch && isWebSearchModel(model)) ||
    isOpenRouterBuiltInWebSearchModel(model) ||
    model.id.includes('sonar') ||
    false

  const enableUrlContext = assistant.enableUrlContext || false

  const enableGenerateImage =
    isGenerateImageModel(model) &&
    (isSupportedDisableGenerationModel(model) ? assistant.enableGenerateImage || false : true)

  const tools = setupToolsConfig(mcpTools)

  // if (webSearchProviderId) {
  //   tools['builtin_web_search'] = webSearchTool(webSearchProviderId)
  // }

  // 构建真正的 providerOptions
  const providerOptions = buildProviderOptions(assistant, model, provider, {
    enableReasoning,
    enableWebSearch,
    enableGenerateImage
  })

  // 构建基础参数
  const params: StreamTextParams = {
    messages: sdkMessages,
    maxOutputTokens: maxTokens,
    temperature: getTemperature(assistant, model),
    topP: getTopP(assistant, model),
    abortSignal: options.requestOptions?.signal,
    headers: options.requestOptions?.headers,
    providerOptions,
    tools,
    stopWhen: stepCountIs(10)
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
