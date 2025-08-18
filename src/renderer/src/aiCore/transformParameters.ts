/**
 * AI SDK 参数转换模块
 * 统一管理从各个 apiClient 提取的参数处理和转换功能
 */

import {
  AssistantModelMessage,
  FilePart,
  ImagePart,
  ModelMessage,
  stepCountIs,
  type StreamTextParams,
  TextPart,
  UserModelMessage
} from '@cherrystudio/ai-core'
import { DEFAULT_MAX_TOKENS } from '@renderer/config/constant'
import {
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
import { getAssistantSettings, getDefaultModel } from '@renderer/services/AssistantService'
import type { Assistant, MCPTool, Message, Model, Provider } from '@renderer/types'
import { FileTypes } from '@renderer/types'
import { FileMessageBlock, ImageMessageBlock, ThinkingMessageBlock } from '@renderer/types/newMessage'
// import { getWebSearchTools } from './utils/websearch'
import {
  findFileBlocks,
  findImageBlocks,
  findThinkingBlocks,
  getMainTextContent
} from '@renderer/utils/messageUtils/find'
import { defaultTimeout } from '@shared/config/constant'

// import { webSearchTool } from './tools/WebSearchTool'
// import { jsonSchemaToZod } from 'json-schema-to-zod'
import { setupToolsConfig } from './utils/mcp'
import { buildProviderOptions } from './utils/options'

/**
 * 获取温度参数
 */
export function getTemperature(assistant: Assistant, model: Model): number | undefined {
  return isNotSupportTemperatureAndTopP(model) ? undefined : assistant.settings?.temperature
}

/**
 * 获取 TopP 参数
 */
export function getTopP(assistant: Assistant, model: Model): number | undefined {
  return isNotSupportTemperatureAndTopP(model) ? undefined : assistant.settings?.topP
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
export async function convertMessageToSdkParam(message: Message, isVisionModel = false): Promise<ModelMessage> {
  const content = getMainTextContent(message)
  const fileBlocks = findFileBlocks(message)
  const imageBlocks = findImageBlocks(message)
  const reasoningBlocks = findThinkingBlocks(message)
  if (message.role === 'user' || message.role === 'system') {
    return convertMessageToUserModelMessage(content, fileBlocks, imageBlocks, isVisionModel)
  } else {
    return convertMessageToAssistantModelMessage(content, fileBlocks, reasoningBlocks)
  }
}

async function convertMessageToUserModelMessage(
  content: string,
  fileBlocks: FileMessageBlock[],
  imageBlocks: ImageMessageBlock[],
  isVisionModel = false
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
          console.warn('Failed to load image:', error)
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
  thinkingBlocks: ThinkingMessageBlock[]
): Promise<AssistantModelMessage> {
  const parts: Array<TextPart | FilePart> = []
  if (content) {
    parts.push({ type: 'text', text: content })
  }

  for (const thinkingBlock of thinkingBlocks) {
    parts.push({ type: 'text', text: thinkingBlock.content })
  }

  for (const fileBlock of fileBlocks) {
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

  if ([FileTypes.TEXT, FileTypes.DOCUMENT].includes(file.type)) {
    try {
      const fileContent = await window.api.file.read(file.id + file.ext)
      return {
        type: 'text',
        text: `${file.origin_name}\n${fileContent.trim()}`
      }
    } catch (error) {
      console.warn('Failed to read file:', error)
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
    const sdkMessage = await convertMessageToSdkParam(message, isVision)
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

  const { maxTokens, reasoning_effort } = getAssistantSettings(assistant)

  // 这三个变量透传出来，交给下面动态启用插件/中间件
  // 也可以在外部构建好再传入buildStreamTextParams
  // FIXME: qwen3即使关闭思考仍然会导致enableReasoning的结果为true
  const enableReasoning =
    ((isSupportedThinkingTokenModel(model) || isSupportedReasoningEffortModel(model)) &&
      reasoning_effort !== undefined) ||
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
    maxOutputTokens: maxTokens || DEFAULT_MAX_TOKENS,
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

/**
 * 提取外部工具搜索关键词和问题
 * 从用户消息中提取用于网络搜索和知识库搜索的关键词
 * @deprecated
 */
// export async function extractSearchKeywords(
//   lastUserMessage: Message,
//   assistant: Assistant,
//   options: {
//     shouldWebSearch?: boolean
//     shouldKnowledgeSearch?: boolean
//     lastAnswer?: Message
//   } = {}
// ): Promise<ExtractResults | undefined> {
//   const { shouldWebSearch = false, shouldKnowledgeSearch = false, lastAnswer } = options

//   if (!lastUserMessage) return undefined

//   // 根据配置决定是否需要提取
//   const needWebExtract = shouldWebSearch
//   const needKnowledgeExtract = shouldKnowledgeSearch

//   if (!needWebExtract && !needKnowledgeExtract) return undefined

//   // 选择合适的提示词
//   let prompt: string
//   if (needWebExtract && !needKnowledgeExtract) {
//     prompt = SEARCH_SUMMARY_PROMPT_WEB_ONLY
//   } else if (!needWebExtract && needKnowledgeExtract) {
//     prompt = SEARCH_SUMMARY_PROMPT_KNOWLEDGE_ONLY
//   } else {
//     prompt = SEARCH_SUMMARY_PROMPT
//   }

//   // 构建用于提取的助手配置
//   const summaryAssistant = getDefaultAssistant()
//   summaryAssistant.model = assistant.model || getDefaultModel()
//   summaryAssistant.prompt = prompt

//   try {
//     const result = await fetchSearchSummary({
//       messages: lastAnswer ? [lastAnswer, lastUserMessage] : [lastUserMessage],
//       assistant: summaryAssistant
//     })

//     if (!result) return getFallbackResult()

//     const extracted = extractInfoFromXML(result.getText())
//     // 根据需求过滤结果
//     return {
//       websearch: needWebExtract ? extracted?.websearch : undefined,
//       knowledge: needKnowledgeExtract ? extracted?.knowledge : undefined
//     }
//   } catch (e: any) {
//     console.error('extract error', e)
//     return getFallbackResult()
//   }

//   function getFallbackResult(): ExtractResults {
//     const fallbackContent = getMainTextContent(lastUserMessage)
//     return {
//       websearch: shouldWebSearch ? { question: [fallbackContent || 'search'] } : undefined,
//       knowledge: shouldKnowledgeSearch
//         ? {
//             question: [fallbackContent || 'search'],
//             rewrite: fallbackContent || 'search'
//           }
//         : undefined
//     }
//   }
// }

/**
 * 获取搜索摘要 - 内部辅助函数
 * @deprecated
 */
// async function fetchSearchSummary({ messages, assistant }: { messages: Message[]; assistant: Assistant }) {
//   const model = assistant.model || getDefaultModel()
//   const provider = getProviderByModel(model)

//   if (!hasApiKey(provider)) {
//     return null
//   }

//   const AI = new AiProvider(provider)

//   const params: CompletionsParams = {
//     callType: 'search',
//     messages: messages,
//     assistant,
//     streamOutput: false
//   }

//   return await AI.completions(params)
// }

// function hasApiKey(provider: Provider) {
//   if (!provider) return false
//   if (provider.id === 'ollama' || provider.id === 'lmstudio' || provider.type === 'vertexai') return true
//   return !isEmpty(provider.apiKey)
// }
