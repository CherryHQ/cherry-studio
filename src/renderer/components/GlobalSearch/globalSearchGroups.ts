import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type {
  EntitySearchItem,
  EntitySearchResponse,
  EntitySearchType,
  SessionMessageContentSearchItem,
  TopicMessageContentSearchItem
} from '@shared/data/api/schemas/search'
import type { GlobalSearchRecentEntry, Tab } from '@shared/data/cache/cacheValueTypes'
import type { Topic } from '@types'
import dayjs from 'dayjs'

export const GLOBAL_SEARCH_RECENT_ITEM_LIMIT = 20
export const GLOBAL_SEARCH_DISPLAY_RECENT_LIMIT = 6
export const GLOBAL_MESSAGE_SEARCH_GROUP_COLLAPSED_LIMIT = 3
export const GLOBAL_SEARCH_ENTITY_GROUP_COLLAPSED_LIMIT = 5
export const GLOBAL_SEARCH_MESSAGE_PREVIEW_LIMIT = 5

export type GlobalSearchFilter = 'all' | 'topic' | 'session' | 'assistant' | 'agent' | 'knowledge'
export type GlobalMessageSearchSourceFilter = 'all' | 'topic' | 'session'
type GlobalTopicMessageSearchResult = TopicMessageContentSearchItem & { sourceType: 'topic' }
type GlobalSessionMessageSearchResult = SessionMessageContentSearchItem & { sourceType: 'session' }
export type GlobalMessageSearchResult = GlobalTopicMessageSearchResult | GlobalSessionMessageSearchResult
type GlobalMessageSearchSource = GlobalMessageSearchResult['sourceType']

export type GlobalSearchGroupId = 'recent' | 'topic' | 'session' | 'message' | 'assistant' | 'agent' | 'knowledge-base'

export type GlobalMessageSearchPanelItem =
  | {
      kind: 'message'
      id: string
      parentId: string
      result: GlobalMessageSearchResult
    }
  | {
      kind: 'more'
      id: string
      parentId: string
      remainingCount: number
    }

export type GlobalMessageSearchPanelGroup = {
  id: string
  sourceType: GlobalMessageSearchSource
  title: string
  total: number
  items: GlobalMessageSearchPanelItem[]
}

export type GlobalSearchPanelItem =
  | {
      kind: 'recent'
      id: string
      recent: GlobalSearchRecentEntry
    }
  | {
      kind: 'message-parent'
      id: string
      group: GlobalMessageSearchPanelGroup
    }
  | {
      kind: 'message'
      id: string
      parentId: string
      result: GlobalMessageSearchResult
    }
  | {
      kind: 'result'
      id: string
      result: EntitySearchItem
    }

export type GlobalSearchPanelGroupFooter =
  | {
      kind: 'expand-results'
      groupId: GlobalSearchGroupId
      remainingCount: number
    }
  | {
      kind: 'open-message-search'
    }

export type GlobalSearchPanelGroup = {
  id: GlobalSearchGroupId
  items: GlobalSearchPanelItem[]
  total?: number
  footer?: GlobalSearchPanelGroupFooter
}

const FILTER_TYPES: Record<GlobalSearchFilter, EntitySearchType[]> = {
  all: ['topic', 'session', 'assistant', 'agent', 'knowledge-base'],
  topic: ['topic'],
  session: ['session'],
  assistant: ['assistant'],
  agent: ['agent'],
  knowledge: ['knowledge-base']
}

const INTERNAL_ROUTE_PREFIXES = ['/app/', '/settings']
const COARSE_ENTITY_ROUTE_PATHS = new Set(['/app/chat', '/app/agents'])

export function getGlobalSearchTypes(filter: GlobalSearchFilter): EntitySearchType[] {
  return FILTER_TYPES[filter]
}

export function getMessageSearchSources(filter: GlobalMessageSearchSourceFilter): GlobalMessageSearchSource[] {
  switch (filter) {
    case 'topic':
      return ['topic']
    case 'session':
      return ['session']
    case 'all':
      return ['topic', 'session']
  }
}

function getGlobalSearchRecentEntryId(entry: GlobalSearchRecentEntry): string {
  switch (entry.kind) {
    case 'route':
      return `route:${entry.url}`
    case 'topic':
      return `topic:${entry.topicId}`
    case 'session':
      return `session:${entry.sessionId}`
  }
}

