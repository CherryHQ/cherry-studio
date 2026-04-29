import { loggerService } from '@logger'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { getTopicById } from '@renderer/hooks/useTopic'
import { fetchMessagesSummary } from '@renderer/services/ApiService'
import store from '@renderer/store'
import type { Message } from '@renderer/types/newMessage'
import { AssistantMessageStatus } from '@renderer/types/newMessage'
import { getTitleFromString } from '@renderer/utils/export'
import { resetMessage } from '@renderer/utils/messageUtils/create'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import type { UseNavigateResult } from '@tanstack/react-router'
import dayjs from 'dayjs'
import { t } from 'i18next'

import { getAssistantById } from './AssistantService'
import { EVENT_NAMES, EventEmitter } from './EventService'

const logger = loggerService.withContext('MessagesService')

export { getGroupedMessages } from '@renderer/utils/messageUtils/filters'

export async function locateToMessage(navigate: UseNavigateResult<string>, message: Message) {
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
