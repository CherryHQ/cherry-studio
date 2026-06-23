import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Input,
  Kbd,
  KbdGroup,
  SegmentedControl
} from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import { usePersistCache } from '@data/hooks/useCache'
import { useInvalidateCache } from '@data/hooks/useDataApi'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { ResourceEditDialogHost, type ResourceEditDialogTarget } from '@renderer/components/resource/dialogs'
import {
  type DynamicVirtualListRef,
  GroupedVirtualList,
  type GroupedVirtualListGroup
} from '@renderer/components/VirtualList'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { useTabs } from '@renderer/hooks/useTabs'
import { mapApiTopicToRendererTopic } from '@renderer/hooks/useTopic'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { cn } from '@renderer/utils'
import type { EntitySearchItem } from '@shared/data/api/schemas/search'
import { ChevronDown, Clock3, CornerDownLeft, Search, X } from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type GlobalMessageSearchPanelItem,
  type GlobalMessageSearchResult,
  type GlobalMessageSearchSourceFilter,
  type GlobalSearchFilter,
  type GlobalSearchPanelGroup,
  type GlobalSearchPanelGroupFooter
} from './globalSearchGroups'
import {
  GlobalSearchMessagePreviewPanel,
  type GlobalSearchMessagePreviewTarget
} from './GlobalSearchMessagePreviewPanel'
import {
  GlobalMessageSearchGroupHeader,
  GlobalMessageSearchRow,
  GlobalSearchGroupFooter,
  GlobalSearchGroupHeader,
  GlobalSearchRecentHint,
  GlobalSearchRow,
  GlobalSearchState
} from './GlobalSearchResults'
import {
  getGlobalSearchFooterItemId,
  getGlobalSearchOptionDomId,
  GLOBAL_MESSAGE_SEARCH_LOAD_MORE_ITEM_ID,
  type GlobalSearchKeyboardItem,
  useGlobalSearchKeyboard
} from './useGlobalSearchKeyboard'
import {
  type GlobalSearchPanelMode,
  type GlobalSearchTimeFilter,
  useGlobalSearchPanelData
} from './useGlobalSearchPanelData'

type GlobalSearchPanelProps = {
  onClose: () => void
}

type GlobalSearchScope = 'all' | 'messages'

// Only one of the two virtual lists is mounted at a time, so they can share one
// listbox id that the search input references via `aria-controls`.
const GLOBAL_SEARCH_LISTBOX_ID = 'global-search-listbox'

const SEARCH_FILTERS: Exclude<GlobalSearchFilter, 'all'>[] = ['topic', 'session', 'assistant', 'agent', 'knowledge']
const MESSAGE_SOURCE_FILTER_BUTTONS: Exclude<GlobalMessageSearchSourceFilter, 'all'>[] = ['topic', 'session']
const SEARCH_SCOPE_CONTROL_CLASS_NAME =
  'h-7 shrink-0 border-border-subtle bg-muted/40 p-0.5 [&_[role=radio]]:h-6 [&_[role=radio]]:px-2 [&_[role=radio]]:text-xs [&_[role=radio]]:leading-none'
const logger = loggerService.withContext('GlobalSearchPanel')
const FILTER_LABEL_KEYS: Record<GlobalSearchFilter, string> = {
  all: 'globalSearch.filters.all',
  topic: 'globalSearch.filters.topic',
  session: 'globalSearch.filters.session',
  assistant: 'globalSearch.filters.assistant',
  agent: 'globalSearch.filters.agent',
  knowledge: 'globalSearch.filters.knowledge'
}
const MESSAGE_SOURCE_FILTER_LABEL_KEYS: Record<GlobalMessageSearchSourceFilter, string> = {
  all: 'globalSearch.messageSearch.sources.all',
  topic: 'globalSearch.messageSearch.sources.topic',
  session: 'globalSearch.messageSearch.sources.session'
}
const TIME_FILTERS: GlobalSearchTimeFilter[] = ['any', 'today', 'week', 'month', 'quarter']
const TIME_FILTER_LABEL_KEYS: Record<GlobalSearchTimeFilter, string> = {
  any: 'globalSearch.timeFilters.any',
  today: 'globalSearch.timeFilters.today',
  week: 'globalSearch.timeFilters.week',
  month: 'globalSearch.timeFilters.month',
  quarter: 'globalSearch.timeFilters.quarter'
}

function getFilterLabelKey(filter: GlobalSearchFilter) {
  return FILTER_LABEL_KEYS[filter]
}

