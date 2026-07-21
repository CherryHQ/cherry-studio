import { cacheService } from '@data/CacheService'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import type { ResourcePaneConfig, ResourcePaneCountButtonProps } from '@renderer/components/chat/panes/Shell'
import { EmptyState, LoadingState } from '@renderer/components/chat/primitives'
import { AssistantResourceList } from '@renderer/components/chat/resourceList/AssistantResourceList'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resourceList/base'
import { ChatAppShell } from '@renderer/components/chat/shell/ChatAppShell'
import ConversationCenterState from '@renderer/components/chat/shell/ConversationCenterState'
import { ConversationSidebarToggleButton } from '@renderer/components/chat/shell/ConversationSidebarToggleButton'
import type { ChatPanePosition } from '@renderer/components/chat/shell/paneLayout'
import {
  createRecentTopicEntryFromTopic,
  upsertGlobalSearchRecentEntry
} from '@renderer/components/GlobalSearch/globalSearchGroups'
import {
  type GlobalSearchTopicMessageSelectionPayload,
  type GlobalSearchTopicSelectionPayload,
  isGlobalSearchSelectionForTab
} from '@renderer/components/GlobalSearch/globalSearchSelectionEvents'
import HistoryRecordsView from '@renderer/components/history/HistoryRecordsView'
import { ConversationResourceView } from '@renderer/components/resourceCatalog/conversation'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useCommandHandler } from '@renderer/hooks/command'
import { useAssistantTopicsSource } from '@renderer/hooks/resourceViewSources'
import { useCurrentTab, useCurrentTabId, useIsActiveTab, useTabSelfMetadata } from '@renderer/hooks/tab'
import { useAssistantApiById, useAssistants } from '@renderer/hooks/useAssistant'
import { toCreateAssistantDtoFromCatalogPreset } from '@renderer/hooks/useAssistantCatalogPresets'
import {
  type ConversationCenterResourceDefinition,
  useConversationCenterSurface
} from '@renderer/hooks/useConversationCenterSurface'
import { useResourcePaneOpen } from '@renderer/hooks/useResourcePaneOpen'
import {
  mapApiTopicToRendererTopic,
  useActiveTopic,
  useLatestTopic,
  useTopicById,
  useTopicMutations
} from '@renderer/hooks/useTopic'
import { useWindowFrame } from '@renderer/hooks/useWindowFrame'
import { ipcApi } from '@renderer/ipc'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { ResourceListRevealPayload } from '@renderer/services/resourceListRevealEvents'
import { toast } from '@renderer/services/toast'
import type { Topic } from '@renderer/types/topic'
import { getTopicAssistantDisplayGroupId } from '@renderer/utils/chat/topicsHelpers'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { cn } from '@renderer/utils/style'
import { getTabInstanceKey } from '@renderer/utils/tabInstanceMetadata'
import { MIN_WINDOW_HEIGHT, SECOND_MIN_WINDOW_WIDTH } from '@shared/utils/window'
import { useLocation, useSearch } from '@tanstack/react-router'
import { MessageCircle } from 'lucide-react'
import type { FC, HTMLAttributes } from 'react'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import Chat from './Chat'
import {
  AssistantConversationPickerDialog,
  type AssistantConversationSelection
} from './components/AssistantConversationPickerDialog'
import { TopicRightPane } from './components/TopicRightPane'
import { parseChatRouteSearch } from './routeSearch'
import { Topics } from './Tabs/components/Topics'
import HomeTabs from './Tabs/HomeTabs'
import type { AddNewTopicPayload } from './types'

const logger = loggerService.withContext('HomePage')
const LAST_USED_ASSISTANT_CACHE_KEY = 'ui.chat.last_used_assistant_id'
type AssistantConversationResourceKind = 'assistant'

type NewTopicAssistantSelectionSource = 'explicit' | 'last-used' | 'first-assistant' | 'runtime-fallback'
type ResolvedNewTopicAssistantSelection = { assistantId?: string; source: NewTopicAssistantSelectionSource }
type InitialTopicStartState = {
  firstLaunchStarted: boolean
}

type NewTopicAssistantTargetOptions = {
  excludedAssistantIds?: readonly string[]
}

