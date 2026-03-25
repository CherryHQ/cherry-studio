/**
 * 消息转换模块
 * 将 Cherry Studio 消息格式转换为 AI SDK 消息格式
 */

import type { ReasoningPart } from '@ai-sdk/provider-utils'
import { loggerService } from '@logger'
import { isVisionModel } from '@renderer/config/models'
import type { Message, Model } from '@renderer/types'
import type {
  FileMessageBlock,
  ImageMessageBlock,
  MainTextMessageBlock,
  ThinkingMessageBlock
} from '@renderer/types/newMessage'
import {
  findFileBlocks,
  findImageBlocks,
  findMainTextBlocks,
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
import i18n from 'i18next'

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
  const mainTextBlocks = findMainTextBlocks(message)
  if (message.role === 'user' || message.role === 'system') {
    return convertMessageToUserModelMessage(content, fileBlocks, imageBlocks, isVisionModel, model)
  } else {
    return convertMessageToAssistantModelMessage(
      content,
      fileBlocks,
      imageBlocks,
      reasoningBlocks,
      mainTextBlocks,
      model
    )
  }
}

async function convertImageBlockToImagePart(imageBlocks: ImageMessageBlock[]): Promise<Array<ImagePart>> {
  const parts: Array<ImagePart> = []
  for (const imageBlock of imageBlocks) {
    if (imageBlock.file) {
      try {
        const ext = imageBlock.file.ext.startsWith('.') ? imageBlock.file.ext : `.${imageBlock.file.ext}`
        const image = await window.api.file.base64Image(imageBlock.file.id + ext)
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
        window.toast.error(i18n.t('message.error.file.process_failed', { name: file.origin_name }))
      }
    }
  }

  return {
    role: 'user',
    content: parts
  }
}

/**
 * Replaces markdown images with data URI sources (e.g. `![alt](data:image/...;base64,...)`)
 * with a placeholder `![alt](image)` to avoid sending huge base64 payloads to the API.
 *
 * Uses string scanning (indexOf) instead of regex to avoid OOM on multi-MB base64 strings.
 */
export function stripMarkdownBase64Images(text: string): string {
  const marker = '](data:'
  let result = ''
  let searchFrom = 0

  while (searchFrom < text.length) {
    const markerIdx = text.indexOf(marker, searchFrom)
    if (markerIdx === -1) {
      result += text.slice(searchFrom)
      break
    }

    // Find the `![` that starts this markdown image — walk backwards from `](`
    const bangIdx = text.lastIndexOf('![', markerIdx)
    if (bangIdx === -1 || text.indexOf(']', bangIdx + 2) !== markerIdx) {
      // Not a valid markdown image — skip past this marker
      result += text.slice(searchFrom, markerIdx + marker.length)
      searchFrom = markerIdx + marker.length
      continue
    }

    // Find the closing `)` — the URL part starts after `](`
    const urlStart = markerIdx + 2 // position right after `](`
    const closeIdx = text.indexOf(')', urlStart)
    if (closeIdx === -1) {
      result += text.slice(searchFrom)
      break
    }

    // Extract alt text between `![` and `]`
    const altText = text.slice(bangIdx + 2, markerIdx)

    // Append everything before `![` plus the replacement
    result += text.slice(searchFrom, bangIdx) + `![${altText}](image)`
    searchFrom = closeIdx + 1
  }

  return result
}

/**
 * 转换为助手模型消息
 * 注意：当助手消息只包含图片（如图片生成模型的响应）而没有文本时，
 * 需要添加占位文本，因为某些 API（如 Gemini）不接受空的 assistant 消息
 */
async function convertMessageToAssistantModelMessage(
  content: string,
  fileBlocks: FileMessageBlock[],
  imageBlocks: ImageMessageBlock[],
  thinkingBlocks: ThinkingMessageBlock[],
  mainTextBlocks: MainTextMessageBlock[],
  model?: Model
): Promise<AssistantModelMessage> {
  const parts: Array<TextPart | ReasoningPart | FilePart> = []

  // Add reasoning blocks first (required by AWS Bedrock for Claude extended thinking)
  for (const thinkingBlock of thinkingBlocks) {
    parts.push({ type: 'reasoning', text: thinkingBlock.content })
  }

  // Add text content after reasoning blocks, only if non-empty after trimming
  // Also add thoughtSignature from MainTextBlock metadata for Gemini thought signature persistence
  // Strip inline base64 data URIs from markdown images to prevent HTTP 413 errors (#12602)
  // Uses string scanning instead of regex to avoid OOM on large base64 payloads
  const trimmedContent = stripMarkdownBase64Images(content?.trim() ?? '')
  if (trimmedContent) {
    // Find the first MainTextBlock with thoughtSignature
    const thoughtSignature = mainTextBlocks.find((block) => block.metadata?.thoughtSignature)?.metadata
      ?.thoughtSignature

    const textPart: TextPart = { type: 'text', text: trimmedContent }

    // Add providerOptions with thoughtSignature if available (for Gemini)
    if (thoughtSignature) {
      textPart.providerOptions = {
        google: {
          thoughtSignature
        }
      }
    }

    parts.push(textPart)
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

  // 当 parts 为空但有图片时，添加占位文本
  // 这对于图片生成模型的继续对话很重要，因为助手消息可能只包含生成的图片
  if (parts.length === 0 && imageBlocks.length > 0) {
    parts.push({ type: 'text', text: '[Image]' })
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
  // Special handling for vison models
  // These models support multi-turn conversations but need images from previous assistant messages
  // to be merged into the current user message for editing/enhancement operations.
  //
  // Key behaviors:
  // 1. Preserve all conversation history for context
  // 2. Find images from the previous assistant message and merge them into the last user message
  // 3. This allows users to switch from LLM conversations and use that context for image generation
  if (isVision) {
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