function getTimeFilterLabelKey(filter: GlobalSearchTimeFilter) {
  return TIME_FILTER_LABEL_KEYS[filter]
}

function getTimeFilterAriaLabelKey(mode: GlobalSearchPanelMode) {
  return mode === 'message-search' ? 'globalSearch.timeFilters.messageLabel' : 'globalSearch.timeFilters.label'
}

function getMessageSourceFilterLabelKey(filter: GlobalMessageSearchSourceFilter) {
  return MESSAGE_SOURCE_FILTER_LABEL_KEYS[filter]
}

function getAssistantTargetId(target: EntitySearchItem['target']) {
  return 'assistantId' in target && typeof target.assistantId === 'string' ? target.assistantId : undefined
}

function getAgentTargetId(target: EntitySearchItem['target']) {
  return 'agentId' in target && typeof target.agentId === 'string' ? target.agentId : undefined
}

function getTopicTargetId(target: EntitySearchItem['target']) {
  return 'topicId' in target && typeof target.topicId === 'string' ? target.topicId : undefined
}

function getSessionTargetId(target: EntitySearchItem['target']) {
  return 'sessionId' in target && typeof target.sessionId === 'string' ? target.sessionId : undefined
}

function getKnowledgeBaseTargetId(target: EntitySearchItem['target']) {
  return 'knowledgeBaseId' in target && typeof target.knowledgeBaseId === 'string' ? target.knowledgeBaseId : undefined
}

type GlobalSearchMessageJumpTarget =
  | {
      sourceType: 'topic'
      topicId: string
      messageId: string
    }
  | {
      sourceType: 'session'
      sessionId: string
      messageId: string
    }

function getMessageSearchResultJumpTarget(result: GlobalMessageSearchResult): GlobalSearchMessageJumpTarget {
  if (result.sourceType === 'topic') {
    return {
      sourceType: 'topic',
      topicId: result.topicId,
      messageId: result.messageId
    }
  }

  return {
    sourceType: 'session',
    sessionId: result.sessionId,
    messageId: result.messageId
  }
}

function getPreviewMessageJumpTarget(
  target: GlobalSearchMessagePreviewTarget,
  messageId: string
): GlobalSearchMessageJumpTarget {
  if (target.sourceType === 'topic') {
    return {
      sourceType: 'topic',
      topicId: target.topicId,
      messageId
    }
  }

  return {
    sourceType: 'session',
    sessionId: target.sessionId,
    messageId
  }
}

function getOpenItemLogContext(item: GlobalSearchKeyboardItem) {
  switch (item.kind) {
    case 'footer':
      return { itemKind: item.kind, footerKind: item.footer.kind }
    case 'message':
      return {
        itemKind: item.kind,
        sourceType: item.result.sourceType,
        messageId: item.result.messageId
      }
    case 'recent':
      return { itemKind: item.kind, recentKind: item.recent.kind }
    case 'result':
      return { itemKind: item.kind, resultType: item.result.type }
  }
}

function logOpenFailure(error: unknown, context: Record<string, unknown>) {
  logger.error('Failed to open global search result', error as Error, context)
}

function emitGlobalSearchSelection(eventName: string, payload: unknown, context: Record<string, unknown>) {
  void Promise.resolve(EventEmitter.emit(eventName, payload)).catch((error) => {
    logger.error('Failed to emit global search selection event', error as Error, context)
  })
}

function getGroupedVirtualListRowIndex<TGroup, TItem, TFooter>(
  groups: readonly GroupedVirtualListGroup<TGroup, TItem, TGroup, TFooter>[],
  itemId: string,
  getItemId: (item: TItem) => string,
  getFooterId?: (group: TGroup, footer: TFooter) => string
) {
  let rowIndex = 0

  for (const entry of groups) {
    if (entry.header !== undefined) {
      rowIndex += 1
    }

    for (const item of entry.items) {
      if (getItemId(item) === itemId) return rowIndex
      rowIndex += 1
    }

    if (entry.footer !== undefined) {
      if (getFooterId?.(entry.group, entry.footer) === itemId) return rowIndex
      rowIndex += 1
    }
  }

  return undefined
}

