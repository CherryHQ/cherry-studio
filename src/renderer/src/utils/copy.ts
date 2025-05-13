import { Message, Topic } from '@renderer/types'
import { messageToPlainText, topicToMarkdown, topicToPlainText } from './export'

export const copyTopicAsMarkdown = async (topic: Topic) => {
  const markdown = await topicToMarkdown(topic)
  await navigator.clipboard.writeText(markdown)
}

export const copyTopicAsPlainText = async (topic: Topic) => {
  const plainText = await topicToPlainText(topic)
  await navigator.clipboard.writeText(plainText)
}

export const copyMessageAsPlainText = async (message: Message) => {
  const plainText = messageToPlainText(message)
  await navigator.clipboard.writeText(plainText)
}