function areGlobalSearchRecentEntriesEqual(a: GlobalSearchRecentEntry, b: GlobalSearchRecentEntry) {
  if (a.kind !== b.kind || a.title !== b.title || a.lastAccessTime !== b.lastAccessTime) return false

  switch (a.kind) {
    case 'route':
      return b.kind === 'route' && a.url === b.url && a.icon === b.icon
    case 'topic':
      return b.kind === 'topic' && a.topicId === b.topicId
    case 'session':
      return b.kind === 'session' && a.sessionId === b.sessionId
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
      return previous && areGlobalSearchRecentEntriesEqual(previous, candidate)
    })
  ) {
    return entries as GlobalSearchRecentEntry[]
  }

  return next
}

function getDisplayGlobalSearchRecentEntries(entries: readonly GlobalSearchRecentEntry[]): GlobalSearchRecentEntry[] {
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
  topic: Pick<Topic, 'id' | 'name'>,
  lastAccessTime = Date.now()
): GlobalSearchRecentEntry {
  return {
    kind: 'topic',
    topicId: topic.id,
    title: topic.name,
    lastAccessTime
  }
}

export function createRecentSessionEntryFromSession(
  session: Pick<AgentSessionEntity, 'id' | 'name'>,
  lastAccessTime = Date.now()
): GlobalSearchRecentEntry {
  return {
    kind: 'session',
    sessionId: session.id,
    title: session.name,
    lastAccessTime
  }
}

function getMessageResultParentId(result: GlobalMessageSearchResult) {
  return result.sourceType === 'topic' ? `topic:${result.topicId}` : `session:${result.sessionId}`
}

function buildGlobalMessagePreviewItems(items: readonly GlobalMessageSearchResult[]): GlobalSearchPanelItem[] {
  const totalByParentId = new Map<string, number>()
  for (const item of items) {
    const parentId = getMessageResultParentId(item)
    totalByParentId.set(parentId, (totalByParentId.get(parentId) ?? 0) + 1)
  }

  const visibleItems = items.slice(0, GLOBAL_SEARCH_MESSAGE_PREVIEW_LIMIT)
  const expandedParentIds = new Set(visibleItems.map(getMessageResultParentId))
  const groups = buildGlobalMessageSearchGroups({ expandedParentIds, items: visibleItems })
  const previewItems: GlobalSearchPanelItem[] = []
  let remainingCount = GLOBAL_SEARCH_MESSAGE_PREVIEW_LIMIT

  for (const group of groups) {
    const messageItems = group.items.filter((item) => item.kind === 'message').slice(0, remainingCount)
    if (messageItems.length === 0) continue

    previewItems.push({
      kind: 'message-parent',
      id: `message-parent:${group.id}`,
      group: {
        ...group,
        total: totalByParentId.get(group.id) ?? group.total
      }
    })
    previewItems.push(
      ...messageItems.map((item) => ({
        ...item,
        id: `message-preview:${item.id}`
      }))
    )
    remainingCount -= messageItems.length

    if (remainingCount <= 0) break
  }

  return previewItems
}

