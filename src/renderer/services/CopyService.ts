import type { ExportableMessage } from '@renderer/types/messageExport'
import type { Topic } from '@renderer/types/topic'
import { messageToPlainText } from '@renderer/utils/export'
import i18next from 'i18next'

import { topicToMarkdown, topicToPlainText } from './ExportService'

export const copyTopicAsMarkdown = async (topic: Topic) => {
  const markdown = await topicToMarkdown(topic)
  await navigator.clipboard.writeText(markdown)
  window.toast.success(i18next.t('message.copy.success'))
}

export const copyTopicAsPlainText = async (topic: Topic) => {
  const plainText = await topicToPlainText(topic)
  await navigator.clipboard.writeText(plainText)
  window.toast.success(i18next.t('message.copy.success'))
}

export const copyMessageAsPlainText = async (message: ExportableMessage) => {
  const plainText = messageToPlainText(message)
  await navigator.clipboard.writeText(plainText)
  window.toast.success(i18next.t('message.copy.success'))
}
