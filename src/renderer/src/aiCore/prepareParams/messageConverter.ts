/**
 * 消息转换模块
 * 将 Cherry Studio 消息格式转换为 AI SDK 消息格式
 */

import { loggerService } from '@logger'
import { isImageEnhancementModel, isVisionModel } from '@renderer/config/models'
import type { Message, Model } from '@renderer/types'
import type { FileMessageBlock, ImageMessageBlock, ThinkingMessageBlock } from '@renderer/types/newMessage'
import { parseDataUrlMediaType } from '@renderer/utils/image'
import {
  findFileBlocks,
  findImageBlocks,
  findThinkingBlocks,
  getMainTextContent
} from '@renderer/utils/messageUtils/find'
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
        logger.warn('Failed to load image:', error as Error)
      }
    } else if (imageBlock.url) {
      const url = imageBlock.url
      const isDataUrl = url.startsWith('data:')
      if (isDataUrl) {
        const { mediaType } = parseDataUrlMediaType(url)
        parts.push({ type: 'image', image: url, ...(mediaType ? { mediaType } : {}) })
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
 * - Typical pattern: [system?, assistant(image), user] -> [system?, user(image)]
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
  // Target behavior: Collapse the conversation into [system?, user(image)].
  // Explanation of why we don't simply use slice:
  // 1) We need to preserve all system messages: During the convertMessageToSdkParam process, native file uploads may insert `system(fileid://...)`.
  // Directly slicing the original messages or already converted sdkMessages could easily result in missing these system instructions.
  // Therefore, we first perform a full conversion and then aggregate the system messages afterward.
  // 2) The conversion process may split messages: A single user message might be broken into two SDK messages—[system, user].
  // Slicing either side could lead to obtaining semantically incorrect fragments (e.g., only the split-out system message).
  // 3) The “previous assistant message” is not necessarily the second-to-last one: There might be system messages or other message blocks inserted in between,
  // making a simple slice(-2) assumption too rigid. Here, we trace back from the end of the original messages to locate the most recent assistant message, which better aligns with business semantics.
  // 4) This is a “collapse” rather than a simple “slice”: Ultimately, we need to synthesize a new user message
  // (with text from the last user message and images from the previous assistant message). Using slice can only extract subarrays,
  // which still require reassembly; constructing directly according to the target structure is clearer and more reliable.
  if (isImageEnhancementModel(model)) {
    // Collect all system messages (including ones generated from file uploads)
    const systemMessages = sdkMessages.filter((m): m is SystemModelMessage => m.role === 'system')

    // Find the last user message (SDK converted)
    const lastUserSdkIndex = (() => {
      for (let i = sdkMessages.length - 1; i >= 0; i--) {
        if (sdkMessages[i].role === 'user') return i
      }
      return -1
    })()

    const lastUserSdk = lastUserSdkIndex >= 0 ? (sdkMessages[lastUserSdkIndex] as UserModelMessage) : null

    // Find the nearest preceding assistant message in original messages
    let prevAssistant: Message | null = null
    for (let i = messages.length - 2; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        prevAssistant = messages[i]
        break
      }
    }

    // Build the final user content parts
    let finalUserParts: Array<TextPart | FilePart | ImagePart> = []
    if (lastUserSdk) {
      if (typeof lastUserSdk.content === 'string') {
        finalUserParts.push({ type: 'text', text: lastUserSdk.content })
      } else if (Array.isArray(lastUserSdk.content)) {
        finalUserParts = [...lastUserSdk.content]
      }
    }

    // Append images from the previous assistant message if any
    if (prevAssistant) {
      const imageBlocks = findImageBlocks(prevAssistant)
      const imageParts = await convertImageBlockToImagePart(imageBlocks)
      if (imageParts.length > 0) {
        finalUserParts.push(...imageParts)
      }
    }

    // If we couldn't find a last user message, fall back to returning collected system messages only
    if (!lastUserSdk) {
      return systemMessages
    }

    return [...systemMessages, { role: 'user', content: finalUserParts }]
  }

  return sdkMessages
}
