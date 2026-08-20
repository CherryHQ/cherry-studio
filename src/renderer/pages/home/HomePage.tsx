import { cacheService } from '@data/CacheService'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import type { ResourcePaneConfig, ResourcePaneCountButtonProps } from '@renderer/components/chat/panes/Shell'
import { EmptyState, LoadingState } from '@renderer/components/chat/primitives'
import { AssistantResourceList } from '@renderer/components/chat/resourceList/AssistantResourceList'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resourceList/base'
import { ChatAppShell } from '@renderer/components/chat/shell/ChatAppShell'
import { ConversationSidebarToggleButton } from '@renderer/components/chat/shell/ConversationSidebarToggleButton'
import type { ChatPanePosition } from '@renderer/components/chat/shell/paneLayout'
import {
  createRecentTopicEntryFromTopic,
  recordGlobalSearchRecentEntry
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
import { useCurrentTabId, useIsActiveTab, useTabSelfVisuals } from '@renderer/hooks/tab'
import { useAssistantApiById, useAssistants } from '@renderer/hooks/useAssistant'
import { toCreateAssistantDtoFromCatalogPreset } from '@renderer/hooks/useAssistantCatalogPresets'
import { useClassicLayoutRightPaneOpen } from '@renderer/hooks/useClassicLayoutRightPaneOpen'
import { useComposerFocusRequest } from '@renderer/hooks/useComposerFocusRequest'
import { useConversationCenterSurface } from '@renderer/hooks/useConversationCenterSurface'
import { useConversationShellPaneState } from '@renderer/hooks/useConversationShellPaneState'
import { useModelById } from '@renderer/hooks/useModel'
import { mapApiTopicToRendererTopic, useActiveTopic, useTopicById, useTopicMutations } from '@renderer/hooks/useTopic'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { ResourceListRevealPayload } from '@renderer/services/resourceListRevealEvents'
import { toast } from '@renderer/services/toast'
import type { Topic } from '@renderer/types/topic'
import { getTopicAssistantDisplayGroupId, TOPIC_UNLINKED_ASSISTANT_GROUP_ID } from '@renderer/utils/chat/topicsHelpers'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { cn } from '@renderer/utils/style'
import { isDataApiNotFoundError } from '@shared/data/api/errors'
import { useNavigate, useSearch } from '@tanstack/react-router'
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
const ASSISTANT_CONVERSATION_RESOURCE_KINDS = [
  'assistant'
] as const satisfies readonly AssistantConversationResourceKind[]

const HomePage: FC = () => {
  const { t } = useTranslation()
  const [topicRevealRequest, setTopicRevealRequest] = useState<ResourceListRevealRequest>()
  const topicRevealRequestIdRef = useRef(0)
  const ownerFallbackRequestIdRef = useRef(0)
  // Guards the classic-layout topic-create paths against re-entry: a rapid double-click would
  // otherwise read the same pre-refresh topic list twice and stack duplicate blank topics.
  const isCreatingTopicRef = useRef(false)
  const [lastUsedAssistantId, setLastUsedAssistantId] = usePersistCache(LAST_USED_ASSISTANT_CACHE_KEY)
  const [rightPaneAssistantScopeId, setRightPaneAssistantScopeId] = useState<string | null | undefined>(undefined)
  const [, setLastUsedTopicId] = usePersistCache('ui.chat.last_used_topic_id')
  const lastRecordedRecentTopicRef = useRef<string | undefined>(undefined)
  const [pendingLocateMessageId, setPendingLocateMessageId] = useState<string | undefined>()
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const [topicDisplayMode, setTopicDisplayMode] = usePreference('topic.tab.display_mode')
  const [panePosition, setPanePosition] = usePreference('topic.tab.position')
  const isAssistantResourceLayout = topicDisplayMode === 'assistant'
  const [assistantPickerOpen, setAssistantPickerOpen] = useState(false)

  const routeSearch = parseChatRouteSearch(useSearch({ strict: false }) as Record<string, unknown>)
  const navigate = useNavigate()
  const isActiveTab = useIsActiveTab()
  const routeTopicId = routeSearch.topicId
  const isMessageOnlyView = routeSearch.view === 'message' && !!routeTopicId
  const handleManualPaneOpen = useCallback(() => {
    requestAnimationFrame(() => {
      void EventEmitter.emit(EVENT_NAMES.SHOW_ASSISTANTS)
    })
  }, [])
  const {
    isWindowFrame,
    shellPaneOpen,
    paneManualToggle,
    setShellPaneOpen,
    setShellPaneOpenManually,
    toggleShellPane,
    handlePaneAutoCollapseChange
  } = useConversationShellPaneState({
    isMessageOnlyView,
    persistedPaneOpen: showSidebar,
    setPersistedPaneOpen: setShowSidebar,
    onManualPaneOpen: handleManualPaneOpen
  })
  const topicListPosition: ChatPanePosition =
    !isWindowFrame && isAssistantResourceLayout && panePosition === 'right' ? 'right' : 'left'
  // Classic-layout right-pane open state, cached on the assistant surface's own key.
  const [topicPaneOpen, setTopicPaneOpen] = useClassicLayoutRightPaneOpen('chat', {
    enabled: isAssistantResourceLayout,
    defaultOpen: !isWindowFrame && panePosition === 'right'
  })
  // Shared topic facts plus exact derived lookups for rails, restore, and empty-topic reuse.
  const assistantTopicsSource = useAssistantTopicsSource({ enabled: isActiveTab && !isMessageOnlyView })
  const { stats: topicStats, loadLatestTopic, reuseOrCreateTopic } = assistantTopicsSource
  const { topic: routeApiTopic, isLoading: isRouteTopicLoading } = useTopicById(
    isMessageOnlyView ? routeTopicId : undefined
  )
  const routeTopic = useMemo(
    () => (routeApiTopic ? mapApiTopicToRendererTopic(routeApiTopic) : undefined),
    [routeApiTopic]
  )

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
  const resolveNewTopicAssistantId = useCallback(
    (explicitAssistantId?: string): string | undefined => {
      const isAvailableAssistantId = (assistantId: string | null | undefined): assistantId is string =>
        !!assistantId && assistantIdSet.has(assistantId)

      if (isAvailableAssistantId(explicitAssistantId)) {
        return explicitAssistantId
      }
      if (isAvailableAssistantId(validLastUsedAssistantId)) {
        return validLastUsedAssistantId
      }
      return assistants[0]?.id
    },
    [assistantIdSet, assistants, validLastUsedAssistantId]
  )

  const routeActiveTopicId = isMessageOnlyView ? null : (routeTopicId ?? null)
  const [activeTopicId, setActiveTopicIdState] = useState<string | null>(() => routeActiveTopicId)
  // Page-initiated selection writes the tab URL — the conversation's sole identity channel —
  // and mirrors into state immediately so the UI doesn't wait a router round trip. Route-driven
  // changes (entry interceptor, recovery) flow back through the sync effect below. Clearing
  // (`null`) never navigates: the next selection or the recovery path owns the URL then.
  const setActiveTopicId = useCallback(
    (id: string | null) => {
      ownerFallbackRequestIdRef.current += 1
      setActiveTopicIdState(id)
      if (id && !isMessageOnlyView) {
        void navigate({ to: '/app/chat', search: { topicId: id }, replace: true })
      }
    },
    [isMessageOnlyView, navigate]
  )

  useEffect(() => {
    ownerFallbackRequestIdRef.current += 1
    setActiveTopicIdState(routeActiveTopicId)
    return () => {
      ownerFallbackRequestIdRef.current += 1
    }
  }, [routeActiveTopicId])

  const {
    activeTopic,
    setActiveTopic,
    clearActiveTopic,
    isLoading: isActiveTopicLoading,
    error: activeTopicError,
    topicSource: activeTopicSource
  } = useActiveTopic({
    activeTopicId,
    setActiveTopicId,
    // Message-only view loads its target via useTopicById; the active hook
    // must not emit or expose a visible activeTopic.
    passive: isMessageOnlyView
  })
  const reenterChatRoute = useCallback(() => {
    clearActiveTopic()
    void navigate({ to: '/app/chat', search: {}, replace: true })
  }, [clearActiveTopic, navigate])
  // The URL-bound topic no longer exists: its by-id query settled with NOT_FOUND (deleted while
  // this tab was dormant, or a rotted deep link). Recovery is a plain replace-navigation back
  // through the entry interceptor, which resolves the next target — no in-page state surgery.
  useEffect(() => {
    if (isMessageOnlyView) return
    if (!routeTopicId || activeTopicId !== routeTopicId) return
    if (activeTopic || isActiveTopicLoading) return
    if (!isDataApiNotFoundError(activeTopicError)) return
    reenterChatRoute()
  }, [
    activeTopic,
    activeTopicError,
    activeTopicId,
    isActiveTopicLoading,
    isMessageOnlyView,
    reenterChatRoute,
    routeTopicId
  ])
  const lastVisibleTopicRef = useRef<Topic | undefined>(undefined)
  const visibleTopic = isMessageOnlyView
    ? routeTopic
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
  }, [visibleTopicAssistantScopeId, visibleTopicId])
  const requestComposerFocus = useComposerFocusRequest(visibleTopic?.id)
  const resourceConversationKey = useMemo(() => {
    if (visibleTopic?.id) return `topic:${visibleTopic.id}`
    return 'empty'
  }, [visibleTopic?.id])
  const conversationResourcesEnabled = !isMessageOnlyView && !isWindowFrame
  const {
    activeResourceKind,
    closeSurface,
    historyActive: historyRecordsActive,
    toggleHistory: toggleHistoryRecords,
    toggleResource
  } = useConversationCenterSurface<AssistantConversationResourceKind>({
    conversationKey: resourceConversationKey,
    disabled: !conversationResourcesEnabled,
    resourceKinds: ASSISTANT_CONVERSATION_RESOURCE_KINDS
  })
  const toggleAssistantResourceView = useCallback(() => toggleResource('assistant'), [toggleResource])
  const manageAssistantsActive = activeResourceKind === 'assistant'
  const onManageAssistants = conversationResourcesEnabled ? toggleAssistantResourceView : undefined

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
      setLastUsedTopicId(activeTopic.id)
    }
  }, [isActiveTab, activeTopic, activeTopicSource, setLastUsedTopicId])

  // Label this tab with its assistant emoji + topic name so multiple chat tabs
  // are distinguishable in the tab bar (every tab labels itself — not gated on active).
  const activeResourceAssistantId =
    isAssistantResourceLayout && panePosition === 'right' && rightPaneAssistantScopeId !== undefined
      ? rightPaneAssistantScopeId
      : visibleTopicAssistantScopeId
  const { assistant: visibleAssistant } = useAssistantApiById(activeResourceAssistantId ?? undefined)
  const visibleAssistantFromList = assistants.find((assistant) => assistant.id === activeResourceAssistantId)
  // Start the managed model query from the list hint before assistant details resolve; Chat shares the request.
  useModelById(visibleAssistantFromList?.modelId ?? visibleAssistant?.modelId)
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
  // While the bound topic is still loading (or the visible entity intentionally lags behind a
  // selection), keep the tab's stored title/icon instead of stamping a stale or generic one.
  const targetTopicId = isMessageOnlyView ? routeTopicId : (activeTopicId ?? undefined)
  const preserveTabVisuals = !!targetTopicId && visibleTopic?.id !== targetTopicId
  useTabSelfVisuals({
    title: visibleTopic?.name?.trim() || visibleAssistant?.name?.trim() || getDefaultRouteTitle('/app/chat'),
    emoji: visibleAssistant?.emoji,
    appId: 'assistants',
    preserveVisuals: preserveTabVisuals
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
    recordGlobalSearchRecentEntry(createRecentTopicEntryFromTopic(activeTopic))
  }, [activeTopic, isMessageOnlyView])

  const [topicPaneUserOpenIntentSeq, setTopicPaneUserOpenIntentSeq] = useState(0)
  useCommandHandler('app.sidebar.toggle', toggleShellPane)

  const setActiveTopicAndCloseResourceView = useCallback(
    (topic: Topic) => {
      activeTopicSelectionRef.current = topic
      closeSurface()
      setRightPaneAssistantScopeId(
        topic.assistantId && (!isAssistantListResolved || assistantIdSet.has(topic.assistantId))
          ? topic.assistantId
          : null
      )
      setActiveTopic(topic)
      return true
    },
    [assistantIdSet, closeSurface, isAssistantListResolved, setActiveTopic]
  )
  const clearActiveTopicAfterRemoval = useCallback(() => {
    activeTopicSelectionRef.current = undefined
    closeSurface()
    setPendingLocateMessageId(undefined)
    setTopicRevealRequest(undefined)
    reenterChatRoute()
  }, [closeSurface, reenterChatRoute])
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
  const activateCreatedTopic = useCallback(
    (topic: Topic) => {
      setActiveTopicAndCloseResourceView(topic)
      requestComposerFocus(topic.id)
    },
    [requestComposerFocus, setActiveTopicAndCloseResourceView]
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

        const result = await reuseOrCreateTopic(assistantId)
        const rendererTopic = mapApiTopicToRendererTopic(result.topic)

        activateCreatedTopic(rendererTopic)
        if (result.created) {
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
    [activateCreatedTopic, refreshTopics, resolveAssistantIdForSelection, reuseOrCreateTopic, t]
  )

  const resolveEmptyTopic = useCallback(
    async (payload?: AddNewTopicPayload): Promise<Topic> => {
      const assistantId = resolveNewTopicAssistantId(payload?.assistantId)
      const result =
        assistantId === undefined
          ? {
              topic: await createTopic({}),
              created: true
            }
          : await reuseOrCreateTopic(assistantId)

      if (result.created) {
        void refreshTopics().catch((err) => {
          logger.warn('Failed to refresh topics after composer topic create', err as Error)
        })
      }
      return mapApiTopicToRendererTopic(result.topic)
    },
    [createTopic, refreshTopics, resolveNewTopicAssistantId, reuseOrCreateTopic]
  )

  const createAndActivateEmptyTopic = useCallback(
    async (payload?: AddNewTopicPayload): Promise<Topic | null> => {
      if (isCreatingTopicRef.current) return null
      isCreatingTopicRef.current = true
      try {
        const topic = await resolveEmptyTopic(payload)
        activateCreatedTopic(topic)
        return topic
      } catch (err) {
        logger.error('Failed to create empty topic', err as Error)
        toast.error(formatErrorMessageWithPrefix(err, t('common.error')))
        return null
      } finally {
        isCreatingTopicRef.current = false
      }
    },
    [activateCreatedTopic, resolveEmptyTopic, t]
  )

  const handleCreateEmptyTopicForAssistant = useCallback(
    (assistantId: string) => resolveEmptyTopic({ assistantId }),
    [resolveEmptyTopic]
  )

  // No first-entry auto-create here: `DefaultAssistantSeeder` seeds one topic into every fresh
  // database. A bare entry that resolves to nothing means the user has no topic, so the page shows
  // its empty state until they explicitly create one. (AgentPage keeps its create-on-entry because
  // sessions have no seeder.)

  // After deleting the active assistant, preserve main's global-latest fallback
  // while proving it through the exact derived query instead of a fully-loaded list.
  const handleActiveAssistantDeleted = useCallback(
    async (deletedAssistantId: string) => {
      const requestId = ++ownerFallbackRequestIdRef.current
      const isCurrent = () =>
        ownerFallbackRequestIdRef.current === requestId &&
        activeTopicSelectionRef.current?.assistantId === deletedAssistantId

      setRightPaneAssistantScopeId(undefined)
      if (lastUsedAssistantId === deletedAssistantId) {
        setLastUsedAssistantId(null)
      }

      try {
        const nextTopic = await loadLatestTopic()
        if (!isCurrent()) return
        if (nextTopic) {
          setActiveTopicAndCloseResourceView(mapApiTopicToRendererTopic(nextTopic))
          return
        }
        reenterChatRoute()
      } catch (err) {
        if (!isCurrent()) return
        logger.error('Failed to settle chat after deleting active assistant', err as Error, { deletedAssistantId })
        toast.error(formatErrorMessageWithPrefix(err, t('common.error')))
        reenterChatRoute()
      }
    },
    [
      lastUsedAssistantId,
      loadLatestTopic,
      reenterChatRoute,
      setActiveTopicAndCloseResourceView,
      setLastUsedAssistantId,
      t
    ]
  )

  // "去对话" from the assistant library (after adding a preset): create/open a real empty topic
  // with that assistant selected.
  const handleOpenAssistantChatFromLibrary = useCallback(
    (assistantId: string) => {
      void createAndActivateEmptyTopic({ assistantId })
    },
    [createAndActivateEmptyTopic]
  )

  const handleHistoryTopicSelect = useCallback(
    (topic: Topic, messageId?: string) => {
      closeSurface()
      if (!setActiveTopicAndCloseResourceView(topic)) return
      setShellPaneOpen(true)
      setPendingLocateMessageId(messageId)
      topicRevealRequestIdRef.current += 1
      setTopicRevealRequest({
        clearFilters: true,
        clearQuery: true,
        itemId: topic.id,
        requestId: topicRevealRequestIdRef.current
      })
    },
    [closeSurface, setActiveTopicAndCloseResourceView, setShellPaneOpen]
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
        void createAndActivateEmptyTopic()
        return
      }

      handleHistoryTopicSelect(topic)
    },
    [closeHistoryRecords, createAndActivateEmptyTopic, handleHistoryTopicSelect]
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
                      sidebarOpen={shellPaneOpen}
                      onSidebarToggle={toggleShellPane}
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
      shellPaneOpen,
      handleOpenAssistantChatFromLibrary,
      isMessageOnlyView,
      isWindowFrame,
      toggleShellPane
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
                  sidebarOpen={shellPaneOpen}
                  onSidebarToggle={toggleShellPane}
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
      if (position === 'left') {
        const activeAssistantGroupId = visibleTopic
          ? getTopicAssistantDisplayGroupId({
              assistantId:
                visibleTopic.assistantId && assistantIdSet.has(visibleTopic.assistantId)
                  ? visibleTopic.assistantId
                  : null
            })
          : undefined
        const collapsedAssistantGroupIds = [
          ...assistants.map((assistant) => getTopicAssistantDisplayGroupId({ assistantId: assistant.id })),
          TOPIC_UNLINKED_ASSISTANT_GROUP_ID
        ].filter((groupId) => groupId !== activeAssistantGroupId)
        cacheService.setPersist('ui.topic.expansion.assistant', collapsedAssistantGroupIds)
      }
      await setPanePosition(position)
      setTopicPaneOpen(position === 'right', { force: true })
      setShellPaneOpen(true)
    },
    [assistantIdSet, assistants, setPanePosition, setShellPaneOpen, setTopicDisplayMode, setTopicPaneOpen, visibleTopic]
  )
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

  // Classic layout = entity rail + right topic panel; modern layout = one left navigation panel (HomeTabs).
  const pane =
    isAssistantResourceLayout && topicListPosition === 'right' ? (
      <AssistantResourceList
        activeAssistantId={activeResourceAssistantId}
        dataEnabled={shellPaneOpen}
        assistantTopicsSource={assistantTopicsSource}
        onAddAssistant={() => {
          setAssistantPickerOpen(true)
        }}
        historyRecordsActive={historyRecordsActive}
        onOpenHistoryRecords={isWindowFrame ? undefined : openHistoryRecords}
        onSelectTopic={handleResourceTopicSelect}
        onSelectedAssistantClick={() => {
          closeSurface()
          if (!topicPaneOpen) setTopicPaneUserOpenIntentSeq((seq) => seq + 1)
          setTopicPaneOpen(!topicPaneOpen)
        }}
        onCreateTopic={handleCreateEmptyTopicForAssistant}
        manageAssistantsActive={manageAssistantsActive}
        onManageAssistants={onManageAssistants}
        onActiveAssistantDeleted={handleActiveAssistantDeleted}
      />
    ) : (
      <HomeTabs
        activeTopic={visibleTopic}
        dataEnabled={shellPaneOpen}
        assistantTopicsSource={assistantTopicsSource}
        onActiveAssistantDeleted={handleActiveAssistantDeleted}
        onAddAssistant={() => {
          setAssistantPickerOpen(true)
        }}
        setActiveTopic={setActiveTopicAndCloseResourceView}
        onClearActiveTopic={clearActiveTopicAfterRemoval}
        onNewTopic={isMessageOnlyView ? undefined : createAndActivateEmptyTopic}
        historyRecordsActive={historyRecordsActive}
        onOpenHistoryRecords={isWindowFrame ? undefined : openHistoryRecords}
        revealRequest={topicRevealRequest}
        manageAssistantsActive={manageAssistantsActive}
        onManageAssistants={onManageAssistants}
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
              dataEnabled={topicPaneOpen}
              presentation="right-panel"
              activeTopic={visibleTopic}
              assistantIdFilter={activeResourceAssistantId}
              setActiveTopic={setActiveTopicAndCloseResourceView}
              onClearActiveTopic={clearActiveTopicAfterRemoval}
              onNewTopic={isMessageOnlyView ? undefined : createAndActivateEmptyTopic}
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
    <TopicRightPane.Scope
      resourcePane={resourcePane}
      topicId={visibleTopic?.id}
      topicName={visibleTopic?.name}
      traceId={visibleTopic?.traceId}
      present={!centerSurface}
      defaultOpen={topicPaneOpen}
      onOpenChange={isAssistantResourceLayout ? setTopicPaneOpen : undefined}
      userOpenIntentSeq={topicPaneUserOpenIntentSeq}
      revealRequest={topicRevealRequest}>
      <Container id="home-page">
        <ContentContainer $detached={isWindowFrame}>
          <Chat
            activeTopic={visibleTopic}
            topicPending={isActiveTopicLoading || isRouteTopicLoading}
            centerSurface={centerSurface}
            pane={pane}
            paneOpen={shellPaneOpen}
            panePosition="left"
            onPaneCollapse={() => setShellPaneOpenManually(false)}
            onPaneAutoCollapseChange={handlePaneAutoCollapseChange}
            paneManualToggle={paneManualToggle}
            onNewTopic={isMessageOnlyView ? undefined : (payload) => void createAndActivateEmptyTopic(payload)}
            onCreateEmptyTopic={isMessageOnlyView ? undefined : (payload) => void createAndActivateEmptyTopic(payload)}
            showResourceListControls={!isMessageOnlyView}
            sidebarOpen={shellPaneOpen}
            onSidebarToggle={toggleShellPane}
            locateMessageId={pendingLocateMessageId}
            onLocateMessageHandled={handleLocateMessageHandled}
            resourcePaneCount={topicResourcePaneCount}
          />
        </ContentContainer>
        {assistantPickerDialog}
      </Container>
    </TopicRightPane.Scope>
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