const HomePage: FC = () => {
  const { t } = useTranslation()
  const [topicRevealRequest, setTopicRevealRequest] = useState<ResourceListRevealRequest>()
  const topicRevealRequestIdRef = useRef(0)
  const ownerFallbackRequestIdRef = useRef(0)
  const initialTopicStartStateRef = useRef<InitialTopicStartState>({ firstLaunchStarted: false })
  // Guards the classic-layout topic-create paths against re-entry: a rapid double-click would
  // otherwise read the same pre-refresh topic list twice and stack duplicate blank topics.
  const isCreatingTopicRef = useRef(false)
  const [lastUsedAssistantId, setLastUsedAssistantId] = usePersistCache(LAST_USED_ASSISTANT_CACHE_KEY)
  const [topicExpansionAssistant, setTopicExpansionAssistant] = usePersistCache('ui.topic.expansion.assistant')
  const [rightPaneAssistantScopeId, setRightPaneAssistantScopeId] = useState<string | null | undefined>(undefined)
  const [isSelectedAssistantScopeEmpty, setIsSelectedAssistantScopeEmpty] = useState(false)
  const lastRecordedRecentTopicRef = useRef<string | undefined>(undefined)
  const [pendingLocateMessageId, setPendingLocateMessageId] = useState<string | undefined>()
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const [detachedSidebarOpen, setDetachedSidebarOpen] = useState(false)
  const [topicDisplayMode, setTopicDisplayMode] = usePreference('topic.tab.display_mode')
  const [panePosition, setPanePosition] = usePreference('topic.tab.position')
  const [autoCollapsedResourceList, setAutoCollapsedResourceList] = useState(false)
  const isAssistantResourceLayout = topicDisplayMode === 'assistant'
  const [assistantPickerOpen, setAssistantPickerOpen] = useState(false)

  const location = useLocation()
  const routeSearch = parseChatRouteSearch(useSearch({ strict: false }) as Record<string, unknown>)
  const currentTab = useCurrentTab()
  const state = location.state as { topic?: Topic } | undefined
  const routeTopicId = routeSearch.topicId
  const tabMetadataTopicId = currentTab ? getTabInstanceKey(currentTab, 'assistants') : undefined
  const routeAssistantId = routeTopicId ? undefined : routeSearch.assistantId
  const isMessageOnlyView = routeSearch.view === 'message' && !!routeTopicId
  const isWindowFrame = useWindowFrame().mode === 'window'
  // Classic-layout right-pane open state, cached on the assistant surface's own key.
  const [topicPaneOpen, setTopicPaneOpen] = useResourcePaneOpen('chat', {
    enabled: isAssistantResourceLayout,
    defaultOpen: !isWindowFrame && panePosition === 'right'
  })
  // Shared topic facts plus exact derived lookups for rails, restore, and empty-topic reuse.
  const assistantTopicsSource = useAssistantTopicsSource({ enabled: !isMessageOnlyView })
  const { stats: topicStats, loadLatestTopic, loadReusableTopic } = assistantTopicsSource
  // First-entry selection resumes the most-recently-active topic. A dedicated `lastActivityAt DESC LIMIT 1`
  // query proves the global latest, so it neither waits for the full topic history to paginate in nor
  // depends on either independently paged `/topics` stream or its visible ordering.
  const { latestTopic, isLoading: isLatestTopicLoading } = useLatestTopic({ enabled: !isMessageOnlyView })
  const isLatestTopicReady = isMessageOnlyView || !isLatestTopicLoading
  const requestedSidebarOpen = isWindowFrame ? detachedSidebarOpen : showSidebar
  const effectiveShowSidebar = !isMessageOnlyView && requestedSidebarOpen && !autoCollapsedResourceList
  const { topic: routeApiTopic, isLoading: isRouteTopicLoading } = useTopicById(
    isMessageOnlyView ? routeTopicId : undefined
  )
  const routeTopic = useMemo(
    () => (routeApiTopic ? mapApiTopicToRendererTopic(routeApiTopic) : undefined),
    [routeApiTopic]
  )

  const shouldAutoCreateTopic = !state?.topic && !isMessageOnlyView

  const { createTopic, refreshTopics } = useTopicMutations()
  const {
    assistants,
    hasLoaded: hasAssistantsLoaded,
    isLoading: isAssistantsLoading,
    isRefreshing: isAssistantsRefreshing,
    addAssistant
  } = useAssistants()
  const assistantIdSet = useMemo(() => new Set(assistants.map((assistant) => assistant.id)), [assistants])
  const validLastUsedAssistantId =
    lastUsedAssistantId && assistantIdSet.has(lastUsedAssistantId) ? lastUsedAssistantId : undefined
  const isAssistantListResolved = hasAssistantsLoaded && !isAssistantsLoading && !isAssistantsRefreshing
  const resolveNewTopicAssistantTarget = useCallback(
    (
      explicitAssistantId?: string | null,
      options: NewTopicAssistantTargetOptions = {}
    ): ResolvedNewTopicAssistantSelection => {
      const excludedAssistantIds = new Set(options.excludedAssistantIds ?? [])
      const isAvailableAssistantId = (assistantId: string | null | undefined): assistantId is string =>
        !!assistantId && assistantIdSet.has(assistantId) && !excludedAssistantIds.has(assistantId)

      if (explicitAssistantId === null) {
        return { source: 'explicit' }
      }
      if (isAvailableAssistantId(explicitAssistantId)) {
        return { assistantId: explicitAssistantId, source: 'explicit' }
      }
      if (isAvailableAssistantId(validLastUsedAssistantId)) {
        return { assistantId: validLastUsedAssistantId, source: 'last-used' }
      }
      const fallbackAssistantId = assistants.find((assistant) => !excludedAssistantIds.has(assistant.id))?.id
      if (fallbackAssistantId) {
        return { assistantId: fallbackAssistantId, source: 'first-assistant' }
      }
      return { source: 'runtime-fallback' }
    },
    [assistantIdSet, assistants, validLastUsedAssistantId]
  )

  const initialTopic = useMemo<Topic | undefined>(() => {
    if (isMessageOnlyView) return undefined
    return state?.topic
  }, [isMessageOnlyView, state?.topic])

  const routeActiveTopicId = isMessageOnlyView ? null : (routeTopicId ?? tabMetadataTopicId ?? null)
  const [activeTopicId, setActiveTopicId] = useState<string | null>(() => routeActiveTopicId)

  useEffect(() => {
    if (routeActiveTopicId) setIsSelectedAssistantScopeEmpty(false)
    setActiveTopicId(routeActiveTopicId)
  }, [routeActiveTopicId])

  const {
    activeTopic,
    setActiveTopic,
    clearActiveTopic,
    isLoading: isActiveTopicLoading,
    topicSource: activeTopicSource
  } = useActiveTopic({
    initialTopic,
    activeTopicId,
    setActiveTopicId,
    // Message-only view loads its target via useTopicById; the active hook
    // must not emit or expose a visible activeTopic.
    passive: isMessageOnlyView
  })
  const lastVisibleTopicRef = useRef<Topic | undefined>(undefined)
  const visibleTopic = isMessageOnlyView
    ? routeTopic
    : isSelectedAssistantScopeEmpty
      ? undefined
      : (activeTopic ?? (isActiveTopicLoading ? lastVisibleTopicRef.current : undefined) ?? undefined)
  const visibleTopicId = visibleTopic?.id
  const visibleTopicAssistantId = visibleTopic?.assistantId
  const visibleTopicAssistantScopeId =
    visibleTopicAssistantId && (!isAssistantListResolved || assistantIdSet.has(visibleTopicAssistantId))
      ? visibleTopicAssistantId
      : null
  const activeTopicSelectionRef = useRef<Topic | undefined>(visibleTopic)
  useEffect(() => {
    activeTopicSelectionRef.current = visibleTopic
  }, [visibleTopic])
  useEffect(() => {
    if (!visibleTopicId) return
    setRightPaneAssistantScopeId(visibleTopicAssistantScopeId)
    setIsSelectedAssistantScopeEmpty(false)
  }, [visibleTopicAssistantScopeId, visibleTopicId])
  const resourceConversationKey = useMemo(() => {
    if (visibleTopic?.id) return `topic:${visibleTopic.id}`
    return 'empty'
  }, [visibleTopic?.id])
  const resourceViewDefinitions = useMemo<
    readonly ConversationCenterResourceDefinition<AssistantConversationResourceKind>[]
  >(
    () => [
      {
        icon: <MessageCircle />,
        id: 'assistant-resource-view',
        kind: 'assistant',
        label: t('chat.resource_view.menu.assistant')
      }
    ],
    [t]
  )
  const {
    activeResourceKind,
    closeSurface,
    historyActive: historyRecordsActive,
    resourceMenuItems,
    toggleHistory: toggleHistoryRecords
  } = useConversationCenterSurface<AssistantConversationResourceKind>({
    conversationKey: resourceConversationKey,
    resourceDefinitions: resourceViewDefinitions,
    disabled: isMessageOnlyView || isWindowFrame
  })

  useEffect(() => {
    if (!isAssistantListResolved || !lastUsedAssistantId || assistantIdSet.has(lastUsedAssistantId)) return
    setLastUsedAssistantId(null)
  }, [assistantIdSet, isAssistantListResolved, lastUsedAssistantId, setLastUsedAssistantId])

  useEffect(() => {
    const assistantId = activeTopic?.assistantId
    if (assistantId) {
      setLastUsedAssistantId(assistantId)
    }
  }, [activeTopic, setLastUsedAssistantId])

  // All non-dormant tabs mount at once (Activity keep-alive), so each chat tab runs its
  // own HomePage. `currentTabId` is *this* tab; `useIsActiveTab` answers "am I the
  // globally-focused tab".
  const currentTabId = useCurrentTabId()
  const isActiveTab = useIsActiveTab()

  const clearTopicRevealRequestAfterPaint = useCallback((requestId: number) => {
    const clear = () => {
      setTopicRevealRequest((current) => (current?.requestId === requestId ? undefined : current))
    }

    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(clear)
      return
    }

    window.setTimeout(clear, 0)
  }, [])

  const revealActiveTopicInResourceList = useEffectEvent(() => {
    if (isMessageOnlyView || !visibleTopic?.id) return
    const requestId = topicRevealRequestIdRef.current + 1
    topicRevealRequestIdRef.current = requestId
    setTopicRevealRequest({
      itemId: visibleTopic.id,
      requestId
    })
    clearTopicRevealRequestAfterPaint(requestId)
  })

  useEffect(() => {
    const unsubscribe = EventEmitter.on(EVENT_NAMES.REVEAL_ACTIVE_RESOURCE_LIST, (payload) => {
      const { source, tabId } = payload as ResourceListRevealPayload
      if (source !== 'assistants' || tabId !== currentTabId) return
      revealActiveTopicInResourceList()
    })

    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `useEffectEvent` reads the latest topic without resubscribing.
  }, [currentTabId])

  useEffect(() => {
    // Track "last focused topic" for persisted topics. Drives the sidebar `assistants`
    // dedupe key (mirror of agent's last_used_session).
    // Gated on the active tab: `last_used` is a single global "what I'm looking
    // at now", so background tabs (also mounted) must not clobber it.
    if (!isActiveTab) return
    if (activeTopic?.id && activeTopicSource === 'query') {
      cacheService.setPersist('ui.chat.last_used_topic_id', activeTopic.id)
    }
  }, [isActiveTab, activeTopic, activeTopicSource])

  // Label this tab with its assistant emoji + topic name so multiple chat tabs
  // are distinguishable in the tab bar (every tab labels itself — not gated on active).
  const activeResourceAssistantId =
    isAssistantResourceLayout && panePosition === 'right' && rightPaneAssistantScopeId !== undefined
      ? rightPaneAssistantScopeId
      : visibleTopicAssistantScopeId
  const { assistant: visibleAssistant } = useAssistantApiById(activeResourceAssistantId ?? undefined)
  const topicListPosition: ChatPanePosition =
    !isWindowFrame && isAssistantResourceLayout && panePosition === 'right' ? 'right' : 'left'
  const topicCountByAssistantId = useMemo(
    () => new Map((topicStats?.byAssistant ?? []).map(({ assistantId, count }) => [assistantId, count])),
    [topicStats?.byAssistant]
  )
  const topicResourcePaneCount = useMemo<ResourcePaneCountButtonProps | undefined>(() => {
    if (!isAssistantResourceLayout || topicListPosition !== 'right' || !activeResourceAssistantId) return undefined

    return {
      label: t('chat.topics.title'),
      count: topicCountByAssistantId.get(activeResourceAssistantId) ?? 0
    }
  }, [activeResourceAssistantId, isAssistantResourceLayout, t, topicCountByAssistantId, topicListPosition])
  const tabInstanceTopicId = !isMessageOnlyView
    ? (visibleTopic?.id ?? (!isSelectedAssistantScopeEmpty ? (routeActiveTopicId ?? undefined) : undefined))
    : undefined
  useTabSelfMetadata({
    title: visibleTopic?.name?.trim() || visibleAssistant?.name?.trim() || getDefaultRouteTitle('/app/chat'),
    emoji: visibleAssistant?.emoji,
    instanceAppId: 'assistants',
    instanceKey: tabInstanceTopicId ?? null
  })

  useEffect(() => {
    if (activeTopic) lastVisibleTopicRef.current = activeTopic
  }, [activeTopic])

  useEffect(() => {
    if (isMessageOnlyView) return
    if (!activeTopic) return
    const signature = `${activeTopic.id}:${activeTopic.name}`
    if (lastRecordedRecentTopicRef.current === signature) return

    lastRecordedRecentTopicRef.current = signature
    const recentItems = cacheService.getPersist('ui.global_search.recent_items')
    cacheService.setPersist(
      'ui.global_search.recent_items',
      upsertGlobalSearchRecentEntry(recentItems ?? [], createRecentTopicEntryFromTopic(activeTopic))
    )
  }, [activeTopic, isMessageOnlyView])

  const setResourceListOpen = useCallback(
    (open: boolean) => {
      setAutoCollapsedResourceList(false)
      if (isWindowFrame) {
        setDetachedSidebarOpen(open)
        return
      }
      void setShowSidebar(open)
    },
    [isWindowFrame, setShowSidebar]
  )
  const handleResourceListAutoCollapseChange = useCallback((collapsed: boolean) => {
    setAutoCollapsedResourceList(collapsed)
  }, [])
  const toggleResourceListOpen = useCallback(() => {
    if (isMessageOnlyView) return

    if (effectiveShowSidebar) {
      setResourceListOpen(false)
      return
    }

    setResourceListOpen(true)
    requestAnimationFrame(() => {
      void EventEmitter.emit(EVENT_NAMES.SHOW_ASSISTANTS)
    })
  }, [effectiveShowSidebar, isMessageOnlyView, setResourceListOpen])
  useCommandHandler('app.sidebar.toggle', toggleResourceListOpen)

  useEffect(() => {
    if (isMessageOnlyView) return
    if (!state?.topic) return
    setIsSelectedAssistantScopeEmpty(false)
    setActiveTopic(state.topic)
  }, [isMessageOnlyView, setActiveTopic, state?.topic])

  const setActiveTopicAndCloseResourceView = useCallback(
    (topic: Topic) => {
      activeTopicSelectionRef.current = topic
      closeSurface()
      setRightPaneAssistantScopeId(
        topic.assistantId && (!isAssistantListResolved || assistantIdSet.has(topic.assistantId))
          ? topic.assistantId
          : null
      )
      setIsSelectedAssistantScopeEmpty(false)
      setActiveTopic(topic)
      return true
    },
    [assistantIdSet, closeSurface, isAssistantListResolved, setActiveTopic]
  )
  const clearActiveTopicInSelectedScope = useCallback(
    (assistantId?: string | null) => {
      activeTopicSelectionRef.current = undefined
      closeSurface()
      setRightPaneAssistantScopeId((current) =>
        assistantId !== undefined ? assistantId : current !== undefined ? current : visibleTopicAssistantScopeId
      )
      setIsSelectedAssistantScopeEmpty(true)
      setPendingLocateMessageId(undefined)
      setTopicRevealRequest(undefined)
      clearActiveTopic()
    },
    [clearActiveTopic, closeSurface, visibleTopicAssistantScopeId]
  )
  const handleResourceTopicSelect = useCallback(
    (topic: Topic) => {
      if (!setActiveTopicAndCloseResourceView(topic)) return false
      topicRevealRequestIdRef.current += 1
      setTopicRevealRequest({
        clearFilters: true,
        clearQuery: true,
        itemId: topic.id,
        requestId: topicRevealRequestIdRef.current
      })
      return true
    },
    [setActiveTopicAndCloseResourceView]
  )

  const resolveAssistantIdForSelection = useCallback(
    async (selection: AssistantConversationSelection) => {
      if (selection.type === 'assistant') return selection.assistantId

      // Reuse an assistant already created from this preset (matched by name, the only persistent
      // link we have) instead of creating a duplicate every time the preset is picked.
      const presetName = selection.preset.name.trim()
      const existing = assistants.find((assistant) => assistant.name === presetName)
      if (existing) return existing.id

      return (await addAssistant(toCreateAssistantDtoFromCatalogPreset(selection.preset))).id
    },
    [addAssistant, assistants]
  )

  const handleAssistantConversationSelect = useCallback(
    async (selection: AssistantConversationSelection) => {
      if (isCreatingTopicRef.current) return
      isCreatingTopicRef.current = true
      // Close the picker first so the topic/assistant data churn below doesn't refresh the dialog
      // while it's still visible (which reads as a black/white flash + the dialog reopening).
      setAssistantPickerOpen(false)
      try {
        const assistantId = await resolveAssistantIdForSelection(selection)

        // Reuse the assistant's newest exact empty placeholder, independent of list pagination.
        const reusableApiTopic = await loadReusableTopic(assistantId)
        const reusableTopic = reusableApiTopic ? mapApiTopicToRendererTopic(reusableApiTopic) : undefined

        const rendererTopic = reusableTopic ?? mapApiTopicToRendererTopic(await createTopic({ assistantId }))

        setActiveTopicAndCloseResourceView(rendererTopic)
        if (!reusableTopic) {
          void refreshTopics().catch((err) => {
            logger.warn('Failed to refresh topics after assistant picker topic create', err as Error)
          })
        }
      } catch (err) {
        logger.error('Failed to create assistant conversation from classic-layout picker', err as Error)
        toast.error(formatErrorMessageWithPrefix(err, t('common.error')))
      } finally {
        isCreatingTopicRef.current = false
      }
    },
    [
      createTopic,
      loadReusableTopic,
      refreshTopics,
      resolveAssistantIdForSelection,
      setActiveTopicAndCloseResourceView,
      t
    ]
  )

  const createAndActivateEmptyTopic = useCallback(
    async (payload?: AddNewTopicPayload, options?: NewTopicAssistantTargetOptions): Promise<Topic | null> => {
      if (isCreatingTopicRef.current) return null
      isCreatingTopicRef.current = true
      try {
        const selection = resolveNewTopicAssistantTarget(payload?.assistantId, options)
        // The explicit default/unassigned group (`payload.assistantId === null`) resolves to no target
        // assistant, but its empty placeholders must still be reused rather than restacked — mark it with
        // `null` so the exact reusable-placeholder read targets "no assistant" topics.
        const reuseTargetAssistantId = selection.assistantId ?? (payload?.assistantId === null ? null : undefined)
        const reusableApiTopic =
          reuseTargetAssistantId === undefined ? null : await loadReusableTopic(reuseTargetAssistantId)
        const reusableTopic = reusableApiTopic ? mapApiTopicToRendererTopic(reusableApiTopic) : undefined
        const rendererTopic =
          reusableTopic ??
          mapApiTopicToRendererTopic(
            await createTopic({
              ...(selection.assistantId ? { assistantId: selection.assistantId } : {})
            })
          )

        setActiveTopicAndCloseResourceView(rendererTopic)
        if (!reusableTopic) {
          void refreshTopics().catch((err) => {
            logger.warn('Failed to refresh topics after composer topic create', err as Error)
          })
        }
        return rendererTopic
      } catch (err) {
        logger.error('Failed to create empty topic', err as Error)
        toast.error(formatErrorMessageWithPrefix(err, t('common.error')))
        return null
      } finally {
        isCreatingTopicRef.current = false
      }
    },
    [
      createTopic,
      loadReusableTopic,
      refreshTopics,
      resolveNewTopicAssistantTarget,
      setActiveTopicAndCloseResourceView,
      t
    ]
  )

  const handleCreateEmptyTopic = useCallback(
    async (payload?: AddNewTopicPayload) => {
      await createAndActivateEmptyTopic(payload)
    },
    [createAndActivateEmptyTopic]
  )

  const handleCreateEmptyTopicForAssistant = useCallback(
    (assistantId: string | null) => {
      void createAndActivateEmptyTopic({ assistantId })
    },
    [createAndActivateEmptyTopic]
  )

  useEffect(() => {
    if (
      !shouldAutoCreateTopic ||
      isSelectedAssistantScopeEmpty ||
      initialTopicStartStateRef.current.firstLaunchStarted ||
      state?.topic
    )
      return
    if (activeTopic || isActiveTopicLoading) return
    if (!isLatestTopicReady) return

    // Resume the globally most-recently-active topic as soon as `/latest` resolves — the chat center
    // fetches its own assistant by id, so it does not need the assistants list to paint (mirrors the agent
    // page). A deep link that pins an assistant (`routeAssistantId`) skips resume and opens a fresh topic
    // for that assistant instead.
    if (!routeAssistantId && latestTopic) {
      initialTopicStartStateRef.current.firstLaunchStarted = true
      setActiveTopic(mapApiTopicToRendererTopic(latestTopic))
      return
    }

    // Empty library / deep-link create: this path needs the assistants list resolved to pick the
    // default (or pinned) assistant, so gate it here rather than blocking the resume above.
    if (!isAssistantListResolved) return

    initialTopicStartStateRef.current.firstLaunchStarted = true
    void createAndActivateEmptyTopic(routeAssistantId ? { assistantId: routeAssistantId } : undefined).then((topic) => {
      if (!topic) initialTopicStartStateRef.current.firstLaunchStarted = false
    })
  }, [
    activeTopic,
    createAndActivateEmptyTopic,
    isActiveTopicLoading,
    isAssistantListResolved,
    isLatestTopicReady,
    isSelectedAssistantScopeEmpty,
    latestTopic,
    routeAssistantId,
    setActiveTopic,
    shouldAutoCreateTopic,
    state?.topic
  ])

  // Owner removal/emptying uses the pre-removal rail order supplied by the
  // concrete surface, then verifies each candidate through scoped `/latest`.
  const handleActiveAssistantDeleted = useCallback(
    async (deletedAssistantId: string, candidateAssistantIds: readonly string[], reason: 'deleted' | 'emptied') => {
      const requestId = ++ownerFallbackRequestIdRef.current
      const isCurrent = () =>
        ownerFallbackRequestIdRef.current === requestId &&
        activeTopicSelectionRef.current?.assistantId === deletedAssistantId

      setRightPaneAssistantScopeId(undefined)
      setIsSelectedAssistantScopeEmpty(false)
      if (reason === 'deleted' && lastUsedAssistantId === deletedAssistantId) {
        setLastUsedAssistantId(null)
      }

      for (const assistantId of candidateAssistantIds) {
        const nextTopic = await loadLatestTopic(assistantId)
        if (!isCurrent()) return
        if (nextTopic && setActiveTopicAndCloseResourceView(mapApiTopicToRendererTopic(nextTopic))) return
      }

      if (!isCurrent()) return
      activeTopicSelectionRef.current = undefined
      setIsSelectedAssistantScopeEmpty(true)
      clearActiveTopic()
    },
    [clearActiveTopic, lastUsedAssistantId, loadLatestTopic, setActiveTopicAndCloseResourceView, setLastUsedAssistantId]
  )

  // "去对话" from the assistant library (after adding a preset): create/open a real empty topic
  // with that assistant selected.
  const handleOpenAssistantChatFromLibrary = useCallback(
    (assistantId: string) => {
      void createAndActivateEmptyTopic({ assistantId })
    },
    [createAndActivateEmptyTopic]
  )

  useEffect(() => {
    void ipcApi.request('window.main.set_minimum_size', { width: SECOND_MIN_WINDOW_WIDTH, height: MIN_WINDOW_HEIGHT })

    return () => {
      void ipcApi.request('window.main.reset_minimum_size')
    }
  }, [])

  const handleHistoryTopicSelect = useCallback(
    (topic: Topic, messageId?: string) => {
      closeSurface()
      if (!setActiveTopicAndCloseResourceView(topic)) return
      setResourceListOpen(true)
      setPendingLocateMessageId(messageId)
      topicRevealRequestIdRef.current += 1
      setTopicRevealRequest({
        clearFilters: true,
        clearQuery: true,
        itemId: topic.id,
        requestId: topicRevealRequestIdRef.current
      })
    },
    [closeSurface, setActiveTopicAndCloseResourceView, setResourceListOpen]
  )
  const closeHistoryRecords = useCallback(() => {
    closeSurface()
  }, [closeSurface])
  const openHistoryRecords = useCallback(() => {
    toggleHistoryRecords()
  }, [toggleHistoryRecords])
  const handleHistoryRecordsTopicSelect = useCallback(
    (topic: Topic | null) => {
      closeHistoryRecords()
      if (!topic) {
        activeTopicSelectionRef.current = undefined
        setIsSelectedAssistantScopeEmpty(true)
        clearActiveTopic()
        return
      }

      handleHistoryTopicSelect(topic)
    },
    [clearActiveTopic, closeHistoryRecords, handleHistoryTopicSelect]
  )
  const handleGlobalSearchTopicSelect = useEffectEvent((topic: Topic, messageId?: string) => {
    handleHistoryTopicSelect(topic, messageId)
  })

  useEffect(() => {
    const unsubscribe = EventEmitter.on(EVENT_NAMES.GLOBAL_SEARCH_SELECT_TOPIC, (payload) => {
      const selection = payload as GlobalSearchTopicSelectionPayload
      if (!selection.topic || !isGlobalSearchSelectionForTab(selection, currentTabId)) return

      handleGlobalSearchTopicSelect(selection.topic)
    })
    const unsubscribeMessage = EventEmitter.on(EVENT_NAMES.GLOBAL_SEARCH_SELECT_TOPIC_MESSAGE, (payload) => {
      const selection = payload as GlobalSearchTopicMessageSelectionPayload
      if (!selection.topic || !selection.messageId || !isGlobalSearchSelectionForTab(selection, currentTabId)) return

      handleGlobalSearchTopicSelect(selection.topic, selection.messageId)
    })

    return () => {
      unsubscribe()
      unsubscribeMessage()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `useEffectEvent` reads latest tab/topic state without resubscribing.
  }, [currentTabId])

  const handleLocateMessageHandled = useCallback(() => {
    setPendingLocateMessageId(undefined)
  }, [])
  const resourceCenter = useMemo(
    () =>
      activeResourceKind
        ? {
            className: 'relative',
            content: (
              <ConversationResourceView
                kind={activeResourceKind}
                onOpenAssistantChat={handleOpenAssistantChatFromLibrary}
                toolbarLeading={
                  !isMessageOnlyView && !isWindowFrame ? (
                    <ConversationSidebarToggleButton
                      sidebarOpen={effectiveShowSidebar}
                      onSidebarToggle={toggleResourceListOpen}
                      tooltipPlacement="bottom"
                    />
                  ) : undefined
                }
              />
            )
          }
        : null,
    [
      activeResourceKind,
      effectiveShowSidebar,
      handleOpenAssistantChatFromLibrary,
      isMessageOnlyView,
      isWindowFrame,
      toggleResourceListOpen
    ]
  )
  const historyRecordsCenter = historyRecordsActive
    ? {
        className: 'relative',
        content: (
          <HistoryRecordsView
            mode="assistant"
            open={historyRecordsActive && !isMessageOnlyView && !isWindowFrame}
            activeRecordId={activeTopicId}
            onClose={closeHistoryRecords}
            onRecordSelect={handleHistoryRecordsTopicSelect}
            toolbarLeading={
              !isMessageOnlyView && !isWindowFrame ? (
                <ConversationSidebarToggleButton
                  sidebarOpen={effectiveShowSidebar}
                  onSidebarToggle={toggleResourceListOpen}
                  tooltipPlacement="bottom"
                />
              ) : undefined
            }
          />
        )
      }
    : null
  const setTopicListPosition = useCallback(
    async (position: ChatPanePosition) => {
      await setTopicDisplayMode('assistant')
      if (position === 'left' && topicExpansionAssistant == null) {
        const activeAssistantGroupId = visibleTopic ? getTopicAssistantDisplayGroupId(visibleTopic) : undefined
        const collapsedAssistantGroupIds = Array.from(
          new Set(
            (topicStats?.byAssistant ?? [])
              .map(({ assistantId }) => getTopicAssistantDisplayGroupId({ assistantId }))
              .filter((groupId) => groupId !== activeAssistantGroupId)
          )
        )
        setTopicExpansionAssistant(collapsedAssistantGroupIds)
      }
      await setPanePosition(position)
      setTopicPaneOpen(position === 'right', { force: true })
      setResourceListOpen(true)
    },
    [
      setPanePosition,
      setResourceListOpen,
      setTopicDisplayMode,
      setTopicExpansionAssistant,
      setTopicPaneOpen,
      topicExpansionAssistant,
      topicStats?.byAssistant,
      visibleTopic
    ]
  )
  const shellPanePosition: ChatPanePosition = 'left'

  // Message-only (detached) view has no rail: resolve its single target topic and show its own
  // loading / not-found status. The normal view falls through to the loading shell below (which keeps
  // the rail visible) instead of returning a blank frame.
  if (isMessageOnlyView && !visibleTopic && !resourceCenter) {
    return (
      <Container id="home-page">
        <ContentContainer>
          <MessageOnlyStatus
            loading={isRouteTopicLoading}
            loadingLabel={t('common.loading')}
            missingTitle={t('history.error.topic_not_found')}
          />
        </ContentContainer>
      </Container>
    )
  }

  // Classic layout = entity rail + right topic panel; modern layout = the single sidebar (HomeTabs).
  const pane =
    isAssistantResourceLayout && topicListPosition === 'right' ? (
      <AssistantResourceList
        activeAssistantId={activeResourceAssistantId}
        assistantTopicsSource={assistantTopicsSource}
        onAddAssistant={() => {
          setAssistantPickerOpen(true)
        }}
        historyRecordsActive={historyRecordsActive}
        onOpenHistoryRecords={isWindowFrame ? undefined : openHistoryRecords}
        onSelectTopic={handleResourceTopicSelect}
        onSelectEmptyAssistant={clearActiveTopicInSelectedScope}
        onClearActiveTopic={clearActiveTopicInSelectedScope}
        onSelectedAssistantClick={() => {
          closeSurface()
          setTopicPaneOpen(!topicPaneOpen)
        }}
        onCreateTopic={handleCreateEmptyTopicForAssistant}
        resourceMenuItems={resourceMenuItems}
        onActiveAssistantDeleted={handleActiveAssistantDeleted}
      />
    ) : (
      <HomeTabs
        activeTopic={visibleTopic}
        assistantTopicsSource={assistantTopicsSource}
        onActiveAssistantDeleted={handleActiveAssistantDeleted}
        onAddAssistant={() => {
          setAssistantPickerOpen(true)
        }}
        setActiveTopic={setActiveTopicAndCloseResourceView}
        onClearActiveTopic={clearActiveTopicInSelectedScope}
        onNewTopic={isMessageOnlyView ? undefined : handleCreateEmptyTopic}
        historyRecordsActive={historyRecordsActive}
        onOpenHistoryRecords={isWindowFrame ? undefined : openHistoryRecords}
        revealRequest={topicRevealRequest}
        resourceMenuItems={resourceMenuItems}
        onSetPanePosition={isWindowFrame ? undefined : setTopicListPosition}
        panePosition="left"
      />
    )
  // In classic layout the topic list moves into the chat's right pane as a capability; the single page-level
  // provider owns the RightPanel for both views so the rail and the right panel share its open/maximize
  // state. New (sidebar) view passes a null config, leaving the pane as branch/trace only.
  const resourcePane: ResourcePaneConfig | null =
    isAssistantResourceLayout && topicListPosition === 'right'
      ? {
          label: t('chat.topics.title'),
          node: (
            <Topics
              assistantTopicsSource={assistantTopicsSource}
              presentation="right-panel"
              activeTopic={visibleTopic}
              assistantIdFilter={activeResourceAssistantId}
              setActiveTopic={setActiveTopicAndCloseResourceView}
              onClearActiveTopic={clearActiveTopicInSelectedScope}
              onNewTopic={isMessageOnlyView ? undefined : handleCreateEmptyTopic}
              onSetPanePosition={setTopicListPosition}
              panePosition="right"
              revealRequest={topicRevealRequest}
            />
          )
        }
      : null
  const assistantPickerDialog = isAssistantResourceLayout ? (
    <AssistantConversationPickerDialog
      open={assistantPickerOpen}
      onOpenChange={setAssistantPickerOpen}
      assistants={assistants}
      assistantsLoading={isAssistantsLoading || isAssistantsRefreshing}
      onSelect={handleAssistantConversationSelect}
    />
  ) : null

  const centerSurface = historyRecordsCenter ?? resourceCenter

  // The provider, conversation shell, and viewport stay at one React ownership path while the center
  // switches between loading, chat, history, and resource surfaces. Capability identity alone now
  // decides whether a visited right-panel subtree survives.
  return (
    <TopicRightPane
      resourcePane={resourcePane}
      topicId={visibleTopic?.id}
      topicName={visibleTopic?.name}
      traceId={visibleTopic?.traceId}
      present={!centerSurface}
      defaultOpen={topicPaneOpen}
      onOpenChange={isAssistantResourceLayout ? setTopicPaneOpen : undefined}
      revealRequest={topicRevealRequest}>
      <Container id="home-page">
        <ContentContainer $detached={isWindowFrame}>
          <Chat
            activeTopic={visibleTopic}
            centerFallback={<ConversationCenterState state={isSelectedAssistantScopeEmpty ? 'empty' : 'loading'} />}
            centerSurface={centerSurface}
            pane={pane}
            paneOpen={effectiveShowSidebar}
            panePosition={shellPanePosition}
            onPaneCollapse={() => setResourceListOpen(false)}
            onPaneAutoCollapseChange={handleResourceListAutoCollapseChange}
            onNewTopic={isMessageOnlyView ? undefined : handleCreateEmptyTopic}
            onCreateEmptyTopic={isMessageOnlyView ? undefined : handleCreateEmptyTopic}
            showResourceListControls={!isMessageOnlyView}
            sidebarOpen={effectiveShowSidebar}
            onSidebarToggle={toggleResourceListOpen}
            locateMessageId={pendingLocateMessageId}
            onLocateMessageHandled={handleLocateMessageHandled}
            resourcePaneCount={topicResourcePaneCount}
          />
        </ContentContainer>
        {assistantPickerDialog}
      </Container>
    </TopicRightPane>
  )
}

type MessageOnlyStatusProps = {
  loading: boolean
  loadingLabel: string
  missingTitle: string
}

function MessageOnlyStatus({ loading, loadingLabel, missingTitle }: MessageOnlyStatusProps) {
  return (
    <div className="flex h-[calc(100vh_-_var(--navbar-height)_-_6px)] flex-1 overflow-hidden rounded-tl-[10px] rounded-bl-[10px] bg-background">
      <ChatAppShell
        centerContent={
          <div className="flex h-full min-h-0 flex-1 items-center justify-center px-6">
            {loading ? <LoadingState label={loadingLabel} /> : <EmptyState compact title={missingTitle} />}
          </div>
        }
      />
    </div>
  )
}

function Container({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('relative flex max-w-[100vw] flex-1 flex-col overflow-hidden', className)} {...props} />
}

function ContentContainer({
  $detached,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { $detached?: boolean }) {
  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 overflow-hidden',
        $detached ? 'max-w-[100vw]' : 'max-w-[calc(100vw_-_12px)]',
        className
      )}
      {...props}
    />
  )
}

export default HomePage
