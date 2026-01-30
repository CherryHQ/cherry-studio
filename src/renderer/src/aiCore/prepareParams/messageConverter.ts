/**
 * 消息转换模块
 * 将 Cherry Studio 消息格式转换为 AI SDK 消息格式
 */

import type { ReasoningPart } from '@ai-sdk/provider-utils'
import { loggerService } from '@logger'
import { isImageEnhancementModel, isVisionModel } from '@renderer/config/models'
import type { Message, Model } from '@renderer/types'
import type { FileMessageBlock, ImageMessageBlock, ThinkingMessageBlock } from '@renderer/types/newMessage'
import {
  findFileBlocks,
  findImageBlocks,
  findThinkingBlocks,
  getMainTextContent
} from '@renderer/utils/messageUtils/find'
import { parseDataUrl } from '@shared/utils'
import type {
  AssistantModelMessage,
  FilePart,
  ImagePart,
  ModelMessage,
  SystemModelMessage,
  TextPart,
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
  if (message.role === 'user' || message.role === 'system') {
    return convertMessageToUserModelMessage(content, fileBlocks, imageBlocks, isVisionModel, model)
  } else {
    return convertMessageToAssistantModelMessage(content, fileBlocks, reasoningBlocks, model)
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
        logger.error('Failed to load image file, image will be excluded from message:', {
          fileId: imageBlock.file.id,
          fileName: imageBlock.file.origin_name,
          error: error as Error
        })
      }
    } else if (imageBlock.url) {
      const url = imageBlock.url
      const parseResult = parseDataUrl(url)
      if (parseResult?.isBase64) {
        const { mediaType, data } = parseResult
        parts.push({ type: 'image', image: data, ...(mediaType ? { mediaType } : {}) })
      } else if (url.startsWith('data:')) {
        // Malformed data URL or non-base64 data URL
        logger.error('Malformed or non-base64 data URL detected, image will be excluded:', {
          urlPrefix: url.slice(0, 50) + '...'
        })
        continue
      } else {
        // For remote URLs we keep payload minimal to match existing expectations.
        parts.push({ type: 'image', image: url })
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

/**
 * 转换为助手模型消息
 */
async function convertMessageToAssistantModelMessage(
  content: string,
  fileBlocks: FileMessageBlock[],
  thinkingBlocks: ThinkingMessageBlock[],
  model?: Model
): Promise<AssistantModelMessage> {
  const parts: Array<TextPart | ReasoningPart | FilePart> = []
  if (content) {
    parts.push({ type: 'text', text: content })
  }

  for (const thinkingBlock of thinkingBlocks) {
    parts.push({ type: 'reasoning', text: thinkingBlock.content })
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

/**
 * Converts an array of messages to SDK-compatible model messages.
 *
 * This function processes messages and transforms them into the format required by the SDK.
 * It handles special cases for vision models and image enhancement models.
 *
 * @param messages - Array of messages to convert.
 * @param model - The model configuration that determines conversion behavior
 *
 * @returns A promise that resolves to an array of SDK-compatible model messages
 *
 * @remarks
 * For image enhancement models:
 * - Collapses the conversation into [system?, user(image)] format
 * - Searches backwards through all messages to find the most recent assistant message with images
 * - Preserves all system messages (including ones generated from file uploads like 'fileid://...')
 * - Extracts the last user message content and merges images from the previous assistant message
 * - Returns only the collapsed messages: system messages (if any) followed by a single user message
 * - If no user message is found, returns only system messages
 * - Typical pattern: [system?, user, assistant(image), user] -> [system?, user(image)]
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
  // These models support multi-turn conversations but need images from previous assistant messages
  // to be merged into the current user message for editing/enhancement operations.
  //
  // Key behaviors:
  // 1. Preserve all conversation history for context
  // 2. Find images from the previous assistant message and merge them into the last user message
  // 3. This allows users to switch from LLM conversations and use that context for image generation
  if (isImageEnhancementModel(model)) {
    // Find the last user SDK message index
    const lastUserSdkIndex = (() => {
      for (let i = sdkMessages.length - 1; i >= 0; i--) {
        if (sdkMessages[i].role === 'user') return i
      }
      return -1
    })()

    // If no user message found, return messages as-is
    if (lastUserSdkIndex < 0) {
      return sdkMessages
    }

    // Find the nearest preceding assistant message in original messages
    let prevAssistant: Message | null = null
    for (let i = messages.length - 2; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        prevAssistant = messages[i]
        break
      }
    }

    // Check if there are images from the previous assistant message
    const imageBlocks = prevAssistant ? findImageBlocks(prevAssistant) : []
    const imageParts = await convertImageBlockToImagePart(imageBlocks)

    // If no images to merge, return messages as-is
    if (imageParts.length === 0) {
      return sdkMessages
    }

    // Build the new last user message with merged images
    const lastUserSdk = sdkMessages[lastUserSdkIndex] as UserModelMessage
    let finalUserParts: Array<TextPart | FilePart | ImagePart> = []

    if (typeof lastUserSdk.content === 'string') {
      finalUserParts.push({ type: 'text', text: lastUserSdk.content })
    } else if (Array.isArray(lastUserSdk.content)) {
      finalUserParts = [...lastUserSdk.content]
    }

    // Append images from the previous assistant message
    finalUserParts.push(...imageParts)

    // Replace the last user message with the merged version
    const result = [...sdkMessages]
    result[lastUserSdkIndex] = { role: 'user', content: finalUserParts }

    return result
  }

  return sdkMessages
}
