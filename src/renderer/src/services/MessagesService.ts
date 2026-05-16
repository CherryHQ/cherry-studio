import { dataApiService } from '@data/DataApiService'
import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { getTopicById } from '@renderer/hooks/useTopic'
import { fetchMessagesSummary } from '@renderer/services/ApiService'
import type { ExportableMessage } from '@renderer/types/messageExport'
import { getTitleFromString } from '@renderer/utils/export'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import type { UseNavigateResult } from '@tanstack/react-router'
import dayjs from 'dayjs'
import { t } from 'i18next'

import { EVENT_NAMES, EventEmitter } from './EventService'

const logger = loggerService.withContext('MessagesService')

type MessageLocator = {
  id: string
  topicId: string
  assistantId?: string
}

export async function locateToMessage(navigate: UseNavigateResult<string>, message: MessageLocator) {
  SearchPopup.hide()
  const assistantId = message.assistantId
    ? await dataApiService
        .get(`/assistants/${message.assistantId}`)
        .then((a) => a?.id)
        .catch(() => undefined)
    : undefined
  const topic = await getTopicById(message.topicId)

  void navigate({ to: '/app/chat', search: { assistantId, topicId: topic?.id } })

  setTimeout(() => EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR), 0)
  setTimeout(() => EventEmitter.emit(EVENT_NAMES.LOCATE_MESSAGE + ':' + message.id), 300)
}

export function getMessageModelId(message: ExportableMessage) {
  return message?.model?.id || message.modelId
}

export async function getMessageTitle(message: ExportableMessage, length = 30): Promise<string> {
  const content = getMainTextContent(message)

  // Read from v2 Preference (`data.export.markdown.use_topic_naming_for_message_title`)
  // — the v1 Redux key was migrated; the renderer settings page reads the
  // same Preference key, so a stale Redux read here would diverge from the
  // settings UI value.
  const useTopicNaming = await preferenceService.get('data.export.markdown.use_topic_naming_for_message_title')
  if (useTopicNaming) {
    try {
      const titlePromise = fetchMessagesSummary({ messages: [message] })
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