export function buildGlobalSearchGroups({
  expandedGroupIds = new Set(),
  messageItems = [],
  query,
  filter,
  recentItems,
  response
}: {
  expandedGroupIds?: ReadonlySet<GlobalSearchGroupId>
  messageItems?: readonly GlobalMessageSearchResult[]
  query: string
  filter: GlobalSearchFilter
  recentItems: readonly GlobalSearchRecentEntry[]
  response?: EntitySearchResponse
}): GlobalSearchPanelGroup[] {
  if (!query.trim()) {
    const panelItems = getDisplayGlobalSearchRecentEntries(recentItems).map<GlobalSearchPanelItem>((recent) => ({
      kind: 'recent',
      id: getGlobalSearchRecentEntryId(recent),
      recent
    }))

    return panelItems.length > 0 ? [{ id: 'recent', items: panelItems }] : []
  }

  const itemsByType = new Map<EntitySearchType, EntitySearchItem[]>()
  for (const group of response?.groups ?? []) {
    itemsByType.set(group.type, group.items)
  }

  const groups: GlobalSearchPanelGroup[] = []
  const includeTopic = filter === 'all' || filter === 'topic'
  const includeSession = filter === 'all' || filter === 'session'
  const includeAssistant = filter === 'all' || filter === 'assistant'
  const includeAgent = filter === 'all' || filter === 'agent'
  const includeKnowledge = filter === 'all' || filter === 'knowledge'
  const shouldCollapseEntityGroup = (groupId: GlobalSearchGroupId) =>
    filter === 'all' && (groupId === 'topic' || groupId === 'session') && !expandedGroupIds.has(groupId)
  const toPanelGroup = (groupId: GlobalSearchGroupId, items: GlobalSearchPanelItem[]): GlobalSearchPanelGroup => {
    if (!shouldCollapseEntityGroup(groupId) || items.length <= GLOBAL_SEARCH_ENTITY_GROUP_COLLAPSED_LIMIT) {
      return { id: groupId, items, total: items.length }
    }

    return {
      id: groupId,
      items: items.slice(0, GLOBAL_SEARCH_ENTITY_GROUP_COLLAPSED_LIMIT),
      total: items.length,
      footer: {
        kind: 'expand-results',
        groupId,
        remainingCount: items.length - GLOBAL_SEARCH_ENTITY_GROUP_COLLAPSED_LIMIT
      }
    }
  }

  if (includeTopic) {
    const topicItems = (itemsByType.get('topic') ?? []).map((result) => ({
      kind: 'result' as const,
      id: `${result.type}:${result.id}`,
      result
    }))
    if (topicItems.length > 0) groups.push(toPanelGroup('topic', topicItems))
  }

  if (includeSession) {
    const sessionItems = (itemsByType.get('session') ?? []).map((result) => ({
      kind: 'result' as const,
      id: `${result.type}:${result.id}`,
      result
    }))
    if (sessionItems.length > 0) groups.push(toPanelGroup('session', sessionItems))
  }

  if (filter === 'all' && messageItems.length > 0) {
    groups.push({
      id: 'message',
      items: buildGlobalMessagePreviewItems(messageItems),
      total: messageItems.length,
      footer: {
        kind: 'open-message-search'
      }
    })
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

export function buildGlobalMessageSearchGroups({
  expandedParentIds,
  items
}: {
  expandedParentIds: ReadonlySet<string>
  items: readonly GlobalMessageSearchResult[]
}): GlobalMessageSearchPanelGroup[] {
  const groupsByParent = new Map<
    string,
    { sourceType: GlobalMessageSearchSource; title: string; results: GlobalMessageSearchResult[] }
  >()

  for (const result of items) {
    const parentId = result.sourceType === 'topic' ? `topic:${result.topicId}` : `session:${result.sessionId}`
    const title = result.sourceType === 'topic' ? result.topicName : result.sessionName
    const group = groupsByParent.get(parentId)

    if (group) {
      group.results.push(result)
      continue
    }

    groupsByParent.set(parentId, {
      sourceType: result.sourceType,
      title,
      results: [result]
    })
  }

  return Array.from(groupsByParent.entries()).map(([parentId, group]) => {
    const expanded = expandedParentIds.has(parentId)
    const orderedResults = [...group.results].sort((a, b) => {
      const timeA = dayjs(a.createdAt).valueOf() || 0
      const timeB = dayjs(b.createdAt).valueOf() || 0
      if (timeA !== timeB) return timeA - timeB
      return a.messageId.localeCompare(b.messageId)
    })
    const visibleResults = expanded
      ? orderedResults
      : orderedResults.slice(0, GLOBAL_MESSAGE_SEARCH_GROUP_COLLAPSED_LIMIT)
    const items: GlobalMessageSearchPanelItem[] = visibleResults.map((result) => ({
      kind: 'message',
      id: `${parentId}:${result.messageId}`,
      parentId,
      result
    }))
    const remainingCount = group.results.length - visibleResults.length

    if (remainingCount > 0) {
      items.push({
        kind: 'more',
        id: `${parentId}:more`,
        parentId,
        remainingCount
      })
    }

    return {
      id: parentId,
      sourceType: group.sourceType,
      title: group.title,
      total: group.results.length,
      items
    }
  })
}
