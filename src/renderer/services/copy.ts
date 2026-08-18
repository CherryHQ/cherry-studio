import { toast } from '@renderer/services/toast'
import type { ExportableMessage } from '@renderer/types/messageExport'
import type { Topic } from '@renderer/types/topic'
import i18next from 'i18next'

export const copyTopicAsMarkdown = async (topic: Topic) => {
  const { topicToMarkdown } = await import('./ExportService')
  const markdown = await topicToMarkdown(topic)
  await navigator.clipboard.writeText(markdown)
  toast.success(i18next.t('message.copy.success'))
}

export const copyTopicAsPlainText = async (topic: Topic) => {
  const { topicToPlainText } = await import('./ExportService')
  const plainText = await topicToPlainText(topic)
  await navigator.clipboard.writeText(plainText)
  toast.success(i18next.t('message.copy.success'))
}

export const copyMessageAsPlainText = async (message: ExportableMessage) => {
  const { messageToPlainText } = await import('@renderer/utils/export')
  const plainText = await messageToPlainText(message)
  await navigator.clipboard.writeText(plainText)
  toast.success(i18next.t('message.copy.success'))
}
