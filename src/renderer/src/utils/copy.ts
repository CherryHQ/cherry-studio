import { Topic } from '@renderer/types'

import { topicToMarkdown } from './export'

export const copyTopicAsMarkdown = async (topic: Topic) => {
  const markdown = await topicToMarkdown(topic)
  await navigator.clipboard.writeText(markdown)
}
