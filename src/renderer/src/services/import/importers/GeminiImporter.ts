import { loggerService } from '@logger'
import i18n from '@renderer/i18n'
import type { Topic } from '@renderer/types'
import {
  AssistantMessageStatus,
  type MainTextMessageBlock,
  type Message,
  MessageBlockStatus,
  MessageBlockType,
  UserMessageStatus
} from '@renderer/types/newMessage'
import { uuid } from '@renderer/utils'

import type { ConversationImporter, ImportResult } from '../types'

const logger = loggerService.withContext('GeminiImporter')

export interface GeminiMessage {
  role: 'user' | 'assistant' | 'thought'
  content: string
  id?: string
}

export interface GeminiConversation {
  id: string
  title: string
  url?: string
  messages: GeminiMessage[]
}

export class GeminiImporter implements ConversationImporter {
  readonly name = 'Gemini'
  readonly emoji = '✨'

  validate(fileContent: string): boolean {
    try {
      const conversations = this.extractConversations(fileContent)
      return conversations.length > 0 && conversations.every((conv) => Array.isArray(conv.messages))
    } catch (error) {
      logger.warn('Gemini validate failed', error as Error)
      return false
    }
  }

  async parse(fileContent: string, assistantId: string): Promise<ImportResult> {
    const conversations = this.extractConversations(fileContent)

    if (conversations.length === 0) {
      throw new Error(i18n.t('import.gemini.error.no_conversations'))
    }

    const topics: Topic[] = []
    const allMessages: Message[] = []
    const allBlocks: MainTextMessageBlock[] = []

    conversations.forEach((conversation) => {
      try {
        const { topic, messages, blocks } = this.convertConversationToTopic(conversation, assistantId)
        topics.push(topic)
        allMessages.push(...messages)
        allBlocks.push(...blocks)
      } catch (error) {
        logger.warn(`Failed to convert Gemini conversation ${conversation.id}`, error as Error)
      }
    })

    if (topics.length === 0) {
      throw new Error(i18n.t('import.gemini.error.no_valid_conversations'))
    }

    return {
      topics,
      messages: allMessages,
      blocks: allBlocks
    }
  }

  private extractConversations(fileContent: string): GeminiConversation[] {
    const parsed = JSON.parse(fileContent)
    const conversations = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { conversations?: GeminiConversation[] })?.conversations)
        ? (parsed as { conversations?: GeminiConversation[] }).conversations || []
        : []

    return conversations
      .filter((conv) => conv && typeof conv === 'object' && Array.isArray((conv as GeminiConversation).messages))
      .map((conv, index) => ({
        id: (conv as GeminiConversation).id || `gemini-${index + 1}`,
        title: (conv as GeminiConversation).title || i18n.t('import.gemini.untitled_conversation'),
        url: (conv as GeminiConversation).url,
        messages: (conv as GeminiConversation).messages || []
      }))
  }

  private convertConversationToTopic(
    conversation: GeminiConversation,
    assistantId: string
  ): { topic: Topic; messages: Message[]; blocks: MainTextMessageBlock[] } {
    const topicId = uuid()
    const messages: Message[] = []
    const blocks: MainTextMessageBlock[] = []

    const createdAt = new Date().toISOString()

    conversation.messages.forEach((msg) => {
      const normalizedContent = (msg.content || '').trim()
      if (!normalizedContent) return

      const messageId = msg.id || uuid()
      const blockId = uuid()
      const isUser = msg.role === 'user'

      const message: Message = {
        id: messageId,
        role: isUser ? 'user' : 'assistant',
        assistantId,
        topicId,
        createdAt,
        updatedAt: createdAt,
        status: isUser ? UserMessageStatus.SUCCESS : AssistantMessageStatus.SUCCESS,
        blocks: [blockId]
      }

      const block: MainTextMessageBlock = {
        id: blockId,
        messageId,
        type: MessageBlockType.MAIN_TEXT,
        content: normalizedContent,
        createdAt,
        updatedAt: createdAt,
        status: MessageBlockStatus.SUCCESS
      }

      messages.push(message)
      blocks.push(block)
    })

    const topic: Topic = {
      id: topicId,
      assistantId,
      name: conversation.title || i18n.t('import.gemini.untitled_conversation'),
      createdAt,
      updatedAt: createdAt,
      messages,
      isNameManuallyEdited: true
    }

    return { topic, messages, blocks }
  }
}
