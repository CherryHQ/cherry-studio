import { useQuery } from '@data/hooks/useDataApi'
import type { GroupedVirtualListGroup } from '@renderer/components/VirtualList'
import type { ContentSearchGroup, ContentSearchSourceType } from '@shared/data/api/schemas/search'
import type { GlobalSearchRecentEntry } from '@shared/data/cache/cacheValueTypes'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  buildGlobalMessageSearchGroups,
  buildGlobalSearchGroups,
  getGlobalSearchTypes,
  getMessageSearchSources,
  GLOBAL_SEARCH_MESSAGE_PREVIEW_LIMIT,
  type GlobalMessageSearchPanelGroup,
  type GlobalMessageSearchPanelItem,
  type GlobalMessageSearchResult,
  type GlobalMessageSearchSourceFilter,
  type GlobalSearchFilter,
  type GlobalSearchPanelGroup,
  type GlobalSearchPanelGroupFooter,
  type GlobalSearchPanelItem
} from './globalSearchGroups'

export type GlobalSearchPanelMode = 'search' | 'message-search'
export type GlobalSearchTimeFilter = 'any' | 'today' | 'week' | 'month' | 'quarter'

type ContentSearchCursorMap = Partial<Record<ContentSearchSourceType, string>>

type ContentSearchState = {
  baseKey: string
  items: GlobalMessageSearchResult[]
  requestedCursors: ContentSearchCursorMap
  nextCursors: ContentSearchCursorMap
}

function createContentSearchState(baseKey: string): ContentSearchState {
  return {
    baseKey,
    items: [],
    requestedCursors: {},
    nextCursors: {}
  }
}

function getUpdatedAtFromForTimeFilter(filter: GlobalSearchTimeFilter): string | undefined {
  if (filter === 'any') return undefined

  switch (filter) {
    case 'today':
      return dayjs().startOf('day').toISOString()
    case 'week':
      return dayjs().subtract(7, 'day').toISOString()
    case 'month':
      return dayjs().subtract(1, 'month').toISOString()
    case 'quarter':
      return dayjs().subtract(3, 'month').toISOString()
  }
}

function toContentSearchSource(source: 'topic' | 'session'): ContentSearchSourceType {
  return source === 'topic' ? 'topic-message' : 'session-message'
}

function getContentSearchSources({
  shouldSearchSessionMessages,
  shouldSearchTopicMessages
}: {
  shouldSearchSessionMessages: boolean
  shouldSearchTopicMessages: boolean
}): ContentSearchSourceType[] {
  return [
    ...(shouldSearchTopicMessages ? [toContentSearchSource('topic')] : []),
    ...(shouldSearchSessionMessages ? [toContentSearchSource('session')] : [])
  ]
}

function getContentSearchStateKey({
  deferredQuery,
  messageSearchLimit,
  sources,
  updatedAtFrom
}: {
  deferredQuery: string
  messageSearchLimit: number
  sources: readonly ContentSearchSourceType[]
  updatedAtFrom?: string
}) {
  return JSON.stringify({
    q: deferredQuery,
    sources,
    createdAtFrom: updatedAtFrom,
    limitPerSource: messageSearchLimit
  })
}

function mapContentSearchGroup(group: ContentSearchGroup): GlobalMessageSearchResult[] {
  if (group.sourceType === 'topic-message') {
    return group.items.map((item) => ({
      ...item,
      sourceType: 'topic' as const
    }))
  }

  return group.items.map((item) => ({
    ...item,
    sourceType: 'session' as const
  }))
}

function getMessageSearchResultId(result: GlobalMessageSearchResult) {
  return result.sourceType === 'topic'
    ? `topic:${result.topicId}:${result.messageId}`
    : `session:${result.sessionId}:${result.messageId}`
}

function getContentSearchNextCursors(groups: readonly ContentSearchGroup[]): ContentSearchCursorMap {
  return Object.fromEntries(
    groups.flatMap((group) => (group.nextCursor ? [[group.sourceType, group.nextCursor] as const] : []))
  )
}

function areContentSearchCursorsEqual(a: ContentSearchCursorMap, b: ContentSearchCursorMap) {
  const aEntries = Object.entries(a)
  const bEntries = Object.entries(b)
  return (
    aEntries.length === bEntries.length &&
    aEntries.every(([source, cursor]) => b[source as ContentSearchSourceType] === cursor)
  )
}

