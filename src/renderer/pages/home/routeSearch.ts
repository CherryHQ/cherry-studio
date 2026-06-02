export const CHAT_ROUTE = '/app/chat' as const
export const MESSAGE_VIEW = 'message' as const

export type ChatRouteSearch = {
  assistantId?: string
  topicId?: string
  view?: typeof MESSAGE_VIEW
}

export function buildChatMessageRouteUrl(topicId: string): string {
  const params = new URLSearchParams({ topicId, view: MESSAGE_VIEW })
  return `${CHAT_ROUTE}?${params.toString()}`
}

/** Open a topic as a normal chat tab (no focused message view). */
export function buildChatTopicRouteUrl(topicId: string): string {
  return `${CHAT_ROUTE}?topicId=${encodeURIComponent(topicId)}`
}

/** Open a fresh temporary chat seeded with a specific assistant. */
export function buildChatAssistantRouteUrl(assistantId: string): string {
  return `${CHAT_ROUTE}?assistantId=${encodeURIComponent(assistantId)}`
}

/** Extract the topicId a chat tab points at, for cross-tab dedupe. */
export function getTopicIdFromUrl(url: string): string | undefined {
  try {
    return new URL(url, 'app://x').searchParams.get('topicId') ?? undefined
  } catch {
    return undefined
  }
}

export function parseChatRouteSearch(search: Record<string, unknown>): ChatRouteSearch {
  const assistantId = typeof search.assistantId === 'string' ? search.assistantId : undefined
  const topicId = typeof search.topicId === 'string' ? search.topicId : undefined
  const view = search.view === MESSAGE_VIEW ? MESSAGE_VIEW : undefined

  return { assistantId, topicId, view }
}
