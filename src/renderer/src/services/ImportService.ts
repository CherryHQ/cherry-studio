import { loggerService } from '@logger'
import db from '@renderer/databases'
import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { addAssistant } from '@renderer/store/assistants'
import type { Assistant, Topic } from '@renderer/types'
import {
  AssistantMessageStatus,
  type MainTextMessageBlock,
  type Message,
  MessageBlockStatus,
  MessageBlockType,
  UserMessageStatus
} from '@renderer/types/newMessage'
import { uuid } from '@renderer/utils'

import { DEFAULT_ASSISTANT_SETTINGS } from './AssistantService'

const logger = loggerService.withContext('ImportService')

/**
 * ChatGPT Export Format Types
 */
interface ChatGPTMessage {
  id: string
  author: {
    role: 'user' | 'assistant' | 'system' | 'tool'
  }
  content: {
    content_type: string
    parts?: string[]
  }
  metadata?: any
  create_time?: number
}

interface ChatGPTNode {
  id: string
  message?: ChatGPTMessage
  parent?: string
  children?: string[]
}

interface ChatGPTConversation {
  title: string
  create_time: number
  update_time: number
  mapping: Record<string, ChatGPTNode>
  current_node?: string
}

/**
 * Extract main conversation thread from ChatGPT's tree structure
 * Traces back from current_node to root to get the main conversation path
 */
function extractMainThread(mapping: Record<string, ChatGPTNode>, currentNode?: string): ChatGPTMessage[] {
  const messages: ChatGPTMessage[] = []
  const nodeIds: string[] = []

  // Start from current_node or find the last node
  let nodeId = currentNode
  if (!nodeId) {
    // Find node with no children (leaf node)
    const leafNodes = Object.entries(mapping).filter(([, node]) => !node.children || node.children.length === 0)
    if (leafNodes.length > 0) {
      nodeId = leafNodes[0][0]
    }
  }

  // Trace back to root
  while (nodeId) {
    const node = mapping[nodeId]
    if (!node) break

    nodeIds.unshift(nodeId)
    nodeId = node.parent
  }

  // Extract messages from the path
  for (const id of nodeIds) {
    const node = mapping[id]
    if (node?.message) {
      const message = node.message
      // Filter out empty messages and tool messages
      if (
        message.author.role !== 'tool' &&
        message.content?.parts &&
        message.content.parts.length > 0 &&
        message.content.parts.some((part) => part && part.trim().length > 0)
      ) {
        messages.push(message)
      }
    }
  }

  return messages
}

/**
 * Map ChatGPT role to Cherry Studio role
 */
function mapRole(chatgptRole: string): 'user' | 'assistant' | 'system' {
  if (chatgptRole === 'user') return 'user'
  if (chatgptRole === 'assistant') return 'assistant'
  return 'system'
}

/**
 * Create Message and MessageBlock from ChatGPT message
 */
function createMessageAndBlock(
  chatgptMessage: ChatGPTMessage,
  topicId: string,
  assistantId: string
): { message: Message; block: MainTextMessageBlock } {
  const messageId = uuid()
  const blockId = uuid()
  const role = mapRole(chatgptMessage.author.role)

  // Extract text content from parts
  const content = (chatgptMessage.content?.parts || []).filter((part) => part && part.trim()).join('\n\n')

  const createdAt = chatgptMessage.create_time
    ? new Date(chatgptMessage.create_time * 1000).toISOString()
    : new Date().toISOString()

  // Create message
  const message: Message = {
    id: messageId,
    role,
    assistantId,
    topicId,
    createdAt,
    updatedAt: createdAt,
    status: role === 'user' ? UserMessageStatus.SUCCESS : AssistantMessageStatus.SUCCESS,
    blocks: [blockId]
  }

  // Create block
  const block: MainTextMessageBlock = {
    id: blockId,
    messageId,
    type: MessageBlockType.MAIN_TEXT,
    content,
    createdAt,
    updatedAt: createdAt,
    status: MessageBlockStatus.SUCCESS
  }

  return { message, block }
}

/**
 * Convert ChatGPT conversation to Cherry Studio Topic
 */
