import { useInfiniteFlatItems, useInfiniteQuery, useQuery } from '@data/hooks/useDataApi'
import type { GroupedVirtualListGroup } from '@renderer/components/VirtualList'
import type { GlobalSearchRecentEntry } from '@shared/data/cache/cacheValueTypes'
import dayjs from 'dayjs'
import { useCallback, useMemo } from 'react'

import {
  buildGlobalMessageSearchGroups,
  buildGlobalSearchGroups,
  getGlobalSearchTypes,
  getMessageSearchSources,
  GLOBAL_SEARCH_MESSAGE_PREVIEW_LIMIT,
  type GlobalMessageSearchPanelGroup,
  type GlobalMessageSearchPanelItem,
  type GlobalMessageSearchSourceFilter,
  type GlobalSearchFilter,
  type GlobalSearchPanelGroup,
  type GlobalSearchPanelGroupFooter,
  type GlobalSearchPanelItem
} from './globalSearchGroups'

export type GlobalSearchPanelMode = 'search' | 'menu-manager' | 'message-search'
export type GlobalSearchTimeFilter = 'any' | 'today' | 'week' | 'month' | 'quarter'

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
  const messageSearchQuery = useMemo(
    () => ({
      q: deferredQuery,
      ...(updatedAtFrom ? { createdAtFrom: updatedAtFrom } : {})
    }),
    [deferredQuery, updatedAtFrom]
  )
  const searchQuery = useMemo(
    () => ({
      q: deferredQuery,
      types: searchTypes,
      ...(updatedAtFrom ? { updatedAtFrom } : {})
    }),
    [deferredQuery, searchTypes, updatedAtFrom]
  )

  const {
    pages: topicMessagePages,
    isLoading: isTopicMessageLoading,
    isRefreshing: isTopicMessageRefreshing,
    error: topicMessageError,
    hasNext: hasNextTopicMessagePage,
    loadNext: loadNextTopicMessagePage
  } = useInfiniteQuery('/messages/search', {
    enabled: hasQuery && shouldSearchTopicMessages,
    query: messageSearchQuery,
    limit: messageSearchLimit
  })
  const {
    pages: sessionMessagePages,
    isLoading: isSessionMessageLoading,
    isRefreshing: isSessionMessageRefreshing,
    error: sessionMessageError,
    hasNext: hasNextSessionMessagePage,
    loadNext: loadNextSessionMessagePage
  } = useInfiniteQuery('/sessions/messages/search', {
    enabled: hasQuery && shouldSearchSessionMessages,
    query: messageSearchQuery,
    limit: messageSearchLimit
  })
  const topicMessageItems = useInfiniteFlatItems(topicMessagePages)
  const sessionMessageItems = useInfiniteFlatItems(sessionMessagePages)
  const isMessageLoading =
    isMessageSearchMode &&
    ((shouldSearchTopicMessages && isTopicMessageLoading) || (shouldSearchSessionMessages && isSessionMessageLoading))
  const messageError = topicMessageError ?? sessionMessageError
  const hasMoreMessageResults =
    isMessageSearchMode &&
    ((shouldSearchTopicMessages && hasNextTopicMessagePage) ||
      (shouldSearchSessionMessages && hasNextSessionMessagePage))
  const isLoadingMoreMessageResults =
    isMessageSearchMode &&
    ((shouldSearchTopicMessages && isTopicMessageRefreshing && topicMessagePages.length > 0) ||
      (shouldSearchSessionMessages && isSessionMessageRefreshing && sessionMessagePages.length > 0))
  const messageLoadMoreCount =
    (shouldSearchTopicMessages && hasNextTopicMessagePage ? messageSearchLimit : 0) +
    (shouldSearchSessionMessages && hasNextSessionMessagePage ? messageSearchLimit : 0)
  const loadMoreMessageResults = useCallback(() => {
    if (shouldSearchTopicMessages && hasNextTopicMessagePage) {
      loadNextTopicMessagePage()
    }
    if (shouldSearchSessionMessages && hasNextSessionMessagePage) {
      loadNextSessionMessagePage()
    }
  }, [
    hasNextSessionMessagePage,
    hasNextTopicMessagePage,
    loadNextSessionMessagePage,
    loadNextTopicMessagePage,
    shouldSearchSessionMessages,
    shouldSearchTopicMessages
  ])

  const { data, isLoading, error } = useQuery('/global-search', {
    enabled: hasQuery && panelMode === 'search',
    query: searchQuery
  })

  const messageSearchItems = useMemo(
    () =>
      [
        ...(shouldSearchTopicMessages
          ? topicMessageItems.map((item) => ({ ...item, sourceType: 'topic' as const }))
          : []),
        ...(shouldSearchSessionMessages
          ? sessionMessageItems.map((item) => ({ ...item, sourceType: 'session' as const }))
          : [])
      ].sort((a, b) => {
        const timeA = dayjs(a.createdAt).valueOf() || 0
        const timeB = dayjs(b.createdAt).valueOf() || 0
        if (timeA !== timeB) return timeB - timeA
        if (a.sourceType !== b.sourceType) return a.sourceType === 'topic' ? -1 : 1
        return b.messageId.localeCompare(a.messageId)
      }),
    [sessionMessageItems, shouldSearchSessionMessages, shouldSearchTopicMessages, topicMessageItems]
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
