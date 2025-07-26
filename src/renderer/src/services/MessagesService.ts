import { loggerService } from '@logger'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { DEFAULT_CONTEXTCOUNT, MAX_CONTEXT_COUNT, UNLIMITED_CONTEXT_COUNT } from '@renderer/config/constant'
import { getTopicById } from '@renderer/hooks/useTopic'
import i18n from '@renderer/i18n'
import { fetchMessagesSummary } from '@renderer/services/ApiService'
import store from '@renderer/store'
import { messageBlocksSelectors, removeManyBlocks } from '@renderer/store/messageBlock'
import { selectMessagesForTopic } from '@renderer/store/newMessage'
import type { Assistant, FileMetadata, Model, Topic, Usage } from '@renderer/types'
import { FileTypes } from '@renderer/types'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import { AssistantMessageStatus, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { uuid } from '@renderer/utils'
import { getTitleFromString } from '@renderer/utils/export'
import {
  createAssistantMessage,
  createFileBlock,
  createImageBlock,
  createMainTextBlock,
  createMessage,
  resetMessage
} from '@renderer/utils/messageUtils/create'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import dayjs from 'dayjs'
import { t } from 'i18next'
import { takeRight } from 'lodash'
import { NavigateFunction } from 'react-router'

import { getAssistantById, getAssistantProvider, getDefaultModel } from './AssistantService'
import { EVENT_NAMES, EventEmitter } from './EventService'
import FileManager from './FileManager'

const logger = loggerService.withContext('MessagesService')

export {
  filterContextMessages,
  filterEmptyMessages,
  filterMessages,
  filterUsefulMessages,
  filterUserRoleStartMessages,
  getGroupedMessages
} from '@renderer/utils/messageUtils/filters'

export function getContextCount(assistant: Assistant, messages: Message[]) {
  const rawContextCount = assistant?.settings?.contextCount ?? DEFAULT_CONTEXTCOUNT
  const maxContextCount = rawContextCount === MAX_CONTEXT_COUNT ? UNLIMITED_CONTEXT_COUNT : rawContextCount

  const _messages = takeRight(messages, maxContextCount)

  const clearIndex = _messages.findLastIndex((message) => message.type === 'clear')

  let currentContextCount = 0
  if (clearIndex === -1) {
    currentContextCount = _messages.length
  } else {
    currentContextCount = _messages.length - (clearIndex + 1)
  }

  return {
    current: currentContextCount,
    max: rawContextCount
  }
}

export function deleteMessageFiles(message: Message) {
  const state = store.getState()
  message.blocks?.forEach((blockId) => {
    const block = messageBlocksSelectors.selectById(state, blockId)
    if (block && (block.type === MessageBlockType.IMAGE || block.type === MessageBlockType.FILE)) {
      const fileData = (block as any).file as FileMetadata | undefined
      if (fileData) {
        FileManager.deleteFiles([fileData])
      }
    }
  })
}

export function isGenerating() {
  return new Promise((resolve, reject) => {
    const generating = store.getState().runtime.generating
    generating && window.message.warning({ content: i18n.t('message.switch.disabled'), key: 'switch-assistant' })
    generating ? reject(false) : resolve(true)
  })
}

export async function locateToMessage(navigate: NavigateFunction, message: Message) {
  await isGenerating()

  SearchPopup.hide()
  const assistant = getAssistantById(message.assistantId)
  const topic = await getTopicById(message.topicId)

  navigate('/', { state: { assistant, topic } })

  setTimeout(() => EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR), 0)
  setTimeout(() => EventEmitter.emit(EVENT_NAMES.LOCATE_MESSAGE + ':' + message.id), 300)
}

/**
 * Creates a user message object and associated blocks based on input.
 * This is a pure function and does not dispatch to the store.
 *
 * @param params - The parameters for creating the message.
 * @returns An object containing the created message and its blocks.
 */
