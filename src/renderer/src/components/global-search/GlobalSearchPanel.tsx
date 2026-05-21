import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Kbd,
  KbdGroup,
  SegmentedControl
} from '@cherrystudio/ui'
import { cacheService } from '@data/CacheService'
import { dataApiService } from '@data/DataApiService'
import { usePersistCache } from '@data/hooks/useCache'
import { useInvalidateCache, useQuery } from '@data/hooks/useDataApi'
import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { GroupedVirtualList, type GroupedVirtualListGroup } from '@renderer/components/VirtualList'
import {
  getDefaultSidebarIconPreferences,
  getRequiredSidebarIconsVisible,
  getSidebarMenuPath,
  REQUIRED_SIDEBAR_ICONS,
  sanitizeSidebarIcons,
  SIDEBAR_ICON_ORDER
} from '@renderer/config/sidebar'
import { useSettings } from '@renderer/hooks/useSettings'
import { useTabs } from '@renderer/hooks/useTabs'
import { mapApiTopicToRendererTopic } from '@renderer/hooks/useTopic'
import { buildLibraryEditSearch, buildLibraryRouteUrl } from '@renderer/pages/library/routeSearch'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { cn } from '@renderer/utils'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import type { GlobalSearchItem } from '@shared/data/api/schemas/globalSearch'
import type { SearchMessageResult } from '@shared/data/api/schemas/messages'
import type { SessionSearchMessageResult } from '@shared/data/api/schemas/sessions'
import type { SidebarIcon } from '@shared/data/preference/preferenceTypes'
import type { KeywordMatchMode } from '@shared/utils/keywordSearch'
import dayjs from 'dayjs'
import { ChevronDown, Clock3, CornerDownLeft, Search, X } from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  buildGlobalMessageSearchGroups,
  buildGlobalSearchGroups,
  getGlobalSearchTypes,
  getMessageSearchSources,
  type GlobalMessageSearchPanelGroup,
  type GlobalMessageSearchPanelItem,
  type GlobalMessageSearchSourceFilter,
  type GlobalSearchFilter,
  type GlobalSearchPanelGroup,
  type GlobalSearchPanelItem
} from './globalSearchGroups'
import { GlobalSearchQuickAppManager, GlobalSearchQuickAppsBar } from './GlobalSearchQuickApps'
import {
  GlobalMessageSearchGroupHeader,
  GlobalMessageSearchRow,
  GlobalSearchGroupHeader,
  GlobalSearchRecentHint,
  GlobalSearchRow,
  GlobalSearchState
} from './GlobalSearchResults'

type GlobalSearchPanelProps = {
  hideQuickApps?: boolean
  onClose: () => void
}

type GlobalSearchPanelMode = 'search' | 'menu-manager' | 'message-search'
type GlobalSearchScope = 'all' | 'messages'
type GlobalSearchTimeFilter = 'any' | 'today' | 'week' | 'month' | 'quarter'
type GlobalMessageSearchMatchMode = KeywordMatchMode

const SEARCH_FILTERS: Exclude<GlobalSearchFilter, 'all'>[] = ['topic', 'session', 'assistant', 'agent', 'knowledge']
const MESSAGE_SOURCE_FILTER_BUTTONS: Exclude<GlobalMessageSearchSourceFilter, 'all'>[] = ['topic', 'session']
const MESSAGE_MATCH_MODES: GlobalMessageSearchMatchMode[] = ['whole-word', 'substring']
const SEARCH_SCOPE_CONTROL_CLASS_NAME =
  'h-7 shrink-0 border-border-subtle bg-muted/40 p-0.5 [&_[role=radio]]:h-6 [&_[role=radio]]:px-2 [&_[role=radio]]:text-xs [&_[role=radio]]:leading-none'
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
const MESSAGE_MATCH_MODE_LABEL_KEYS: Record<GlobalMessageSearchMatchMode, string> = {
  'whole-word': 'globalSearch.messageSearch.matchModes.wholeWord',
  substring: 'globalSearch.messageSearch.matchModes.substring'
}
const TIME_FILTERS: GlobalSearchTimeFilter[] = ['any', 'today', 'week', 'month', 'quarter']
const TIME_FILTER_LABEL_KEYS: Record<GlobalSearchTimeFilter, string> = {
  any: 'globalSearch.timeFilters.any',
  today: 'globalSearch.timeFilters.today',
  week: 'globalSearch.timeFilters.week',
  month: 'globalSearch.timeFilters.month',
  quarter: 'globalSearch.timeFilters.quarter'
}
const SIDEBAR_ICON_PREFERENCE_KEYS = {
  visible: 'ui.sidebar.icons.visible',
  invisible: 'ui.sidebar.icons.invisible'
} as const

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

