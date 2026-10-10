import { createFileRoute, redirect } from '@tanstack/react-router'

import HomePage from '@renderer/pages/home/HomePage'
import { parseChatRouteSearch } from '@renderer/pages/home/routeSearch'
import { resolveChatEntryTopicId, resolveChatEntryTopicIdForAssistant } from '@renderer/utils/conversationEntry'

export const Route = createFileRoute('/app/chat')({
  validateSearch: (search) => parseChatRouteSearch(search),
  // Resolving before mount renders the final conversation in one pass. A sidebar
  // `?assistantId=` entry must resume that assistant, not the globally last-focused topic.
  beforeLoad: async ({ search }) => {
    if (search.topicId) return
    if (search.assistantId) {
      const topicId = await resolveChatEntryTopicIdForAssistant(search.assistantId)
      if (topicId) throw redirect({ to: '/app/chat', search: { topicId }, replace: true })
      return
    }
    const topicId = await resolveChatEntryTopicId()
    if (topicId) throw redirect({ to: '/app/chat', search: { topicId }, replace: true })
  },
  component: HomePage
})