function areMessageSearchItemsEqual(a: readonly GlobalMessageSearchResult[], b: readonly GlobalMessageSearchResult[]) {
  return (
    a.length === b.length &&
    a.every((item, index) => {
      const next = b[index]
      if (!next) return false
      if (
        item.sourceType !== next.sourceType ||
        item.messageId !== next.messageId ||
        item.role !== next.role ||
        item.snippet !== next.snippet ||
        item.createdAt !== next.createdAt
      ) {
        return false
      }

      if (item.sourceType === 'topic') {
        return (
          next.sourceType === 'topic' &&
          item.topicId === next.topicId &&
          item.topicName === next.topicName &&
          item.topicAssistantId === next.topicAssistantId &&
          item.topicCreatedAt === next.topicCreatedAt &&
          item.topicUpdatedAt === next.topicUpdatedAt
        )
      }

      return (
        next.sourceType === 'session' &&
        item.sessionId === next.sessionId &&
        item.sessionName === next.sessionName &&
        item.agentId === next.agentId &&
        item.agentName === next.agentName
      )
    })
  )
}

export function useGlobalSearchPanelData({
  deferredQuery,
  expandedMessageParentIds,
  expandedSearchGroupIds,
  filter,
  messageSourceFilter,
  panelMode,
  recentItems,
  timeFilter
}: {
  deferredQuery: string
  expandedMessageParentIds: ReadonlySet<string>
  expandedSearchGroupIds: ReadonlySet<GlobalSearchPanelGroup['id']>
  filter: GlobalSearchFilter
  messageSourceFilter: GlobalMessageSearchSourceFilter
  panelMode: GlobalSearchPanelMode
  recentItems: readonly GlobalSearchRecentEntry[] | undefined
  timeFilter: GlobalSearchTimeFilter
}) {
  const hasQuery = deferredQuery.length > 0
  const isMessageSearchMode = panelMode === 'message-search'
  const shouldShowGlobalMessagePreview = panelMode === 'search' && filter === 'all'
  const searchTypes = useMemo(() => getGlobalSearchTypes(filter), [filter])
  const messageSearchSources = useMemo(() => getMessageSearchSources(messageSourceFilter), [messageSourceFilter])
  const shouldSearchTopicMessages =
    shouldShowGlobalMessagePreview || (isMessageSearchMode && messageSearchSources.includes('topic'))
  const shouldSearchSessionMessages =
    shouldShowGlobalMessagePreview || (isMessageSearchMode && messageSearchSources.includes('session'))
  const updatedAtFrom = useMemo(() => getUpdatedAtFromForTimeFilter(timeFilter), [timeFilter])
  const messageSearchLimit = shouldShowGlobalMessagePreview ? GLOBAL_SEARCH_MESSAGE_PREVIEW_LIMIT : 50
  const contentSearchSources = useMemo(
    () =>
      getContentSearchSources({
        shouldSearchSessionMessages,
        shouldSearchTopicMessages
      }),
    [shouldSearchSessionMessages, shouldSearchTopicMessages]
  )
  const contentSearchStateKey = useMemo(
    () =>
      getContentSearchStateKey({
        deferredQuery,
        messageSearchLimit,
        sources: contentSearchSources,
        updatedAtFrom
      }),
    [contentSearchSources, deferredQuery, messageSearchLimit, updatedAtFrom]
  )
  const [contentSearchState, setContentSearchState] = useState(() => createContentSearchState(contentSearchStateKey))
  // When the search key changes we render against a fresh, empty accumulator immediately (derive-during-render)
  // and let the effect below reconcile `contentSearchState` afterwards. The fresh state has empty `requestedCursors`,
  // so the memoized SWR key it feeds stays value-stable - do NOT "simplify" this into a setState-in-render or it loops.
  const activeContentSearchState =
    contentSearchState.baseKey === contentSearchStateKey
      ? contentSearchState
      : createContentSearchState(contentSearchStateKey)
  const requestedContentSearchCursors = activeContentSearchState.requestedCursors
  const requestedContentSearchSources = useMemo(() => {
    const cursorSources = contentSearchSources.filter((source) => requestedContentSearchCursors[source])
    return cursorSources.length > 0 ? cursorSources : contentSearchSources
  }, [contentSearchSources, requestedContentSearchCursors])
  const contentSearchQuery = useMemo(
    () => ({
      q: deferredQuery,
      sources: requestedContentSearchSources,
      limitPerSource: messageSearchLimit,
      ...(Object.keys(requestedContentSearchCursors).length > 0 ? { cursors: requestedContentSearchCursors } : {}),
      ...(updatedAtFrom ? { createdAtFrom: updatedAtFrom } : {})
    }),
    [deferredQuery, messageSearchLimit, requestedContentSearchCursors, requestedContentSearchSources, updatedAtFrom]
  )
  const searchQuery = useMemo(
    () => ({
      q: deferredQuery,
      types: searchTypes,
      ...(updatedAtFrom ? { updatedAtFrom } : {})
    }),
    [deferredQuery, searchTypes, updatedAtFrom]
  )

  useEffect(() => {
    setContentSearchState((state) =>
      state.baseKey === contentSearchStateKey ? state : createContentSearchState(contentSearchStateKey)
    )
  }, [contentSearchStateKey])

  const {
    data: contentSearchData,
    isLoading: isContentSearchLoading,
    isRefreshing: isContentSearchRefreshing,
    error: contentSearchError
  } = useQuery('/search/contents', {
    enabled: hasQuery && contentSearchSources.length > 0,
    query: contentSearchQuery,
    swrOptions: {
      keepPreviousData: false
    }
  })

  useEffect(() => {
    if (!contentSearchData || contentSearchData.query !== deferredQuery) return

    setContentSearchState((state) => {
      const current = state.baseKey === contentSearchStateKey ? state : createContentSearchState(contentSearchStateKey)
      const itemsById = new Map(current.items.map((item) => [getMessageSearchResultId(item), item] as const))

      for (const group of contentSearchData.groups) {
        for (const item of mapContentSearchGroup(group)) {
          itemsById.set(getMessageSearchResultId(item), item)
        }
      }

      const nextItems = Array.from(itemsById.values())
      const nextCursors = getContentSearchNextCursors(contentSearchData.groups)

      if (
        areMessageSearchItemsEqual(current.items, nextItems) &&
        areContentSearchCursorsEqual(current.nextCursors, nextCursors)
      ) {
        return current
      }

      return {
        ...current,
        items: nextItems,
        nextCursors
      }
    })
  }, [contentSearchData, contentSearchStateKey, deferredQuery])

  const hasMoreMessageResults = isMessageSearchMode && Object.keys(activeContentSearchState.nextCursors).length > 0
  const isLoadingMoreMessageResults =
    isMessageSearchMode &&
    Object.keys(activeContentSearchState.requestedCursors).length > 0 &&
    isContentSearchRefreshing
  const isMessageLoading = isMessageSearchMode && activeContentSearchState.items.length === 0 && isContentSearchLoading
  const messageError = contentSearchError
  const messageLoadMoreCount = Object.keys(activeContentSearchState.nextCursors).length * messageSearchLimit
  const loadMoreMessageResults = useCallback(() => {
    setContentSearchState((state) => {
      const current = state.baseKey === contentSearchStateKey ? state : createContentSearchState(contentSearchStateKey)
      if (Object.keys(current.nextCursors).length === 0) return current

      return {
        ...current,
        requestedCursors: current.nextCursors
      }
    })
  }, [contentSearchStateKey])

  const { data, isLoading, error } = useQuery('/search/entities', {
    enabled: hasQuery && panelMode === 'search',
    query: searchQuery
  })

  const messageSearchItems = useMemo(
    () =>
      [...activeContentSearchState.items].sort((a, b) => {
        const timeA = dayjs(a.createdAt).valueOf() || 0
        const timeB = dayjs(b.createdAt).valueOf() || 0
        if (timeA !== timeB) return timeB - timeA
        if (a.sourceType !== b.sourceType) return a.sourceType === 'topic' ? -1 : 1
        return b.messageId.localeCompare(a.messageId)
      }),
    [activeContentSearchState.items]
  )

  const groups = useMemo(
    () =>
      buildGlobalSearchGroups({
        expandedGroupIds: expandedSearchGroupIds,
        messageItems: shouldShowGlobalMessagePreview ? messageSearchItems : [],
        query: deferredQuery,
        filter,
        recentItems: recentItems ?? [],
        response: data
      }),
    [
      data,
      deferredQuery,
      expandedSearchGroupIds,
      filter,
      messageSearchItems,
      recentItems,
      shouldShowGlobalMessagePreview
    ]
  )

  const messageGroups = useMemo(
    () =>
      buildGlobalMessageSearchGroups({
        expandedParentIds: expandedMessageParentIds,
        items: messageSearchItems
      }),
    [expandedMessageParentIds, messageSearchItems]
  )

  const virtualGroups = useMemo<
    ReadonlyArray<
      GroupedVirtualListGroup<
        GlobalSearchPanelGroup,
        GlobalSearchPanelItem,
        GlobalSearchPanelGroup,
        GlobalSearchPanelGroupFooter
      >
    >
  >(
    () =>
      groups.map((group) => ({
        group,
        header: group,
        items: group.items,
        footer: group.footer
      })),
    [groups]
  )

  const messageVirtualGroups = useMemo<
    ReadonlyArray<GroupedVirtualListGroup<GlobalMessageSearchPanelGroup, GlobalMessageSearchPanelItem>>
  >(
    () =>
      messageGroups.map((group) => ({
        group,
        header: group,
        items: group.items
      })),
    [messageGroups]
  )

  return {
    error,
    groups,
    hasQuery,
    hasMoreMessageResults,
    isLoading,
    isLoadingMoreMessageResults,
    isMessageLoading,
    isMessageSearchMode,
    loadMoreMessageResults,
    messageError,
    messageGroups,
    messageLoadMoreCount,
    messageVirtualGroups,
    updatedAtFrom,
    virtualGroups
  }
}