export function getUserMessage({
  assistant,
  topic,
  type,
  content,
  files,
  // Keep other potential params if needed by createMessage
  mentions,
  usage
}: {
  assistant: Assistant
  topic: Topic
  type?: Message['type']
  content?: string
  files?: FileMetadata[]
  knowledgeBaseIds?: string[]
  mentions?: Model[]
  usage?: Usage
}): { message: Message; blocks: MessageBlock[] } {
  const defaultModel = getDefaultModel()
  const model = assistant.model || defaultModel
  const messageId = uuid() // Generate ID here
  const blocks: MessageBlock[] = []
  const blockIds: string[] = []

  // 内容为空也应该创建空文本块
  if (content !== undefined) {
    // Pass messageId when creating blocks
    const textBlock = createMainTextBlock(messageId, content, {
      status: MessageBlockStatus.SUCCESS
    })
    blocks.push(textBlock)
    blockIds.push(textBlock.id)
  }
  if (files?.length) {
    files.forEach((file) => {
      if (file.type === FileTypes.IMAGE) {
        const imgBlock = createImageBlock(messageId, { file, status: MessageBlockStatus.SUCCESS })
        blocks.push(imgBlock)
        blockIds.push(imgBlock.id)
      } else {
        const fileBlock = createFileBlock(messageId, file, { status: MessageBlockStatus.SUCCESS })
        blocks.push(fileBlock)
        blockIds.push(fileBlock.id)
      }
    })
  }

  // 直接在createMessage中传入id
  const message = createMessage(
    'user',
    topic.id, // topic.id已经是string类型
    assistant.id,
    {
      id: messageId, // 直接传入ID，避免冲突
      modelId: model?.id,
      model: model,
      blocks: blockIds,
      // 移除knowledgeBaseIds
      mentions,
      // 移除mcp
      type,
      usage
    }
  )

  // 不再需要手动合并ID
  return { message, blocks }
}

export function getAssistantMessage({ assistant, topic }: { assistant: Assistant; topic: Topic }): Message {
  const defaultModel = getDefaultModel()
  const model = assistant.model || defaultModel

  return createAssistantMessage(assistant.id, topic.id, {
    modelId: model?.id,
    model: model
  })
}

export function getMessageModelId(message: Message) {
  return message?.model?.id || message.modelId
}

export function resetAssistantMessage(message: Message, model?: Model): Message {
  const blockIdsToRemove = message.blocks
  if (blockIdsToRemove.length > 0) {
    store.dispatch(removeManyBlocks(blockIdsToRemove))
  }

  return {
    ...message,
    model: model || message.model,
    modelId: model?.id || message.modelId,
    status: AssistantMessageStatus.PENDING,
    useful: undefined,
    askId: undefined,
    mentions: undefined,
    blocks: [],
    createdAt: new Date().toISOString()
  }
}

export async function getMessageTitle(message: Message, length = 30): Promise<string> {
  const content = getMainTextContent(message)

  if ((store.getState().settings as any).useTopicNamingForMessageTitle) {
    try {
      window.message.loading({
        content: t('chat.topics.export.wait_for_title_naming'),
        key: 'message-title-naming',
        duration: 0
      })

      const tempMessage = resetMessage(message, {
        status: AssistantMessageStatus.SUCCESS,
        blocks: message.blocks
      })

      const title = await fetchMessagesSummary({ messages: [tempMessage], assistant: {} as Assistant })

      // store.dispatch(messageBlocksActions.upsertOneBlock(tempTextBlock))

      // store.dispatch(messageBlocksActions.removeOneBlock(tempTextBlock.id))
      window.message.destroy('message-title-naming')
      if (title) {
        window.message.success({ content: t('chat.topics.export.title_naming_success'), key: 'message-title-naming' })
        return title
      }
    } catch (e) {
      window.message.error({ content: t('chat.topics.export.title_naming_failed'), key: 'message-title-naming' })
      logger.error('Failed to generate title using topic naming, downgraded to default logic', e as Error)
    }
  }

  let title = getTitleFromString(content, length)

  if (!title) {
    title = dayjs(message.createdAt).format('YYYYMMDDHHmm')
  }

  return title
}

export function checkRateLimit(assistant: Assistant): boolean {
  const provider = getAssistantProvider(assistant)

  if (!provider?.rateLimit) {
    return false
  }

  const topicId = assistant.topics[0].id
  const messages = selectMessagesForTopic(store.getState(), topicId)

  if (!messages || messages.length <= 1) {
    return false
  }

  const now = Date.now()
  const lastMessage = messages[messages.length - 1]
  const lastMessageTime = new Date(lastMessage.createdAt).getTime()
  const timeDiff = now - lastMessageTime
  const rateLimitMs = provider.rateLimit * 1000

  if (timeDiff < rateLimitMs) {
    const waitTimeSeconds = Math.ceil((rateLimitMs - timeDiff) / 1000)

    window.message.warning({
      content: t('message.warning.rate.limit', { seconds: waitTimeSeconds }),
      duration: 5,
      key: 'rate-limit-message'
    })
    return true
  }

  return false
}
