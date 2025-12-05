/**
 * 消息转换模块
 * 将 Cherry Studio 消息格式转换为 AI SDK 消息格式
 */

import { loggerService } from '@logger'
import { isImageEnhancementModel, isVisionModel } from '@renderer/config/models'
import type { Message, Model } from '@renderer/types'
import type {
  FileMessageBlock,
  ImageMessageBlock,
  ThinkingMessageBlock,
  ToolMessageBlock
} from '@renderer/types/newMessage'
import {
  findFileBlocks,
  findImageBlocks,
  findThinkingBlocks,
  findToolBlocks,
  getMainTextContent
} from '@renderer/utils/messageUtils/find'
import type {
  AssistantContent,
  FilePart,
  ImagePart,
  ModelMessage,
  SystemModelMessage,
  TextPart,
  ToolCallPart,
  ToolResultPart,
  UserModelMessage
} from 'ai'

import { convertFileBlockToFilePart, convertFileBlockToTextPart } from './fileProcessor'

const logger = loggerService.withContext('messageConverter')

/**
 * 转换消息为 AI SDK 参数格式
 * 基于 OpenAI 格式的通用转换，支持文本、图片和文件
 */
export async function convertMessageToSdkParam(
  message: Message,
  isVisionModel = false,
  model?: Model
): Promise<ModelMessage | ModelMessage[]> {
  const content = getMainTextContent(message)
  const fileBlocks = findFileBlocks(message)
  const imageBlocks = findImageBlocks(message)
  const reasoningBlocks = findThinkingBlocks(message)
  const toolBlocks = findToolBlocks(message)
  if (message.role === 'user' || message.role === 'system') {
    return convertMessageToUserModelMessage(content, fileBlocks, imageBlocks, isVisionModel, model)
  } else {
    return convertMessageToAssistantAndToolMessages(content, fileBlocks, toolBlocks, reasoningBlocks, model)
  }
}

async function convertImageBlockToImagePart(imageBlocks: ImageMessageBlock[]): Promise<Array<ImagePart>> {
  const parts: Array<ImagePart> = []
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
      const isBase64 = imageBlock.url.startsWith('data:')
      if (isBase64) {
        const base64 = imageBlock.url.match(/^data:[^;]*;base64,(.+)$/)![1]
        const mimeMatch = imageBlock.url.match(/^data:([^;]+)/)
        parts.push({
          type: 'image',
          image: base64,
          mediaType: mimeMatch ? mimeMatch[1] : 'image/png'
        })
      } else {
        parts.push({
          type: 'image',
          image: imageBlock.url
        })
      }
    }
  }
  return parts
}

/**
 * 转换为用户模型消息
 */
async function convertMessageToUserModelMessage(
  content: string,
  fileBlocks: FileMessageBlock[],
  imageBlocks: ImageMessageBlock[],
  isVisionModel = false,
  model?: Model
): Promise<UserModelMessage | (UserModelMessage | SystemModelMessage)[]> {
  const parts: Array<TextPart | FilePart | ImagePart> = []
  if (content) {
    parts.push({ type: 'text', text: content })
  }

  // 处理图片（仅在支持视觉的模型中）
  if (isVisionModel) {
    parts.push(...(await convertImageBlockToImagePart(imageBlocks)))
  }
  // 处理文件
  for (const fileBlock of fileBlocks) {
    const file = fileBlock.file
    let processed = false

    // 优先尝试原生文件支持（PDF、图片等）
    if (model) {
      const filePart = await convertFileBlockToFilePart(fileBlock, model)
      if (filePart) {
        // 判断filePart是否为string
        if (typeof filePart.data === 'string' && filePart.data.startsWith('fileid://')) {
          return [
            {
              role: 'system',
              content: filePart.data
            },
            {
              role: 'user',
              content: parts.length > 0 ? parts : ''
            }
          ]
        }
        parts.push(filePart)
        logger.debug(`File ${file.origin_name} processed as native file format`)
        processed = true
      }
    }

    // 如果原生处理失败，回退到文本提取
    if (!processed) {
      const textPart = await convertFileBlockToTextPart(fileBlock)
      if (textPart) {
        parts.push(textPart)
        logger.debug(`File ${file.origin_name} processed as text content`)
      } else {
        logger.warn(`File ${file.origin_name} could not be processed in any format`)
      }
    }
  }

  return {
    role: 'user',
    content: parts
  }
}

function convertToolBlockToToolCallPart(toolBlock: ToolMessageBlock): ToolCallPart {
  return {
    type: 'tool-call',
    toolCallId: toolBlock.toolId,
    toolName: toolBlock.toolName || 'unknown',
    input: toolBlock.arguments || {}
  }
}

