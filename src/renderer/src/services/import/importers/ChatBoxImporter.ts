import { loggerService } from '@logger'
import i18n from '@renderer/i18n'
import type { Topic } from '@renderer/types'
import type { SerializedError } from '@renderer/types/error'
import {
  AssistantMessageStatus,
  type ImageMessageBlock,
  type MainTextMessageBlock,
  type Message,
  type MessageBlock,
  MessageBlockStatus,
  MessageBlockType,
  type ToolMessageBlock,
  UserMessageStatus
} from '@renderer/types/newMessage'
import { v4 as uuidv4 } from 'uuid'

import type { ConversationImporter, ImportResult } from '../types'

const logger = loggerService.withContext('ChatBoxImporter')

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function toTimestampMs(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  // Heuristic: timestamps in ms are ~1e12+, seconds are ~1e9+
  if (value >= 1e11) return value
  if (value >= 1e9) return value * 1000
  return null
}

function toSerializedError(value: unknown): SerializedError | undefined {
  if (!isRecord(value)) return undefined

  const name = typeof value.name === 'string' ? value.name : null
  const message = typeof value.message === 'string' ? value.message : null
  const stack = typeof value.stack === 'string' ? value.stack : null

  if (name === null && message === null && stack === null) return undefined

  return {
    ...value,
    name,
    message,
    stack
  } as SerializedError
}

function toToolContent(value: unknown): ToolMessageBlock['content'] | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string') return value
  if (typeof value === 'object') return value as object
  return String(value)
}

interface ChatBoxSessionSummary {
  id: string
  name?: string
  starred?: boolean
  type?: string
}

interface ChatBoxContentPartText {
  type: 'text'
  text?: string
}

interface ChatBoxContentPartImage {
  type: 'image'
  url?: string
}

interface ChatBoxContentPartToolCall {
  type: 'tool-call'
  state?: string
  toolCallId?: string
  toolName?: string
  args?: unknown
  result?: unknown
}

type ChatBoxContentPart = ChatBoxContentPartText | ChatBoxContentPartImage | ChatBoxContentPartToolCall

interface ChatBoxPicture {
  url?: string
}

interface ChatBoxMessage {
  id?: string
  role?: string
  contentParts?: unknown
  content?: unknown
  pictures?: unknown
  timestamp?: unknown
}

interface ChatBoxSession {
  id?: string
  name?: string
  starred?: boolean
  messages?: unknown
}

interface ChatBoxExport {
  __exported_at?: unknown
  'chat-sessions-list'?: unknown
  [key: string]: unknown
}

/**
 * ChatBox conversation importer
 * Handles importing conversations from ChatBox's exported-data.json format
 */
export class ChatBoxImporter implements ConversationImporter {
  readonly name = 'ChatBox'
  readonly emoji = '📦'

  validate(fileContent: string): boolean {
    try {
      const parsed = JSON.parse(fileContent) as ChatBoxExport
      if (!isRecord(parsed)) return false

      const sessionsList = parsed['chat-sessions-list']
      if (!Array.isArray(sessionsList) || sessionsList.length === 0) return false

      for (const item of sessionsList) {
        if (!isRecord(item)) continue
        const id = toNonEmptyString(item.id)
        if (!id) continue

        const session = parsed[`session:${id}`]
        if (!isRecord(session)) continue
        if (Array.isArray((session as ChatBoxSession).messages)) return true
      }

      return false
    } catch {
      return false
    }
  }

