import { loggerService } from '@logger'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { DEFAULT_CONTEXTCOUNT, MAX_CONTEXT_COUNT, UNLIMITED_CONTEXT_COUNT } from '@renderer/config/constant'
import { modelGenerating } from '@renderer/hooks/useModel'
import { getTopicById } from '@renderer/hooks/useTopic'
import { fetchMessagesSummary } from '@renderer/services/ApiService'
import store from '@renderer/store'
import { selectMessagesForTopic } from '@renderer/store/newMessage'
import type { Assistant, FileMetadata } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { AssistantMessageStatus } from '@renderer/types/newMessage'
import { getTitleFromString } from '@renderer/utils/export'
import { resetMessage } from '@renderer/utils/messageUtils/create'
import { filterContextMessages } from '@renderer/utils/messageUtils/filters'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import type { UseNavigateResult } from '@tanstack/react-router'
import dayjs from 'dayjs'
import { t } from 'i18next'

import { getAssistantById, getAssistantProvider } from './AssistantService'
import { EVENT_NAMES, EventEmitter } from './EventService'
import FileManager from './FileManager'

const logger = loggerService.withContext('MessagesService')

export { getGroupedMessages } from '@renderer/utils/messageUtils/filters'

export function getContextCount(assistant: Assistant, messages: Message[]) {
  const settingContextCount = assistant?.settings?.contextCount ?? DEFAULT_CONTEXTCOUNT
  const actualContextCount = settingContextCount === MAX_CONTEXT_COUNT ? UNLIMITED_CONTEXT_COUNT : settingContextCount

  const contextMsgs = filterContextMessages(messages, actualContextCount)

  return {
    current: contextMsgs.length,
    max: settingContextCount
  }
}

/** @deprecated Use safeDeleteFiles instead */
// 删除列表中的文件
export async function safeDeleteFiles(filesToDelete: FileMetadata[]): Promise<void> {
  if (!filesToDelete || filesToDelete.length === 0) return

  try {
    await FileManager.deleteFiles(filesToDelete)
  } catch (error) {
    logger.error('Failed to delete files, may produce orphan files:', error as Error)
  }
}

export async function locateToMessage(navigate: UseNavigateResult<string>, message: Message) {
  await modelGenerating()

  SearchPopup.hide()
  const assistant = getAssistantById(message.assistantId)
  const topic = await getTopicById(message.topicId)

  void navigate({ to: '/app/chat', search: { assistantId: assistant?.id, topicId: topic?.id } })

  setTimeout(() => EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR), 0)
  setTimeout(() => EventEmitter.emit(EVENT_NAMES.LOCATE_MESSAGE + ':' + message.id), 300)
}

export function getMessageModelId(message: Message) {
  return message?.model?.id || message.modelId
}

export async function getMessageTitle(message: Message, length = 30): Promise<string> {
  const content = getMainTextContent(message)

  if ((store.getState().settings as any).useTopicNamingForMessageTitle) {
    try {
      const tempMessage = resetMessage(message, {
        status: AssistantMessageStatus.SUCCESS,
        blocks: message.blocks
      })

      const titlePromise = fetchMessagesSummary({ messages: [tempMessage] })
      window.toast.loading({ title: t('chat.topics.export.wait_for_title_naming'), promise: titlePromise })
      const { text: title } = await titlePromise

      if (title) {
        window.toast.success(t('chat.topics.export.title_naming_success'))
        return title
      }
    } catch (e) {
      window.toast.error(t('chat.topics.export.title_naming_failed'))
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

    window.toast.warning(t('message.warning.rate.limit', { seconds: waitTimeSeconds }))
    return true
  }

  return false
}
