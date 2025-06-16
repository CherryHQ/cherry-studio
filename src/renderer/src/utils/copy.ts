import { Message, Topic } from '@renderer/types'
import i18next from 'i18next'

import { messageToPlainText, topicToMarkdown, topicToPlainText } from './export'

export const copyTopicAsMarkdown = async (topic: Topic) => {
  const markdown = await topicToMarkdown(topic)
  await navigator.clipboard.writeText(markdown)
  window.message.success(i18next.t('message.copy.success'))
}

export const copyTopicAsPlainText = async (topic: Topic) => {
  const plainText = await topicToPlainText(topic)
  await navigator.clipboard.writeText(plainText)
  window.message.success(i18next.t('message.copy.success'))
}

export const copyMessageAsPlainText = async (message: Message) => {
  const plainText = messageToPlainText(message)
  await navigator.clipboard.writeText(plainText)
  window.message.success(i18next.t('message.copy.success'))
}