  async parse(fileContent: string, assistantId: string): Promise<ImportResult> {
    logger.info('Starting ChatBox import...')

    const parsed = JSON.parse(fileContent) as ChatBoxExport
    if (!isRecord(parsed)) {
      throw new Error(i18n.t('import.chatbox.error.invalid_json'))
    }

    const sessionsListRaw = parsed['chat-sessions-list']
    const sessionsList: ChatBoxSessionSummary[] = Array.isArray(sessionsListRaw)
      ? (sessionsListRaw.filter(isRecord) as unknown as ChatBoxSessionSummary[])
      : []

    if (sessionsList.length === 0) {
      throw new Error(i18n.t('import.chatbox.error.no_conversations'))
    }

    const exportedAtMs =
      (typeof parsed.__exported_at === 'string' && Number.isFinite(Date.parse(parsed.__exported_at))
        ? Date.parse(parsed.__exported_at)
        : null) ?? Date.now()

    logger.info(`Found ${sessionsList.length} sessions`)

    const topics: Topic[] = []
    const allMessages: Message[] = []
    const allBlocks: MessageBlock[] = []

    for (const sessionSummary of sessionsList) {
      const sessionId = toNonEmptyString(sessionSummary.id)
      if (!sessionId) continue

      const sessionRaw = parsed[`session:${sessionId}`]
      if (!isRecord(sessionRaw)) continue

      const session = sessionRaw as ChatBoxSession
      if (!Array.isArray(session.messages)) continue

      try {
        const { topic, messages, blocks } = this.convertSessionToTopic(
          sessionSummary,
          session,
          assistantId,
          exportedAtMs
        )
        if (messages.length === 0) {
          continue
        }
        topics.push(topic)
        allMessages.push(...messages)
        allBlocks.push(...blocks)
      } catch (error) {
        logger.warn(`Failed to convert session "${sessionSummary.name ?? sessionSummary.id}":`, error as Error)
      }
    }

    if (topics.length === 0) {
      throw new Error(i18n.t('import.chatbox.error.no_valid_conversations'))
    }

    return {
      topics,
      messages: allMessages,
      blocks: allBlocks,
      metadata: {
        source: 'chatbox',
        exportedAt: new Date(exportedAtMs).toISOString()
      }
    }
  }

  private convertSessionToTopic(
    sessionSummary: ChatBoxSessionSummary,
    session: ChatBoxSession,
    assistantId: string,
    exportedAtMs: number
  ): { topic: Topic; messages: Message[]; blocks: MessageBlock[] } {
    const topicId = uuidv4()
    const messages: Message[] = []
    const blocks: MessageBlock[] = []

    const rawMessages = (session.messages as unknown[]).filter(isRecord) as unknown as ChatBoxMessage[]

    for (let index = 0; index < rawMessages.length; index++) {
      const chatboxMessage = rawMessages[index]
      const fallbackMs = exportedAtMs + index
      const converted = this.convertMessage(chatboxMessage, topicId, assistantId, fallbackMs)
      if (!converted) continue
      messages.push(converted.message)
      blocks.push(...converted.blocks)
    }

    const topicName =
      toNonEmptyString(session.name) ??
      toNonEmptyString(sessionSummary.name) ??
      i18n.t('import.chatbox.untitled_conversation')

    const createdAt = messages.length > 0 ? messages[0].createdAt : new Date(exportedAtMs).toISOString()
    const updatedAt = messages.length > 0 ? messages[messages.length - 1].createdAt : createdAt

    const topic: Topic = {
      id: topicId,
      assistantId,
      name: topicName,
      createdAt,
      updatedAt,
      messages,
      pinned: !!sessionSummary.starred,
      isNameManuallyEdited: true
    }

    return { topic, messages, blocks }
  }

  private convertMessage(
    chatboxMessage: ChatBoxMessage,
    topicId: string,
    assistantId: string,
    fallbackTimestampMs: number
  ): { message: Message; blocks: MessageBlock[] } | null {
    const role = this.mapRole(chatboxMessage.role)
    if (!role) return null

    const createdAt =
      (toTimestampMs(chatboxMessage.timestamp) !== null
        ? new Date(toTimestampMs(chatboxMessage.timestamp)!).toISOString()
        : null) ?? new Date(fallbackTimestampMs).toISOString()

    const messageId = uuidv4()
    const blocks = this.createBlocksFromMessage(chatboxMessage, messageId, createdAt)

    if (blocks.length === 0) return null

    const message: Message = {
      id: messageId,
      role,
      assistantId,
      topicId,
      createdAt,
      updatedAt: createdAt,
      status: role === 'user' ? UserMessageStatus.SUCCESS : AssistantMessageStatus.SUCCESS,
      blocks: blocks.map((b) => b.id)
    }

    return { message, blocks }
  }

  private mapRole(role: unknown): Message['role'] | null {
    if (role === 'user' || role === 'assistant' || role === 'system') return role
    return null
  }

