import type { GlobalSearchItem, GlobalSearchResponse, GlobalSearchType } from '@shared/data/api/schemas/globalSearch'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import type { GlobalSearchRecentEntry, Tab } from '@shared/data/cache/cacheValueTypes'
import type { Topic } from '@types'

export const GLOBAL_SEARCH_RECENT_ITEM_LIMIT = 20
export const GLOBAL_SEARCH_DISPLAY_RECENT_LIMIT = 6

export type GlobalSearchFilter = 'all' | 'conversation' | 'assistant' | 'agent' | 'knowledge'

export type GlobalSearchGroupId =
  | 'recent'
  | 'conversation'
  | 'topic'
  | 'session'
  | 'assistant'
  | 'agent'
  | 'knowledge-base'

export type GlobalSearchPanelItem =
  | {
      kind: 'recent'
      id: string
      recent: GlobalSearchRecentEntry
    }
  | {
      kind: 'result'
      id: string
      result: GlobalSearchItem
    }

export type GlobalSearchPanelGroup = {
  id: GlobalSearchGroupId
  items: GlobalSearchPanelItem[]
}

const FILTER_TYPES: Record<GlobalSearchFilter, GlobalSearchType[]> = {
  all: ['topic', 'session', 'assistant', 'agent', 'knowledge-base'],
  conversation: ['topic', 'session'],
  assistant: ['assistant'],
  agent: ['agent'],
  knowledge: ['knowledge-base']
}

const INTERNAL_ROUTE_PREFIXES = ['/app/', '/settings']
const COARSE_ENTITY_ROUTE_PATHS = new Set(['/app/chat', '/app/agents'])

export function getGlobalSearchTypes(filter: GlobalSearchFilter): GlobalSearchType[] {
  return FILTER_TYPES[filter]
}

export function getGlobalSearchRecentEntryId(entry: GlobalSearchRecentEntry): string {
  switch (entry.kind) {
    case 'route':
      return `route:${entry.url}`
    case 'topic':
      return `topic:${entry.topicId}`
    case 'session':
      return `session:${entry.sessionId}`
  }
}

export function upsertGlobalSearchRecentEntry(
  entries: readonly GlobalSearchRecentEntry[],
  entry: GlobalSearchRecentEntry
): GlobalSearchRecentEntry[] {
  const entryId = getGlobalSearchRecentEntryId(entry)
  const rest = entries.filter((candidate) => getGlobalSearchRecentEntryId(candidate) !== entryId)
  const next = [entry, ...rest]
    .sort((a, b) => b.lastAccessTime - a.lastAccessTime)
    .slice(0, GLOBAL_SEARCH_RECENT_ITEM_LIMIT)

  if (
    next.length === entries.length &&
    next.every((candidate, index) => {
      const previous = entries[index]
      return previous && JSON.stringify(previous) === JSON.stringify(candidate)
    })
  ) {
    return entries as GlobalSearchRecentEntry[]
  }

  return next
}

export function getDisplayGlobalSearchRecentEntries(
  entries: readonly GlobalSearchRecentEntry[]
): GlobalSearchRecentEntry[] {
  return [...entries].sort((a, b) => b.lastAccessTime - a.lastAccessTime).slice(0, GLOBAL_SEARCH_DISPLAY_RECENT_LIMIT)
}

export function createRecentRouteEntryFromTab(
  tab: Tab,
  lastAccessTime = tab.lastAccessTime
): GlobalSearchRecentEntry | null {
  if (tab.type !== 'route') return null
  if (!lastAccessTime) return null

  const pathname = new URL(tab.url, 'https://www.cherry-ai.com').pathname
  if (COARSE_ENTITY_ROUTE_PATHS.has(pathname)) return null

  if (!INTERNAL_ROUTE_PREFIXES.some((prefix) => pathname === prefix.slice(0, -1) || pathname.startsWith(prefix))) {
    return null
  }

  return {
    kind: 'route',
    url: tab.url,
    title: tab.title,
    icon: tab.icon,
    lastAccessTime
  }
}

export function createRecentTopicEntryFromTopic(
  topic: Pick<Topic, 'id' | 'name' | 'assistantId'>,
  lastAccessTime = Date.now()
): GlobalSearchRecentEntry {
  return {
    kind: 'topic',
    topicId: topic.id,
    title: topic.name,
    assistantId: topic.assistantId,
    lastAccessTime
  }
}

export function createRecentSessionEntryFromSession(
  session: Pick<AgentSessionEntity, 'id' | 'name' | 'agentId'>,
  lastAccessTime = Date.now()
): GlobalSearchRecentEntry {
  return {
    kind: 'session',
    sessionId: session.id,
    title: session.name,
    agentId: session.agentId,
    lastAccessTime
  }
}

export function buildGlobalSearchGroups({
  query,
  filter,
  recentItems,
  response
}: {
  query: string
  filter: GlobalSearchFilter
  recentItems: readonly GlobalSearchRecentEntry[]
  response?: GlobalSearchResponse
}): GlobalSearchPanelGroup[] {
  if (!query.trim()) {
    const panelItems = getDisplayGlobalSearchRecentEntries(recentItems).map<GlobalSearchPanelItem>((recent) => ({
      kind: 'recent',
      id: getGlobalSearchRecentEntryId(recent),
      recent
    }))

    return panelItems.length > 0 ? [{ id: 'recent', items: panelItems }] : []
  }

  const itemsByType = new Map<GlobalSearchType, GlobalSearchItem[]>()
  for (const group of response?.groups ?? []) {
    itemsByType.set(group.type, group.items)
  }

  const groups: GlobalSearchPanelGroup[] = []
  const includeConversation = filter === 'all' || filter === 'conversation'
  const includeAssistant = filter === 'all' || filter === 'assistant'
  const includeAgent = filter === 'all' || filter === 'agent'
  const includeKnowledge = filter === 'all' || filter === 'knowledge'

  if (includeConversation) {
    const topicItems = (itemsByType.get('topic') ?? []).map((result) => ({
      kind: 'result' as const,
      id: `${result.type}:${result.id}`,
      result
    }))
    if (topicItems.length > 0) groups.push({ id: 'topic', items: topicItems })

    const sessionItems = (itemsByType.get('session') ?? []).map((result) => ({
      kind: 'result' as const,
      id: `${result.type}:${result.id}`,
      result
    }))
    if (sessionItems.length > 0) groups.push({ id: 'session', items: sessionItems })
  }

  if (includeAssistant) {
    const items = (itemsByType.get('assistant') ?? []).map((result) => ({
      kind: 'result' as const,
      id: `${result.type}:${result.id}`,
      result
    }))
    if (items.length > 0) groups.push({ id: 'assistant', items })
  }

  if (includeAgent) {
    const items = (itemsByType.get('agent') ?? []).map((result) => ({
      kind: 'result' as const,
      id: `${result.type}:${result.id}`,
      result
    }))
    if (items.length > 0) groups.push({ id: 'agent', items })
  }

  if (includeKnowledge) {
    const items = (itemsByType.get('knowledge-base') ?? []).map((result) => ({
      kind: 'result' as const,
      id: `${result.type}:${result.id}`,
      result
    }))
    if (items.length > 0) groups.push({ id: 'knowledge-base', items })
  }

  return groups
}