function getMessageMatchModeLabelKey(matchMode: GlobalMessageSearchMatchMode) {
  return MESSAGE_MATCH_MODE_LABEL_KEYS[matchMode]
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

function getSortedShortcutSidebarIcons(
  orderedIcons: readonly SidebarIcon[],
  visibleIcons: readonly SidebarIcon[] | undefined
) {
  const visibleIconSet = new Set<SidebarIcon>(getRequiredSidebarIconsVisible(visibleIcons))
  return orderedIcons.filter((icon) => visibleIconSet.has(icon))
}

function getPreferenceOrderedSidebarIcons(
  visibleIcons: readonly SidebarIcon[] | undefined,
  invisibleIcons: readonly SidebarIcon[] | undefined
) {
  const orderedIcons: SidebarIcon[] = []
  const seen = new Set<SidebarIcon>()

  const addIcons = (icons: readonly SidebarIcon[] | undefined) => {
    for (const icon of sanitizeSidebarIcons(icons)) {
      if (seen.has(icon)) continue
      orderedIcons.push(icon)
      seen.add(icon)
    }
  }

  addIcons(visibleIcons)
  addIcons(invisibleIcons)
  addIcons(SIDEBAR_ICON_ORDER)

  return orderedIcons
}

function getSidebarIconPreferencesFromOrderedIcons({
  orderedIcons,
  visibleIcons
}: {
  orderedIcons: readonly SidebarIcon[]
  visibleIcons: ReadonlySet<SidebarIcon>
}) {
  const requiredIcons = new Set(REQUIRED_SIDEBAR_ICONS)
  const normalizedOrder = getPreferenceOrderedSidebarIcons(orderedIcons, undefined)

  return {
    visible: normalizedOrder.filter((icon) => visibleIcons.has(icon) || requiredIcons.has(icon)),
    invisible: normalizedOrder.filter((icon) => !visibleIcons.has(icon) && !requiredIcons.has(icon))
  }
}

function moveSidebarIcon(icons: readonly SidebarIcon[], oldIndex: number, newIndex: number) {
  if (oldIndex === newIndex || oldIndex < 0 || newIndex < 0 || oldIndex >= icons.length || newIndex >= icons.length) {
    return icons
  }

  const nextIcons = [...icons]
  const [movedIcon] = nextIcons.splice(oldIndex, 1)
  if (!movedIcon) return icons

  nextIcons.splice(newIndex, 0, movedIcon)
  return nextIcons
}

function getAssistantTargetId(target: GlobalSearchItem['target']) {
  return 'assistantId' in target && typeof target.assistantId === 'string' ? target.assistantId : undefined
}

function getAgentTargetId(target: GlobalSearchItem['target']) {
  return 'agentId' in target && typeof target.agentId === 'string' ? target.agentId : undefined
}

function getTopicTargetId(target: GlobalSearchItem['target']) {
  return 'topicId' in target && typeof target.topicId === 'string' ? target.topicId : undefined
}

function getSessionTargetId(target: GlobalSearchItem['target']) {
  return 'sessionId' in target && typeof target.sessionId === 'string' ? target.sessionId : undefined
}

function getKnowledgeBaseTargetId(target: GlobalSearchItem['target']) {
  return 'knowledgeBaseId' in target && typeof target.knowledgeBaseId === 'string' ? target.knowledgeBaseId : undefined
}

export function GlobalSearchPanel({ hideQuickApps = false, onClose }: GlobalSearchPanelProps) {
  const { t, i18n } = useTranslation()
  const { openTab } = useTabs()
  const { defaultPaintingProvider } = useSettings()
  const invalidateCache = useInvalidateCache()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [panelMode, setPanelMode] = useState<GlobalSearchPanelMode>('search')
  const deferredQuery = useDeferredValue(query.trim())
  const [filter, setFilter] = useState<GlobalSearchFilter>('all')
  const [timeFilter, setTimeFilter] = useState<GlobalSearchTimeFilter>('any')
  const [messageSourceFilter, setMessageSourceFilter] = useState<GlobalMessageSearchSourceFilter>('all')
  const [messageMatchMode, setMessageMatchMode] = useState<GlobalMessageSearchMatchMode>('whole-word')
  const [expandedMessageParentIds, setExpandedMessageParentIds] = useState<ReadonlySet<string>>(() => new Set())
  const [activeItemId, setActiveItemId] = useState<string | undefined>()
  const [recentItems] = usePersistCache('ui.global_search.recent_items')
  const [userName] = usePreference('app.user.name')
  const [sidebarIconPreferences, setSidebarIconPreferences] = useMultiplePreferences(SIDEBAR_ICON_PREFERENCE_KEYS)
  const visibleSidebarIcons = sidebarIconPreferences.visible
  const hasQuery = deferredQuery.length > 0
  const isMessageSearchMode = panelMode === 'message-search'
  const searchTypes = useMemo(() => getGlobalSearchTypes(filter), [filter])
  const messageSearchSources = useMemo(() => getMessageSearchSources(messageSourceFilter), [messageSourceFilter])
  const shouldSearchTopicMessages = messageSearchSources.includes('topic')
  const shouldSearchSessionMessages = messageSearchSources.includes('session')
  const updatedAtFrom = useMemo(() => getUpdatedAtFromForTimeFilter(timeFilter), [timeFilter])
  const messageSearchQuery = useMemo(
    () => ({
      q: deferredQuery,
      matchMode: messageMatchMode,
      limit: 50,
      ...(updatedAtFrom ? { createdAtFrom: updatedAtFrom } : {})
    }),
    [deferredQuery, messageMatchMode, updatedAtFrom]
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
    data: topicMessageData,
    isLoading: isTopicMessageLoading,
    error: topicMessageError
  } = useQuery('/messages/search', {
    enabled: hasQuery && isMessageSearchMode && shouldSearchTopicMessages,
    query: messageSearchQuery
  })
  const {
    data: sessionMessageData,
    isLoading: isSessionMessageLoading,
    error: sessionMessageError
  } = useQuery('/sessions/messages/search', {
    enabled: hasQuery && isMessageSearchMode && shouldSearchSessionMessages,
    query: messageSearchQuery
  })
  const isMessageLoading =
    (shouldSearchTopicMessages && isTopicMessageLoading) || (shouldSearchSessionMessages && isSessionMessageLoading)
  const messageError = topicMessageError ?? sessionMessageError

  const { data, isLoading, error } = useQuery('/global-search', {
    enabled: hasQuery && panelMode === 'search',
    query: searchQuery
  })

  const groups = useMemo(
    () =>
      buildGlobalSearchGroups({
        query: deferredQuery,
        filter,
        recentItems,
        response: data
      }),
    [data, deferredQuery, filter, recentItems]
  )

  const messageGroups = useMemo(() => {
    const items = [
      ...(shouldSearchTopicMessages
        ? (topicMessageData?.items ?? []).map((item) => ({ ...item, sourceType: 'topic' as const }))
        : []),
      ...(shouldSearchSessionMessages
        ? (sessionMessageData?.items ?? []).map((item) => ({ ...item, sourceType: 'session' as const }))
        : [])
    ].sort((a, b) => {
      const timeA = Date.parse(a.createdAt) || 0
      const timeB = Date.parse(b.createdAt) || 0
      if (timeA !== timeB) return timeB - timeA
      if (a.sourceType !== b.sourceType) return a.sourceType === 'topic' ? -1 : 1
      return b.messageId.localeCompare(a.messageId)
    })

    return buildGlobalMessageSearchGroups({
      expandedParentIds: expandedMessageParentIds,
      items
    })
  }, [
    expandedMessageParentIds,
    sessionMessageData?.items,
    shouldSearchSessionMessages,
    shouldSearchTopicMessages,
    topicMessageData?.items
  ])

  const virtualGroups = useMemo<ReadonlyArray<GroupedVirtualListGroup<GlobalSearchPanelGroup, GlobalSearchPanelItem>>>(
    () =>
      groups.map((group) => ({
        group,
        header: group,
        items: group.items
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

  const selectableItems = useMemo(() => {
    if (panelMode !== 'search') return []
    return groups.flatMap((group) => group.items)
  }, [groups, panelMode])
  const messageSelectableItems = useMemo(() => messageGroups.flatMap((group) => group.items), [messageGroups])
  const keyboardItems = isMessageSearchMode ? messageSelectableItems : selectableItems
  const shouldShowRecentHint =
    !hasQuery && !isLoading && !error && selectableItems.length > 0 && selectableItems.length < 3
  const sidebarPreferenceManagerIcons = useMemo(
    () => getPreferenceOrderedSidebarIcons(visibleSidebarIcons, sidebarIconPreferences.invisible),
    [sidebarIconPreferences.invisible, visibleSidebarIcons]
  )
  const visibleSidebarIconSet = useMemo(
    () => new Set<SidebarIcon>(getRequiredSidebarIconsVisible(visibleSidebarIcons)),
    [visibleSidebarIcons]
  )
  const shortcutSidebarIcons = useMemo(
    () => getSortedShortcutSidebarIcons(sidebarPreferenceManagerIcons, visibleSidebarIcons),
    [sidebarPreferenceManagerIcons, visibleSidebarIcons]
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setExpandedMessageParentIds(new Set())
  }, [deferredQuery, messageSourceFilter, updatedAtFrom])

  useEffect(() => {
    if (keyboardItems.length === 0) {
      setActiveItemId(undefined)
      return
    }

    setActiveItemId((current) =>
      current && keyboardItems.some((item) => item.id === current) ? current : keyboardItems[0].id
    )
  }, [keyboardItems])

  const persistSidebarIconPreferences = useCallback(
    async ({ visible, invisible }: { visible: SidebarIcon[]; invisible: SidebarIcon[] }) => {
      try {
        await setSidebarIconPreferences({ visible, invisible })
      } catch {
        window.toast?.error(t('globalSearch.quickApps.save_failed'))
      }
    },
    [setSidebarIconPreferences, t]
  )

  const handleSidebarShortcutOpen = useCallback(
    (icon: SidebarIcon) => {
      const path = getSidebarMenuPath(icon, defaultPaintingProvider)
      if (!path) return

      openTab(path, { forceNew: true, title: getDefaultRouteTitle(path) })
      onClose()
    },
    [defaultPaintingProvider, onClose, openTab]
  )

  const handleSidebarManagerVisibilityChange = useCallback(
    (icon: SidebarIcon, nextVisible: boolean) => {
      const nextVisibleIcons = new Set(visibleSidebarIconSet)

      if (nextVisible) {
        nextVisibleIcons.add(icon)
      } else if (!REQUIRED_SIDEBAR_ICONS.includes(icon)) {
        nextVisibleIcons.delete(icon)
      }

      const preferences = getSidebarIconPreferencesFromOrderedIcons({
        orderedIcons: sidebarPreferenceManagerIcons,
        visibleIcons: nextVisibleIcons
      })

      void persistSidebarIconPreferences(preferences)
    },
    [persistSidebarIconPreferences, sidebarPreferenceManagerIcons, visibleSidebarIconSet]
  )

  const handleSidebarManagerReorder = useCallback(
    ({ oldIndex, newIndex }: { oldIndex: number; newIndex: number }) => {
      const orderedIcons = moveSidebarIcon(sidebarPreferenceManagerIcons, oldIndex, newIndex)
      if (orderedIcons === sidebarPreferenceManagerIcons) return

      const preferences = getSidebarIconPreferencesFromOrderedIcons({
        orderedIcons,
        visibleIcons: visibleSidebarIconSet
      })

      void persistSidebarIconPreferences(preferences)
    },
    [persistSidebarIconPreferences, sidebarPreferenceManagerIcons, visibleSidebarIconSet]
  )

  const handleSidebarManagerReset = useCallback(() => {
    const preferences = getDefaultSidebarIconPreferences()
    void persistSidebarIconPreferences(preferences)
  }, [persistSidebarIconPreferences])

  const handleQuickAppsManage = useCallback(() => {
    if (panelMode === 'menu-manager') {
      setPanelMode('search')
      return
    }

    setPanelMode('menu-manager')
  }, [panelMode])

  const handleSearchScopeChange = useCallback((nextScope: GlobalSearchScope) => {
    setPanelMode(nextScope === 'messages' ? 'message-search' : 'search')
  }, [])

  const openTopic = useCallback(
    async (topicId: string) => {
      const apiTopic = await dataApiService.get(`/topics/${topicId}`)
      const topic = mapApiTopicToRendererTopic(apiTopic)
      cacheService.set('topic.active', topic)
      openTab('/app/chat')
      window.setTimeout(() => {
        void EventEmitter.emit(EVENT_NAMES.GLOBAL_SEARCH_SELECT_TOPIC, topic)
      }, 0)
      onClose()
    },
    [onClose, openTab]
  )

  const openSession = useCallback(
    (sessionId: string) => {
      cacheService.set('agent.active_session_id', sessionId)
      openTab('/app/agents')
      window.setTimeout(() => {
        void EventEmitter.emit(EVENT_NAMES.GLOBAL_SEARCH_SELECT_AGENT_SESSION, sessionId)
      }, 0)
      onClose()
    },
    [onClose, openTab]
  )

  const openTopicMessage = useCallback(
    async (result: SearchMessageResult) => {
      const apiTopic = await dataApiService.get(`/topics/${result.topicId}`)
      const topic = {
        ...mapApiTopicToRendererTopic(apiTopic),
        activeNodeId: result.messageId
      }

      await dataApiService.put(`/topics/${result.topicId}/active-node`, { body: { nodeId: result.messageId } })
      await invalidateCache(`/topics/${result.topicId}/messages`)
      cacheService.set('topic.active', topic)
      openTab('/app/chat')
      window.setTimeout(() => {
        void EventEmitter.emit(EVENT_NAMES.GLOBAL_SEARCH_SELECT_TOPIC, topic)
        window.setTimeout(() => {
          void EventEmitter.emit(EVENT_NAMES.LOCATE_MESSAGE + ':' + result.messageId, true)
        }, 300)
      }, 0)
      onClose()
    },
    [invalidateCache, onClose, openTab]
  )

  const openSessionMessage = useCallback(
    (result: SessionSearchMessageResult) => {
      cacheService.set('agent.active_session_id', result.sessionId)
      openTab('/app/agents')
      window.setTimeout(() => {
        void EventEmitter.emit(EVENT_NAMES.GLOBAL_SEARCH_SELECT_AGENT_SESSION, result.sessionId)
        window.setTimeout(() => {
          void EventEmitter.emit(EVENT_NAMES.LOCATE_MESSAGE + ':' + result.messageId, true)
        }, 300)
      }, 0)
      onClose()
    },
    [onClose, openTab]
  )

  const openKnowledgeBase = useCallback(
    (knowledgeBaseId: string) => {
      openTab('/app/knowledge')
      window.setTimeout(() => {
        void EventEmitter.emit(EVENT_NAMES.GLOBAL_SEARCH_SELECT_KNOWLEDGE_BASE, knowledgeBaseId)
      }, 0)
      onClose()
    },
    [onClose, openTab]
  )

  const openMessagePanelItem = useCallback(
    async (item: GlobalMessageSearchPanelItem) => {
      if (item.kind === 'more') {
        setExpandedMessageParentIds((current) => {
          const next = new Set(current)
          next.add(item.parentId)
          return next
        })
        return
      }

      try {
        if (item.result.sourceType === 'topic') {
          await openTopicMessage(item.result)
          return
        }

        openSessionMessage(item.result)
      } catch {
        window.toast?.error(t('globalSearch.open_failed'))
      }
    },
    [openSessionMessage, openTopicMessage, t]
  )

  const openPanelItem = useCallback(
    async (item: GlobalSearchPanelItem) => {
      try {
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
            openTab(buildLibraryRouteUrl(buildLibraryEditSearch('assistant', assistantId)), { forceNew: true })
            onClose()
            return
          }
          case 'agent': {
            const agentId = getAgentTargetId(result.target)
            if (!agentId) return
            openTab(buildLibraryRouteUrl(buildLibraryEditSearch('agent', agentId)), { forceNew: true })
            onClose()
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
      } catch {
        window.toast?.error(t('globalSearch.open_failed'))
      }
    },
    [onClose, openKnowledgeBase, openSession, openTab, openTopic, t]
  )

  const moveActiveItem = useCallback(
    (direction: 1 | -1) => {
      if (keyboardItems.length === 0) return

      const currentIndex = Math.max(
        0,
        keyboardItems.findIndex((item) => item.id === activeItemId)
      )
      const nextIndex = (currentIndex + direction + keyboardItems.length) % keyboardItems.length
      setActiveItemId(keyboardItems[nextIndex].id)
    },
    [activeItemId, keyboardItems]
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

      if (panelMode === 'menu-manager') {
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
          void openMessagePanelItem(item as GlobalMessageSearchPanelItem)
          return
        }
        void openPanelItem(item as GlobalSearchPanelItem)
      }
    },
    [
      activeItemId,
      isMessageSearchMode,
      keyboardItems,
      moveActiveItem,
      onClose,
      openMessagePanelItem,
      openPanelItem,
      panelMode
    ]
  )

  const handleFilterSelect = useCallback((nextFilter: Exclude<GlobalSearchFilter, 'all'>) => {
    setFilter((current) => (current === nextFilter ? 'all' : nextFilter))
  }, [])

  const handleTimeFilterSelect = useCallback((nextFilter: GlobalSearchTimeFilter) => {
    setTimeFilter(nextFilter)
  }, [])

  const handleMessageSourceFilterSelect = useCallback((nextFilter: Exclude<GlobalMessageSearchSourceFilter, 'all'>) => {
    setMessageSourceFilter((current) => (current === nextFilter ? 'all' : nextFilter))
  }, [])

  const handleMessageMatchModeSelect = useCallback((nextMatchMode: GlobalMessageSearchMatchMode) => {
    setMessageMatchMode(nextMatchMode)
  }, [])

  const showEmptyState = !isLoading && !error && selectableItems.length === 0
  const showMessageEmptyState =
    !isMessageLoading && !messageError && (hasQuery ? messageSelectableItems.length === 0 : true)

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 px-5 pt-4 pb-2">
        <div className="relative">
          <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-4 size-5 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value.trimStart())
              setPanelMode((current) => (current === 'menu-manager' ? 'search' : current))
            }}
            onKeyDown={handleInputKeyDown}
            placeholder={t('globalSearch.placeholder')}
            aria-label={t('globalSearch.placeholder')}
            spellCheck={false}
            className="h-11 rounded-[22px] border-border-subtle bg-muted/20 pr-12 pl-12 text-[15px] shadow-none placeholder:text-muted-foreground focus-visible:ring-1"
          />
          {query && (
            <button
              type="button"
              aria-label={t('globalSearch.clear')}
              onClick={() => {
                setQuery('')
                setPanelMode((current) => (current === 'menu-manager' ? 'search' : current))
              }}
              className="-translate-y-1/2 absolute top-1/2 right-3 flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <X className="size-4" />
            </button>
          )}
        </div>

        {!hideQuickApps && (
          <GlobalSearchQuickAppsBar
            active={panelMode === 'menu-manager'}
            icons={shortcutSidebarIcons}
            onManage={handleQuickAppsManage}
            onOpen={handleSidebarShortcutOpen}
          />
        )}

        <div className={cn('flex h-7 items-center gap-2', hideQuickApps && 'mt-3')}>
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-7 gap-1.5 rounded-[8px] px-2 font-medium text-muted-foreground text-xs hover:bg-muted/50 hover:text-foreground"
                    aria-label={t('globalSearch.messageSearch.matchModeLabel')}>
                    <Search className="size-3.5" />
                    <span>{t(getMessageMatchModeLabelKey(messageMatchMode))}</span>
                    <ChevronDown className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="z-[90] min-w-[132px] rounded-[10px] p-1">
                  {MESSAGE_MATCH_MODES.map((matchModeOption) => (
                    <DropdownMenuItem
                      key={matchModeOption}
                      onSelect={() => handleMessageMatchModeSelect(matchModeOption)}
                      className={cn(
                        'h-8 rounded-[7px] font-medium text-xs',
                        messageMatchMode === matchModeOption && 'bg-accent text-accent-foreground'
                      )}>
                      {t(getMessageMatchModeLabelKey(matchModeOption))}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-7 gap-1.5 rounded-[8px] px-2 font-medium text-muted-foreground text-xs hover:bg-muted/50 hover:text-foreground"
                    aria-label={t(getTimeFilterAriaLabelKey(panelMode))}>
                    <Clock3 className="size-3.5" />
                    <span>{t(getTimeFilterLabelKey(timeFilter))}</span>
                    <ChevronDown className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="z-[90] min-w-[132px] rounded-[10px] p-1">
                  {TIME_FILTERS.map((filterOption) => (
                    <DropdownMenuItem
                      key={filterOption}
                      onSelect={() => handleTimeFilterSelect(filterOption)}
                      className={cn(
                        'h-8 rounded-[7px] font-medium text-xs',
                        timeFilter === filterOption && 'bg-accent text-accent-foreground'
                      )}>
                      {t(getTimeFilterLabelKey(filterOption))}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-7 gap-1.5 rounded-[8px] px-2 font-medium text-muted-foreground text-xs hover:bg-muted/50 hover:text-foreground"
                    aria-label={t(getTimeFilterAriaLabelKey(panelMode))}>
                    <Clock3 className="size-3.5" />
                    <span>{t(getTimeFilterLabelKey(timeFilter))}</span>
                    <ChevronDown className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="z-[90] min-w-[132px] rounded-[10px] p-1">
                  {TIME_FILTERS.map((filterOption) => (
                    <DropdownMenuItem
                      key={filterOption}
                      onSelect={() => handleTimeFilterSelect(filterOption)}
                      className={cn(
                        'h-8 rounded-[7px] font-medium text-xs',
                        timeFilter === filterOption && 'bg-accent text-accent-foreground'
                      )}>
                      {t(getTimeFilterLabelKey(filterOption))}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 border-border-subtle border-t">
        {panelMode === 'menu-manager' ? (
          <GlobalSearchQuickAppManager
            icons={sidebarPreferenceManagerIcons}
            visibleIcons={visibleSidebarIconSet}
            onReorder={handleSidebarManagerReorder}
            onReset={handleSidebarManagerReset}
            onVisibilityChange={handleSidebarManagerVisibilityChange}
          />
        ) : isMessageSearchMode ? (
          isMessageLoading && hasQuery ? (
            <GlobalSearchState label={t('common.loading')} />
          ) : messageError ? (
            <GlobalSearchState label={t('globalSearch.error')} />
          ) : showMessageEmptyState ? (
            <GlobalSearchState label={hasQuery ? t('common.no_results') : t('globalSearch.messageSearch.hint')} />
          ) : (
            <GroupedVirtualList
              role="listbox"
              groups={messageVirtualGroups}
              estimateGroupHeaderSize={() => 32}
              estimateItemSize={(item) => {
                if (item.kind === 'more') return 36
                return 44
              }}
              className="pt-2 pb-2"
              renderGroupHeader={(group) => <GlobalMessageSearchGroupHeader group={group} />}
              renderItem={(item) => (
                <GlobalMessageSearchRow
                  item={item}
                  active={item.id === activeItemId}
                  language={i18n.language}
                  query={deferredQuery}
                  userName={userName}
                  onMouseEnter={() => setActiveItemId(item.id)}
                  onOpen={() => void openMessagePanelItem(item)}
                />
              )}
            />
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
              role="listbox"
              groups={virtualGroups}
              estimateGroupHeaderSize={() => 28}
              estimateItemSize={() => 52}
              className="pt-1 pb-2"
              renderGroupHeader={(group) => <GlobalSearchGroupHeader group={group} />}
              renderItem={(item) => (
                <GlobalSearchRow
                  item={item}
                  active={item.id === activeItemId}
                  language={i18n.language}
                  query={deferredQuery}
                  onMouseEnter={() => setActiveItemId(item.id)}
                  onOpen={() => void openPanelItem(item)}
                />
              )}
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
    </div>
  )
}