  private createBlocksFromMessage(
    chatboxMessage: ChatBoxMessage,
    messageId: string,
    createdAt: string
  ): MessageBlock[] {
    const blocks: MessageBlock[] = []
    const usedImageUrls = new Set<string>()

    const flushText = (buffer: string[]) => {
      const content = buffer
        .map((s) => s.trim())
        .filter(Boolean)
        .join('\n\n')
      buffer.length = 0
      if (!content) return

      const block: MainTextMessageBlock = {
        id: uuidv4(),
        messageId,
        type: MessageBlockType.MAIN_TEXT,
        content,
        createdAt,
        updatedAt: createdAt,
        status: MessageBlockStatus.SUCCESS
      }
      blocks.push(block)
    }

    const textBuffer: string[] = []

    const partsRaw = chatboxMessage.contentParts
    const parts: ChatBoxContentPart[] = Array.isArray(partsRaw)
      ? (partsRaw.filter(isRecord) as unknown as ChatBoxContentPart[])
      : []

    for (const part of parts) {
      if (!isRecord(part) || typeof part.type !== 'string') continue

      if (part.type === 'text') {
        const text = toNonEmptyString((part as ChatBoxContentPartText).text)
        if (text) textBuffer.push(text)
        continue
      }

      if (part.type === 'image') {
        flushText(textBuffer)
        const url = toNonEmptyString((part as ChatBoxContentPartImage).url)
        if (!url) continue
        usedImageUrls.add(url)
        const block: ImageMessageBlock = {
          id: uuidv4(),
          messageId,
          type: MessageBlockType.IMAGE,
          url,
          createdAt,
          updatedAt: createdAt,
          status: MessageBlockStatus.SUCCESS
        }
        blocks.push(block)
        continue
      }

      if (part.type === 'tool-call') {
        flushText(textBuffer)
        const toolPart = part as ChatBoxContentPartToolCall

        const toolId = toNonEmptyString(toolPart.toolCallId) ?? uuidv4()
        const toolName = toNonEmptyString(toolPart.toolName)
        const argumentsValue = isRecord(toolPart.args) ? (toolPart.args as Record<string, any>) : undefined
        const content = toToolContent(toolPart.result)
        const isError = toNonEmptyString(toolPart.state) === 'error'

        const block: ToolMessageBlock = {
          id: uuidv4(),
          messageId,
          type: MessageBlockType.TOOL,
          toolId,
          ...(toolName ? { toolName } : {}),
          ...(argumentsValue ? { arguments: argumentsValue } : {}),
          ...(content !== undefined ? { content } : {}),
          createdAt,
          updatedAt: createdAt,
          status: isError ? MessageBlockStatus.ERROR : MessageBlockStatus.SUCCESS,
          ...(isError
            ? {
                error:
                  toSerializedError(isRecord(toolPart.result) ? (toolPart.result as JsonRecord).error : undefined) ??
                  ({
                    name: 'ChatBoxToolCallError',
                    message: 'Tool call failed',
                    stack: null
                  } as SerializedError)
              }
            : {})
        }
        blocks.push(block)
        continue
      }

      textBuffer.push(JSON.stringify(part))
    }

    flushText(textBuffer)

    const mainTextAlreadyPresent = blocks.some((b) => b.type === MessageBlockType.MAIN_TEXT)
    const fallbackContent = toNonEmptyString(chatboxMessage.content)
    if (!mainTextAlreadyPresent && fallbackContent) {
      const block: MainTextMessageBlock = {
        id: uuidv4(),
        messageId,
        type: MessageBlockType.MAIN_TEXT,
        content: fallbackContent,
        createdAt,
        updatedAt: createdAt,
        status: MessageBlockStatus.SUCCESS
      }
      blocks.push(block)
    }

    const picturesRaw = chatboxMessage.pictures
    const pictures: ChatBoxPicture[] = Array.isArray(picturesRaw)
      ? (picturesRaw.filter(isRecord) as unknown as ChatBoxPicture[])
      : []
    for (const picture of pictures) {
      const url = toNonEmptyString(picture.url)
      if (!url || usedImageUrls.has(url)) continue
      usedImageUrls.add(url)
      const block: ImageMessageBlock = {
        id: uuidv4(),
        messageId,
        type: MessageBlockType.IMAGE,
        url,
        createdAt,
        updatedAt: createdAt,
        status: MessageBlockStatus.SUCCESS
      }
      blocks.push(block)
    }

    return blocks
  }
}