function TimeFilterDropdown({
  timeFilter,
  panelMode,
  onSelect
}: {
  timeFilter: GlobalSearchTimeFilter
  panelMode: GlobalSearchPanelMode
  onSelect: (filter: GlobalSearchTimeFilter) => void
}) {
  const { t } = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-7 gap-1.5 rounded-[8px] px-2 font-medium text-muted-foreground text-xs hover:bg-muted/50 hover:text-foreground"
          aria-label={`${t(getTimeFilterAriaLabelKey(panelMode))}: ${t(getTimeFilterLabelKey(timeFilter))}`}>
          <Clock3 className="size-3.5" />
          <span>{t(getTimeFilterLabelKey(timeFilter))}</span>
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="z-[90] min-w-[132px] rounded-[10px] p-1">
        <DropdownMenuRadioGroup value={timeFilter} onValueChange={(value) => onSelect(value as GlobalSearchTimeFilter)}>
          {TIME_FILTERS.map((filterOption) => (
            <DropdownMenuRadioItem
              key={filterOption}
              value={filterOption}
              className="h-8 rounded-[7px] font-medium text-xs data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground">
              {t(getTimeFilterLabelKey(filterOption))}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function GlobalSearchPanel({ onClose }: GlobalSearchPanelProps) {
  const { t, i18n } = useTranslation()
  const { openTab } = useTabs()
  const chatNav = useConversationNavigation('assistants')
  const agentNav = useConversationNavigation('agents')
  const invalidateCache = useInvalidateCache()
  const inputRef = useRef<HTMLInputElement>(null)
  const messageListRef = useRef<DynamicVirtualListRef>(null)
  const searchListRef = useRef<DynamicVirtualListRef>(null)
  const [query, setQuery] = useState('')
  const [panelMode, setPanelMode] = useState<GlobalSearchPanelMode>('search')
  const deferredQuery = useDeferredValue(query.trim())
  const [filter, setFilter] = useState<GlobalSearchFilter>('all')
  const [timeFilter, setTimeFilter] = useState<GlobalSearchTimeFilter>('any')
  const [messageSourceFilter, setMessageSourceFilter] = useState<GlobalMessageSearchSourceFilter>('all')
  const [expandedSearchGroupIds, setExpandedSearchGroupIds] = useState<ReadonlySet<GlobalSearchPanelGroup['id']>>(
    () => new Set()
  )
  const [expandedMessageParentIds, setExpandedMessageParentIds] = useState<ReadonlySet<string>>(() => new Set())
  const [messagePreviewTarget, setMessagePreviewTarget] = useState<GlobalSearchMessagePreviewTarget | null>(null)
  const [editDialogTarget, setEditDialogTarget] = useState<ResourceEditDialogTarget | null>(null)
  const [recentItems] = usePersistCache('ui.global_search.recent_items')
  const [userName] = usePreference('app.user.name')
  const {
    error,
    groups,
    hasMoreMessageResults,
    hasQuery,
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
  } = useGlobalSearchPanelData({
    deferredQuery,
    expandedMessageParentIds,
    expandedSearchGroupIds,
    filter,
    messageSourceFilter,
    panelMode,
    recentItems,
    timeFilter
  })
  const { activeItemId, keyboardItems, messageSelectableItems, moveActiveItem, selectableItems, setActiveItemId } =
    useGlobalSearchKeyboard({
      groups,
      hasMoreMessageResults,
      isMessageSearchMode,
      messageGroups,
      panelMode
    })
  const shouldShowRecentHint =
    !hasQuery && !isLoading && !error && selectableItems.length > 0 && selectableItems.length < 3
  const messageVirtualGroupsWithLoadMore = useMemo(() => {
    if (!hasMoreMessageResults || messageVirtualGroups.length === 0) {
      return messageVirtualGroups
    }

    const lastGroupIndex = messageVirtualGroups.length - 1

    return messageVirtualGroups.map((entry, index) =>
      index === lastGroupIndex ? { ...entry, footer: true as const } : entry
    )
  }, [hasMoreMessageResults, messageVirtualGroups])

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    setExpandedSearchGroupIds(new Set())
    setExpandedMessageParentIds(new Set())
    setMessagePreviewTarget(null)
  }, [deferredQuery, filter, updatedAtFrom])

  const handleSearchScopeChange = useCallback((nextScope: GlobalSearchScope) => {
    setPanelMode(nextScope === 'messages' ? 'message-search' : 'search')
    setMessagePreviewTarget(null)
  }, [])

  const openTopic = useCallback(
    async (topicId: string) => {
      const apiTopic = await dataApiService.get(`/topics/${topicId}`)
      const topic = mapApiTopicToRendererTopic(apiTopic)
      chatNav.openConversationTab(topic.id)
      window.requestAnimationFrame(() => {
        emitGlobalSearchSelection(EVENT_NAMES.GLOBAL_SEARCH_SELECT_TOPIC, topic, {
          eventName: EVENT_NAMES.GLOBAL_SEARCH_SELECT_TOPIC,
          topicId
        })
      })
      onClose()
    },
    [onClose, chatNav]
  )

  const openSession = useCallback(
    (sessionId: string) => {
      agentNav.openConversationTab(sessionId)
      window.requestAnimationFrame(() => {
        emitGlobalSearchSelection(EVENT_NAMES.GLOBAL_SEARCH_SELECT_AGENT_SESSION, sessionId, {
          eventName: EVENT_NAMES.GLOBAL_SEARCH_SELECT_AGENT_SESSION,
          sessionId
        })
      })
      onClose()
    },
    [onClose, agentNav]
  )

  const openTopicMessageById = useCallback(
    async (topicId: string, messageId: string) => {
      const apiTopic = await dataApiService.get(`/topics/${topicId}`)
      const messagePathEndpoint = `/topics/${topicId}/path` as const
      const messagePath = await dataApiService.get(messagePathEndpoint, {
        query: { nodeId: messageId }
      })
      const activeNodeId = Array.isArray(messagePath)
        ? (messagePath[messagePath.length - 1]?.id ?? messageId)
        : messageId
      const topic = {
        ...mapApiTopicToRendererTopic(apiTopic),
        activeNodeId
      }

      await dataApiService.put(`/topics/${topicId}/active-node`, { body: { nodeId: activeNodeId } })
      await invalidateCache([`/topics/${topicId}/messages`, `/topics/${topicId}/tree`])
      chatNav.openConversationTab(topic.id)
      window.requestAnimationFrame(() => {
        emitGlobalSearchSelection(
          EVENT_NAMES.GLOBAL_SEARCH_SELECT_TOPIC_MESSAGE,
          { topic, messageId },
          {
            eventName: EVENT_NAMES.GLOBAL_SEARCH_SELECT_TOPIC_MESSAGE,
            messageId,
            topicId
          }
        )
      })
      onClose()
    },
    [invalidateCache, onClose, chatNav]
  )

  const openSessionMessageById = useCallback(
    async (sessionId: string, messageId: string) => {
      await dataApiService.get(`/agent-sessions/${sessionId}`)
      await invalidateCache([
        '/agent-sessions',
        `/agent-sessions/${sessionId}`,
        `/agent-sessions/${sessionId}/messages`
      ])
      agentNav.openConversationTab(sessionId)
      window.requestAnimationFrame(() => {
        emitGlobalSearchSelection(
          EVENT_NAMES.GLOBAL_SEARCH_SELECT_AGENT_SESSION_MESSAGE,
          { sessionId, messageId },
          {
            eventName: EVENT_NAMES.GLOBAL_SEARCH_SELECT_AGENT_SESSION_MESSAGE,
            messageId,
            sessionId
          }
        )
      })
      onClose()
    },
    [invalidateCache, onClose, agentNav]
  )

  const openKnowledgeBase = useCallback(
    (knowledgeBaseId: string) => {
      openTab('/app/knowledge')
      window.requestAnimationFrame(() => {
        emitGlobalSearchSelection(EVENT_NAMES.GLOBAL_SEARCH_SELECT_KNOWLEDGE_BASE, knowledgeBaseId, {
          eventName: EVENT_NAMES.GLOBAL_SEARCH_SELECT_KNOWLEDGE_BASE,
          knowledgeBaseId
        })
      })
      onClose()
    },
    [onClose, openTab]
  )

  const jumpToMessage = useCallback(
    (target: GlobalSearchMessageJumpTarget) => {
      if (target.sourceType === 'topic') {
        void openTopicMessageById(target.topicId, target.messageId).catch((error) => {
          logOpenFailure(error, target)
          window.toast?.error(t('globalSearch.open_failed'))
        })
        return
      }

      void openSessionMessageById(target.sessionId, target.messageId).catch((error) => {
        logOpenFailure(error, target)
        window.toast?.error(t('globalSearch.open_failed'))
      })
    },
    [openSessionMessageById, openTopicMessageById, t]
  )

  const openMessagePanelItem = useCallback((item: GlobalMessageSearchPanelItem) => {
    if (item.kind === 'more') {
      setExpandedMessageParentIds((current) => {
        const next = new Set(current)
        next.add(item.parentId)
        return next
      })
      return
    }

    if (item.result.sourceType === 'topic') {
      setMessagePreviewTarget({
        sourceType: 'topic',
        topicId: item.result.topicId,
        title: item.result.topicName,
        messageId: item.result.messageId,
        assistantId: item.result.topicAssistantId,
        createdAt: item.result.topicCreatedAt,
        updatedAt: item.result.topicUpdatedAt
      })
      return
    }

    setMessagePreviewTarget({
      sourceType: 'session',
      sessionId: item.result.sessionId,
      title: item.result.sessionName,
      messageId: item.result.messageId,
      agentId: item.result.agentId,
      createdAt: item.result.createdAt
    })
  }, [])

  const jumpMessagePanelItem = useCallback(
    (item: GlobalMessageSearchPanelItem) => {
      if (item.kind === 'more') {
        openMessagePanelItem(item)
        return
      }

      jumpToMessage(getMessageSearchResultJumpTarget(item.result))
    },
    [jumpToMessage, openMessagePanelItem]
  )

  const openMessagePreviewMessage = useCallback(
    (messageId: string) => {
      if (!messagePreviewTarget) return

      jumpToMessage(getPreviewMessageJumpTarget(messagePreviewTarget, messageId))
    },
    [jumpToMessage, messagePreviewTarget]
  )

  const openGlobalSearchFooter = useCallback((footer: GlobalSearchPanelGroupFooter) => {
    if (footer.kind === 'expand-results') {
      setExpandedSearchGroupIds((current) => {
        const next = new Set(current)
        next.add(footer.groupId)
        return next
      })
      return
    }

    setMessageSourceFilter('all')
    setMessagePreviewTarget(null)
    setPanelMode('message-search')
  }, [])

  const handleLoadMoreMessageResults = useCallback(() => {
    if (isLoadingMoreMessageResults) return
    loadMoreMessageResults()
  }, [isLoadingMoreMessageResults, loadMoreMessageResults])

  const openPanelItem = useCallback(
    async (item: GlobalSearchKeyboardItem) => {
      try {
        if (item.kind === 'footer') {
          openGlobalSearchFooter(item.footer)
          return
        }

        if (item.kind === 'message') {
          setMessageSourceFilter('all')
          setPanelMode('message-search')
          openMessagePanelItem(item)
          return
        }

        if (item.kind === 'recent') {
          switch (item.recent.kind) {
            case 'route':
              openTab(item.recent.url, { title: item.recent.title, icon: item.recent.icon })
              onClose()
              return
            case 'topic':
              await openTopic(item.recent.topicId)
              return
            case 'session':
              openSession(item.recent.sessionId)
              return
          }
        }

        const result = item.result

        switch (result.type) {
          case 'assistant': {
            const assistantId = getAssistantTargetId(result.target)
            if (!assistantId) return
            setEditDialogTarget({ kind: 'assistant', id: assistantId })
            return
          }
          case 'agent': {
            const agentId = getAgentTargetId(result.target)
            if (!agentId) return
            setEditDialogTarget({ kind: 'agent', id: agentId })
            return
          }
          case 'topic': {
            const topicId = getTopicTargetId(result.target)
            if (!topicId) return
            await openTopic(topicId)
            return
          }
          case 'session': {
            const sessionId = getSessionTargetId(result.target)
            if (!sessionId) return
            openSession(sessionId)
            return
          }
          case 'knowledge-base': {
            const knowledgeBaseId = getKnowledgeBaseTargetId(result.target)
            if (!knowledgeBaseId) return
            openKnowledgeBase(knowledgeBaseId)
            return
          }
          default:
            return
        }
      } catch (error) {
        logOpenFailure(error, getOpenItemLogContext(item))
        window.toast?.error(t('globalSearch.open_failed'))
      }
    },
    [onClose, openGlobalSearchFooter, openKnowledgeBase, openMessagePanelItem, openSession, openTab, openTopic, t]
  )

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      // IME candidate confirmation still emits keydown; do not let panel shortcuts intercept it.
      // oxlint-disable-next-line no-deprecated
      if (event.nativeEvent.isComposing || event.keyCode === 229) return

      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        moveActiveItem(1)
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        moveActiveItem(-1)
        return
      }

      if (event.key === 'Enter') {
        const item = keyboardItems.find((candidate) => candidate.id === activeItemId)
        if (!item) return
        event.preventDefault()
        if (isMessageSearchMode) {
          if (item.kind === 'message-load-more') {
            handleLoadMoreMessageResults()
            return
          }
          openMessagePanelItem(item as GlobalMessageSearchPanelItem)
          return
        }
        void openPanelItem(item as GlobalSearchKeyboardItem)
      }
    },
    [
      activeItemId,
      handleLoadMoreMessageResults,
      isMessageSearchMode,
      keyboardItems,
      moveActiveItem,
      onClose,
      openMessagePanelItem,
      openPanelItem
    ]
  )

  const handleFilterSelect = useCallback((nextFilter: Exclude<GlobalSearchFilter, 'all'>) => {
    setFilter((current) => (current === nextFilter ? 'all' : nextFilter))
  }, [])

  const handleTimeFilterSelect = useCallback((nextFilter: GlobalSearchTimeFilter) => {
    setTimeFilter(nextFilter)
    setMessagePreviewTarget(null)
  }, [])

  const handleMessageSourceFilterSelect = useCallback((nextFilter: Exclude<GlobalMessageSearchSourceFilter, 'all'>) => {
    setMessageSourceFilter((current) => (current === nextFilter ? 'all' : nextFilter))
    setExpandedMessageParentIds(new Set())
    setMessagePreviewTarget(null)
  }, [])

  const showEmptyState = !isLoading && !error && selectableItems.length === 0
  const showMessageEmptyState =
    !isMessageLoading && !messageError && (hasQuery ? messageSelectableItems.length === 0 : true)
  const showSearchControls = hasQuery || isMessageSearchMode
  const isSearchListboxVisible = !isMessageSearchMode && !(isLoading && hasQuery) && !error && !showEmptyState
  const isMessageListboxVisible =
    isMessageSearchMode &&
    !messagePreviewTarget &&
    !(isMessageLoading && hasQuery) &&
    !messageError &&
    !showMessageEmptyState
  const isListboxVisible = isSearchListboxVisible || isMessageListboxVisible
  const activeMessageRowIndex = useMemo(() => {
    if (!isMessageListboxVisible || !activeItemId) return undefined

    return getGroupedVirtualListRowIndex(
      messageVirtualGroupsWithLoadMore,
      activeItemId,
      (item) => item.id,
      () => GLOBAL_MESSAGE_SEARCH_LOAD_MORE_ITEM_ID
    )
  }, [activeItemId, isMessageListboxVisible, messageVirtualGroupsWithLoadMore])
  const activeSearchRowIndex = useMemo(() => {
    if (!isSearchListboxVisible || !activeItemId) return undefined

    return getGroupedVirtualListRowIndex(
      virtualGroups,
      activeItemId,
      (item) => item.id,
      (group, footer) => getGlobalSearchFooterItemId(group.id, footer)
    )
  }, [activeItemId, isSearchListboxVisible, virtualGroups])

  useEffect(() => {
    if (activeMessageRowIndex === undefined) return

    messageListRef.current?.scrollToIndex(activeMessageRowIndex, { align: 'auto' })
  }, [activeMessageRowIndex])

  useEffect(() => {
    if (activeSearchRowIndex === undefined) return

    searchListRef.current?.scrollToIndex(activeSearchRowIndex, { align: 'auto' })
  }, [activeSearchRowIndex])

  const messageResultsContent =
    isMessageLoading && hasQuery ? (
      <GlobalSearchState label={t('common.loading')} />
    ) : messageError ? (
      <GlobalSearchState label={t('globalSearch.error')} />
    ) : showMessageEmptyState ? (
      <GlobalSearchState label={hasQuery ? t('common.no_results') : t('globalSearch.messageSearch.hint')} />
    ) : (
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1">
          <GroupedVirtualList
            ref={messageListRef}
            role="listbox"
            scrollerProps={{ id: GLOBAL_SEARCH_LISTBOX_ID }}
            groups={messageVirtualGroupsWithLoadMore}
            estimateGroupHeaderSize={() => 32}
            estimateItemSize={(item) => {
              if (item.kind === 'more') return 36
              return 44
            }}
            estimateGroupFooterSize={() => 48}
            className="pt-2 pb-2"
            renderGroupHeader={(group) => <GlobalMessageSearchGroupHeader group={group} />}
            renderGroupFooter={() => {
              const active = activeItemId === GLOBAL_MESSAGE_SEARCH_LOAD_MORE_ITEM_ID

              return (
                <div className="h-12 px-5 pt-2">
                  <Button
                    type="button"
                    id={getGlobalSearchOptionDomId(GLOBAL_MESSAGE_SEARCH_LOAD_MORE_ITEM_ID)}
                    role="option"
                    aria-selected={active}
                    aria-disabled={isLoadingMoreMessageResults}
                    variant="ghost"
                    disabled={isLoadingMoreMessageResults}
                    onMouseEnter={() => setActiveItemId(GLOBAL_MESSAGE_SEARCH_LOAD_MORE_ITEM_ID)}
                    onClick={handleLoadMoreMessageResults}
                    className={cn(
                      'h-8 w-full rounded-[8px] font-medium text-xs hover:bg-muted/50 hover:text-foreground',
                      active ? 'bg-muted/60 text-accent-foreground' : 'text-muted-foreground'
                    )}>
                    {isLoadingMoreMessageResults
                      ? t('common.loading')
                      : t('globalSearch.showMore', { count: messageLoadMoreCount })}
                  </Button>
                </div>
              )
            }}
            renderItem={(item) => (
              <GlobalMessageSearchRow
                item={item}
                active={item.id === activeItemId}
                language={i18n.language}
                query={deferredQuery}
                userName={userName}
                onMouseEnter={() => setActiveItemId(item.id)}
                onOpen={() => openMessagePanelItem(item)}
                onJump={() => jumpMessagePanelItem(item)}
              />
            )}
          />
        </div>
      </div>
    )

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 px-5 pt-4 pb-2">
        <div className="relative">
          <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-4 size-5 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              const nextQuery = event.target.value.trimStart()
              setQuery(nextQuery)
              setPanelMode((current) => (!nextQuery ? 'search' : current))
              setMessagePreviewTarget(null)
            }}
            onKeyDown={handleInputKeyDown}
            placeholder={t('globalSearch.placeholder')}
            aria-label={t('globalSearch.placeholder')}
            role="combobox"
            aria-expanded={isListboxVisible}
            aria-controls={isListboxVisible ? GLOBAL_SEARCH_LISTBOX_ID : undefined}
            aria-activedescendant={
              isListboxVisible && activeItemId ? getGlobalSearchOptionDomId(activeItemId) : undefined
            }
            spellCheck={false}
            className="h-11 rounded-[22px] border-border-subtle bg-muted/20 pr-12 pl-12 text-[15px] shadow-none placeholder:text-muted-foreground focus-visible:ring-1"
          />
          {query && (
            <button
              type="button"
              aria-label={t('globalSearch.clear')}
              onClick={() => {
                setQuery('')
                setPanelMode('search')
                setMessagePreviewTarget(null)
              }}
              className="-translate-y-1/2 absolute top-1/2 right-3 flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <X className="size-4" />
            </button>
          )}
        </div>

        {showSearchControls && (
          <div className="mt-3 flex h-7 items-center gap-2">
            <SegmentedControl<GlobalSearchScope>
              size="sm"
              aria-label={t('globalSearch.filters.label')}
              value={isMessageSearchMode ? 'messages' : 'all'}
              onValueChange={handleSearchScopeChange}
              className={SEARCH_SCOPE_CONTROL_CLASS_NAME}
              options={[
                { value: 'all', label: t('globalSearch.filters.all') },
                { value: 'messages', label: t('globalSearch.messageSearch.entry') }
              ]}
            />
            {isMessageSearchMode ? (
              <>
                {MESSAGE_SOURCE_FILTER_BUTTONS.map((filterOption) => (
                  <Button
                    key={filterOption}
                    type="button"
                    variant="ghost"
                    aria-label={`${t('globalSearch.messageSearch.sourceLabel')}: ${t(
                      getMessageSourceFilterLabelKey(filterOption)
                    )}`}
                    aria-pressed={messageSourceFilter === filterOption}
                    onClick={() => handleMessageSourceFilterSelect(filterOption)}
                    className={cn(
                      'h-7 rounded-[8px] px-2 font-medium text-muted-foreground text-xs hover:bg-muted/50 hover:text-foreground',
                      messageSourceFilter === filterOption && 'bg-muted text-foreground hover:bg-muted'
                    )}>
                    {t(getMessageSourceFilterLabelKey(filterOption))}
                  </Button>
                ))}
                <TimeFilterDropdown timeFilter={timeFilter} panelMode={panelMode} onSelect={handleTimeFilterSelect} />
              </>
            ) : (
              <>
                {SEARCH_FILTERS.map((filterOption) => (
                  <Button
                    key={filterOption}
                    type="button"
                    variant="ghost"
                    aria-label={`${t('globalSearch.filters.label')}: ${t(getFilterLabelKey(filterOption))}`}
                    aria-pressed={filter === filterOption}
                    onClick={() => handleFilterSelect(filterOption)}
                    className={cn(
                      'h-7 rounded-[8px] px-2 font-medium text-muted-foreground text-xs hover:bg-muted/50 hover:text-foreground',
                      filter === filterOption && 'bg-muted text-foreground hover:bg-muted'
                    )}>
                    {t(getFilterLabelKey(filterOption))}
                  </Button>
                ))}
                <TimeFilterDropdown timeFilter={timeFilter} panelMode={panelMode} onSelect={handleTimeFilterSelect} />
              </>
            )}
          </div>
        )}
      </div>

      <div className={cn('min-h-0 flex-1', showSearchControls && 'border-border-subtle border-t')}>
        {isMessageSearchMode ? (
          messagePreviewTarget ? (
            <GlobalSearchMessagePreviewPanel
              className="h-full min-w-0"
              searchQuery={deferredQuery}
              target={messagePreviewTarget}
              onClose={() => setMessagePreviewTarget(null)}
              onOpenMessage={openMessagePreviewMessage}
            />
          ) : (
            messageResultsContent
          )
        ) : isLoading && hasQuery ? (
          <GlobalSearchState label={t('common.loading')} />
        ) : error ? (
          <GlobalSearchState label={t('globalSearch.error')} />
        ) : showEmptyState ? (
          <GlobalSearchState label={hasQuery ? t('common.no_results') : t('globalSearch.recent_hint')} />
        ) : (
          <div className="relative h-full">
            <GroupedVirtualList
              ref={searchListRef}
              role="listbox"
              scrollerProps={{ id: GLOBAL_SEARCH_LISTBOX_ID }}
              groups={virtualGroups}
              estimateGroupHeaderSize={() => 28}
              estimateItemSize={(item) => {
                if (item.kind === 'message-parent') return 32
                if (item.kind === 'message') return 44
                return 52
              }}
              estimateGroupFooterSize={() => 36}
              className="pt-1 pb-2"
              renderGroupHeader={(group) => <GlobalSearchGroupHeader group={group} />}
              renderGroupFooter={(footer, group) => {
                const footerId = getGlobalSearchFooterItemId(group.id, footer)
                return (
                  <GlobalSearchGroupFooter
                    footer={footer}
                    active={footerId === activeItemId}
                    domId={getGlobalSearchOptionDomId(footerId)}
                    onMouseEnter={() => setActiveItemId(footerId)}
                    onOpen={() => openGlobalSearchFooter(footer)}
                  />
                )
              }}
              renderItem={(item) =>
                item.kind === 'message-parent' ? (
                  <GlobalMessageSearchGroupHeader group={item.group} inset="nested" />
                ) : item.kind === 'message' ? (
                  <GlobalMessageSearchRow
                    item={item}
                    active={item.id === activeItemId}
                    inset="nested"
                    language={i18n.language}
                    query={deferredQuery}
                    userName={userName}
                    onMouseEnter={() => setActiveItemId(item.id)}
                    onOpen={() => void openPanelItem(item)}
                    onJump={() => jumpMessagePanelItem(item)}
                  />
                ) : (
                  <GlobalSearchRow
                    item={item}
                    active={item.id === activeItemId}
                    language={i18n.language}
                    query={deferredQuery}
                    onMouseEnter={() => setActiveItemId(item.id)}
                    onOpen={() => void openPanelItem(item)}
                  />
                )
              }
            />
            {shouldShowRecentHint && (
              <GlobalSearchRecentHint
                label={t('globalSearch.recent_hint')}
                offset={4 + 28 + selectableItems.length * 52 + 8}
              />
            )}
          </div>
        )}
      </div>

      {showSearchControls && (
        <div className="flex h-10 shrink-0 items-center gap-4 border-border-subtle border-t bg-background/95 px-5 text-muted-foreground text-xs">
          <KbdGroup>
            <Kbd className="bg-muted text-muted-foreground shadow-none">↑↓</Kbd>
            <span>{t('globalSearch.keyboard.select')}</span>
          </KbdGroup>
          <KbdGroup>
            <Kbd className="bg-muted text-muted-foreground shadow-none">
              <CornerDownLeft className="size-3" />
            </Kbd>
            <span>{t('common.open')}</span>
          </KbdGroup>
          <KbdGroup>
            <Kbd className="bg-muted text-muted-foreground shadow-none">ESC</Kbd>
            <span>{t('common.close')}</span>
          </KbdGroup>
        </div>
      )}
      <ResourceEditDialogHost
        target={editDialogTarget}
        onOpenChange={(open) => {
          if (!open) setEditDialogTarget(null)
        }}
      />
    </div>
  )
}