function convertToolBlockToToolResultPart(toolBlock: ToolMessageBlock): ToolResultPart {
  const content = toolBlock.content
  let output: ToolResultPart['output']

  if (content === undefined || content === null) {
    output = { type: 'text', value: '' }
  } else if (typeof content === 'string') {
    output = { type: 'text', value: content }
  } else {
    output = { type: 'json', value: JSON.parse(JSON.stringify(content)) }
  }

  return {
    type: 'tool-result',
    toolCallId: toolBlock.toolId,
    toolName: toolBlock.toolName || 'unknown',
    output
  }
}

function hasToolResult(toolBlock: ToolMessageBlock): boolean {
  return toolBlock.content !== undefined && toolBlock.content !== null
}

async function convertMessageToAssistantAndToolMessages(
  content: string,
  fileBlocks: FileMessageBlock[],
  toolBlocks: ToolMessageBlock[],
  thinkingBlocks: ThinkingMessageBlock[],
  model?: Model
): Promise<ModelMessage | ModelMessage[]> {
  const assistantParts: AssistantContent = []

  // 添加文本内容
  if (content) {
    assistantParts.push({ type: 'text', text: content })
  }

  // 添加推理内容
  for (const thinkingBlock of thinkingBlocks) {
    assistantParts.push({ type: 'reasoning', text: thinkingBlock.content })
  }

  // 处理文件
  for (const fileBlock of fileBlocks) {
    // 优先尝试原生文件支持（PDF等）
    if (model) {
      const filePart = await convertFileBlockToFilePart(fileBlock, model)
      if (filePart) {
        assistantParts.push(filePart)
        continue
      }
    }

    // 回退到文本处理
    const textPart = await convertFileBlockToTextPart(fileBlock)
    if (textPart) {
      assistantParts.push(textPart)
    }
  }

  // 如果没有 tool blocks，直接返回 assistant 消息
  if (toolBlocks.length === 0) {
    return {
      role: 'assistant',
      content: assistantParts
    }
  }

  // 处理 tool blocks
  // 将 tool calls 和 tool results 都添加到 assistant 消息的 content 中
  for (const toolBlock of toolBlocks) {
    // 添加 tool call
    assistantParts.push(convertToolBlockToToolCallPart(toolBlock))

    // 如果有结果，添加 tool result
    if (hasToolResult(toolBlock)) {
      assistantParts.push(convertToolBlockToToolResultPart(toolBlock))
    }
  }

  return {
    role: 'assistant',
    content: assistantParts
  }
}

/**
 * Converts an array of messages to SDK-compatible model messages.
 *
 * This function processes messages and transforms them into the format required by the SDK.
 * It handles special cases for vision models and image enhancement models.
 *
 * @param messages - Array of messages to convert. Must contain at least 3 messages when using image enhancement models for special handling.
 * @param model - The model configuration that determines conversion behavior
 *
 * @returns A promise that resolves to an array of SDK-compatible model messages
 *
 * @remarks
 * For image enhancement models with 3+ messages:
 * - Examines the last 2 messages to find an assistant message containing image blocks
 * - If found, extracts images from the assistant message and appends them to the last user message content
 * - Returns all converted messages (not just the last two) with the images merged into the user message
 * - Typical pattern: [system?, assistant(image), user] -> [system?, assistant, user(image)]
 *
 * For other models:
 * - Returns all converted messages in order without special image handling
 *
 * The function automatically detects vision model capabilities and adjusts conversion accordingly.
 */
export async function convertMessagesToSdkMessages(messages: Message[], model: Model): Promise<ModelMessage[]> {
  const sdkMessages: ModelMessage[] = []
  const isVision = isVisionModel(model)

  for (const message of messages) {
    const sdkMessage = await convertMessageToSdkParam(message, isVision, model)
    sdkMessages.push(...(Array.isArray(sdkMessage) ? sdkMessage : [sdkMessage]))
  }
  // Special handling for image enhancement models
  // Only merge images into the user message
  // [system?, assistant(image), user] -> [system?, assistant, user(image)]
  if (isImageEnhancementModel(model) && messages.length >= 3) {
    const needUpdatedMessages = messages.slice(-2)
    const assistantMessage = needUpdatedMessages.find((m) => m.role === 'assistant')
    const userSdkMessage = sdkMessages[sdkMessages.length - 1]

    if (assistantMessage && userSdkMessage?.role === 'user') {
      const imageBlocks = findImageBlocks(assistantMessage)
      const imageParts = await convertImageBlockToImagePart(imageBlocks)

      if (imageParts.length > 0) {
        if (typeof userSdkMessage.content === 'string') {
          userSdkMessage.content = [{ type: 'text', text: userSdkMessage.content }, ...imageParts]
        } else if (Array.isArray(userSdkMessage.content)) {
          userSdkMessage.content.push(...imageParts)
        }
      }
    }
  }

  return sdkMessages
}
