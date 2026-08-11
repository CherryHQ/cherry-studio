import HomePage from '@renderer/pages/home/HomePage'
import { parseChatRouteSearch } from '@renderer/pages/home/routeSearch'
import { resolveChatEntryTopicId, resolveChatEntryTopicIdForAssistant } from '@renderer/utils/conversationEntry'
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/app/chat')({
  validateSearch: (search) => parseChatRouteSearch(search),
  // Bare entries resolve their topic here, before the page mounts, so the page
  // renders the final conversation in one pass. Explicit targets pass through
  // untouched. A sidebar `?assistantId=` entry resolves that assistant's most
  // recent topic instead of the global last-focused one. Message-only entries
  // already carry a topic id; a stray `view=message` without one is still a bare
  // entry. No resolvable topic → fall through bare; the page renders its empty
  // state (with the pinned assistant still selected).
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