function convertConversationToTopic(
  conversation: ChatGPTConversation,
  assistantId: string
): { topic: Topic; messages: Message[]; blocks: MainTextMessageBlock[] } {
  const topicId = uuid()
  const messages: Message[] = []
  const blocks: MainTextMessageBlock[] = []

  // Extract main thread messages
  const chatgptMessages = extractMainThread(conversation.mapping, conversation.current_node)

  // Convert each message
  for (const chatgptMessage of chatgptMessages) {
    const { message, block } = createMessageAndBlock(chatgptMessage, topicId, assistantId)
    messages.push(message)
    blocks.push(block)
  }

  // Create topic
  const topic: Topic = {
    id: topicId,
    assistantId,
    name: conversation.title || i18n.t('import.chatgpt.untitled_conversation'),
    createdAt: new Date(conversation.create_time * 1000).toISOString(),
    updatedAt: new Date(conversation.update_time * 1000).toISOString(),
    messages,
    isNameManuallyEdited: true
  }

  return { topic, messages, blocks }
}

/**
 * Import ChatGPT conversations from conversations.json file
 */
export async function importChatGPTConversations(fileContent: string): Promise<{
  success: boolean
  assistant?: Assistant
  topicsCount: number
  messagesCount: number
  error?: string
}> {
  try {
    logger.info('Starting ChatGPT import...')

    // Parse JSON
    let conversations: ChatGPTConversation[]
    try {
      const parsed = JSON.parse(fileContent)
      // Handle both array and single object formats
      conversations = Array.isArray(parsed) ? parsed : [parsed]
    } catch (parseError) {
      logger.error('Failed to parse ChatGPT JSON:', parseError as Error)
      return {
        success: false,
        topicsCount: 0,
        messagesCount: 0,
        error: i18n.t('import.chatgpt.error.invalid_json')
      }
    }

    if (!conversations || conversations.length === 0) {
      logger.warn('No conversations found in file')
      return {
        success: false,
        topicsCount: 0,
        messagesCount: 0,
        error: i18n.t('import.chatgpt.error.no_conversations')
      }
    }

    logger.info(`Found ${conversations.length} conversations`)

    // Create new assistant for imported ChatGPT conversations
    const assistantId = uuid()
    const topics: Topic[] = []
    const allMessages: Message[] = []
    const allBlocks: MainTextMessageBlock[] = []

    // Convert each conversation
    for (const conversation of conversations) {
      try {
        const { topic, messages, blocks } = convertConversationToTopic(conversation, assistantId)
        topics.push(topic)
        allMessages.push(...messages)
        allBlocks.push(...blocks)
      } catch (convError) {
        logger.warn(`Failed to convert conversation "${conversation.title}":`, convError as Error)
        // Continue with other conversations
      }
    }

    if (topics.length === 0) {
      logger.error('No valid topics created from conversations')
      return {
        success: false,
        topicsCount: 0,
        messagesCount: 0,
        error: i18n.t('import.chatgpt.error.no_valid_conversations')
      }
    }

    // Create assistant
    const assistant: Assistant = {
      id: assistantId,
      name: i18n.t('import.chatgpt.assistant_name'),
      emoji: '💬',
      prompt: '',
      topics,
      messages: [],
      type: 'assistant',
      settings: DEFAULT_ASSISTANT_SETTINGS
    }

    // Save to database in transaction
    await db.transaction('rw', db.topics, db.message_blocks, async () => {
      // Save all message blocks
      if (allBlocks.length > 0) {
        await db.message_blocks.bulkAdd(allBlocks)
        logger.info(`Saved ${allBlocks.length} message blocks`)
      }

      // Save all topics with messages
      for (const topic of topics) {
        const topicMessages = allMessages.filter((m) => m.topicId === topic.id)
        await db.topics.add({
          id: topic.id,
          messages: topicMessages
        })
      }
      logger.info(`Saved ${topics.length} topics`)
    })

    // Add assistant to store
    store.dispatch(addAssistant(assistant))

    logger.info(`ChatGPT import completed: ${topics.length} conversations, ${allMessages.length} messages imported`)

    return {
      success: true,
      assistant,
      topicsCount: topics.length,
      messagesCount: allMessages.length
    }
  } catch (error) {
    logger.error('ChatGPT import failed:', error as Error)
    return {
      success: false,
      topicsCount: 0,
      messagesCount: 0,
      error: error instanceof Error ? error.message : i18n.t('import.chatgpt.error.unknown')
    }
  }
}
