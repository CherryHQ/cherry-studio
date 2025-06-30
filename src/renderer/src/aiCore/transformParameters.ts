/**
 * AI SDK 参数转换模块
 * 统一管理从各个 apiClient 提取的参数处理和转换功能
 */

import { type CoreMessage, type StreamTextParams } from '@cherrystudio/ai-core'
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
  isWebSearchModel
} from '@renderer/config/models'
import { getAssistantSettings, getDefaultModel } from '@renderer/services/AssistantService'
import type { Assistant, MCPTool, Message, Model } from '@renderer/types'
import { FileTypes } from '@renderer/types'
import { findFileBlocks, findImageBlocks, getMainTextContent } from '@renderer/utils/messageUtils/find'
import { buildSystemPrompt } from '@renderer/utils/prompt'
import { defaultTimeout } from '@shared/config/constant'

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
 * 构建系统提示词
 */
export async function buildSystemPromptWithTools(
  prompt: string,
  mcpTools?: MCPTool[],
  assistant?: Assistant
): Promise<string> {
  return await buildSystemPrompt(prompt, mcpTools, assistant)
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
export async function convertMessageToSdkParam(message: Message, isVisionModel = false): Promise<any> {
  const content = getMainTextContent(message)
  const fileBlocks = findFileBlocks(message)
  const imageBlocks = findImageBlocks(message)

  // 简单消息（无文件无图片）
  if (fileBlocks.length === 0 && imageBlocks.length === 0) {
    return {
      role: message.role === 'system' ? 'user' : message.role,
      content
    }
  }

  // 复杂消息（包含文件或图片）
  const parts: any[] = []

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
            type: 'image_url',
            image_url: { url: image.data }
          })
        } catch (error) {
          console.warn('Failed to load image:', error)
        }
      } else if (imageBlock.url && imageBlock.url.startsWith('data:')) {
        parts.push({
          type: 'image_url',
          image_url: { url: imageBlock.url }
        })
      }
    }
  }

  // 处理文件
  for (const fileBlock of fileBlocks) {
    const file = fileBlock.file
    if (!file) continue

    if ([FileTypes.TEXT, FileTypes.DOCUMENT].includes(file.type)) {
      try {
        const fileContent = await window.api.file.read(file.id + file.ext)
        parts.push({
          type: 'text',
          text: `${file.origin_name}\n${fileContent.trim()}`
        })
      } catch (error) {
        console.warn('Failed to read file:', error)
      }
    }
  }

  return {
    role: message.role === 'system' ? 'user' : message.role,
    content: parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts
  }
}

/**
 * 转换 Cherry Studio 消息数组为 AI SDK 消息数组
 */
export async function convertMessagesToSdkMessages(
  messages: Message[],
  model: Model
): Promise<StreamTextParams['messages']> {
  const sdkMessages: StreamTextParams['messages'] = []
  const isVision = model.id.includes('vision') || model.id.includes('gpt-4') // 简单的视觉模型检测

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
  options: {
    mcpTools?: MCPTool[]
    enableTools?: boolean
    requestOptions?: {
      signal?: AbortSignal
      timeout?: number
      headers?: Record<string, string>
    }
  } = {}
): Promise<{
  params: StreamTextParams
  modelId: string
  capabilities: { enableReasoning?: boolean; enableWebSearch?: boolean; enableGenerateImage?: boolean }
}> {
  const { mcpTools, enableTools } = options

  const model = assistant.model || getDefaultModel()

  const { maxTokens, reasoning_effort } = getAssistantSettings(assistant)

  // 这三个变量透传出来，交给下面动态启用插件/中间件
  // 也可以在外部构建好再传入buildStreamTextParams
  const enableReasoning =
    ((isSupportedThinkingTokenModel(model) || isSupportedReasoningEffortModel(model)) &&
      reasoning_effort !== undefined) ||
    (isReasoningModel(model) && !isSupportedThinkingTokenModel(model) && !isSupportedReasoningEffortModel(model))
  const enableWebSearch =
    (assistant.enableWebSearch && isWebSearchModel(model)) ||
    isOpenRouterBuiltInWebSearchModel(model) ||
    model.id.includes('sonar') ||
    false

  const enableGenerateImage =
    isGenerateImageModel(model) &&
    (isSupportedDisableGenerationModel(model) ? assistant.enableGenerateImage || false : true)

  // 构建系统提示
  const { tools } = setupToolsConfig({
    mcpTools,
    model,
    enableToolUse: enableTools
  })

  // 构建真正的 providerOptions
  const providerOptions = buildProviderOptions(assistant, model, {
    enableReasoning,
    enableWebSearch,
    enableGenerateImage
  })

  // 构建基础参数
  const params: StreamTextParams = {
    messages: sdkMessages,
    maxTokens: maxTokens || DEFAULT_MAX_TOKENS,
    temperature: getTemperature(assistant, model),
    topP: getTopP(assistant, model),
    system: assistant.prompt || '',
    abortSignal: options.requestOptions?.signal,
    headers: options.requestOptions?.headers,
    providerOptions,
    tools,
    maxSteps: 10
  }

  return { params, modelId: model.id, capabilities: { enableReasoning, enableWebSearch, enableGenerateImage } }
}

/**
 * 构建非流式的 generateText 参数
 */
export async function buildGenerateTextParams(
  messages: CoreMessage[],
  assistant: Assistant,
  options: {
    mcpTools?: MCPTool[]
    enableTools?: boolean
  } = {}
): Promise<any> {
  // 复用流式参数的构建逻辑
  return await buildStreamTextParams(messages, assistant, options)
}
