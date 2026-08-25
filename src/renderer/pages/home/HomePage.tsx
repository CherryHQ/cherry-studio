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
import { useAssistants } from '@renderer/hooks/useAssistant'
import { toCreateAssistantDtoFromCatalogPreset } from '@renderer/hooks/useAssistantCatalogPresets'
import { useClassicLayoutRightPaneOpen } from '@renderer/hooks/useClassicLayoutRightPaneOpen'
import { useComposerFocusRequest } from '@renderer/hooks/useComposerFocusRequest'
import { useConversationCenterSurface } from '@renderer/hooks/useConversationCenterSurface'
import { useConversationLocateRequest } from '@renderer/hooks/useConversationLocateRequest'
import { useConversationShellPaneState } from '@renderer/hooks/useConversationShellPaneState'
import { useModelById } from '@renderer/hooks/useModel'
import { mapApiTopicToRendererTopic, useActiveTopic, useTopicById, useTopicMutations } from '@renderer/hooks/useTopic'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { ResourceListRevealPayload } from '@renderer/services/resourceListRevealEvents'
import { toast } from '@renderer/services/toast'
import type { Topic } from '@renderer/types/topic'
import { getTopicAssistantDisplayGroupId } from '@renderer/utils/chat/topicsHelpers'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { cn } from '@renderer/utils/style'
import { isDataApiNotFoundError } from '@shared/data/api/errors'
import { useNavigate, useSearch } from '@tanstack/react-router'
import type { FC, HTMLAttributes } from 'react'
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
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

type NewTopicAssistantSelectionSource = 'explicit' | 'route' | 'last-used' | 'first-assistant' | 'runtime-fallback'
type ResolvedNewTopicAssistantSelection = { assistantId?: string; source: NewTopicAssistantSelectionSource }

type NewTopicAssistantTargetOptions = {
  excludedAssistantIds?: readonly string[]
}

const HomePage: FC = () => {
  const { t } = useTranslation()
  const [topicRevealRequest, setTopicRevealRequest] = useState<ResourceListRevealRequest>()
  const topicRevealRequestIdRef = useRef(0)
  // Guards the classic-layout topic-create paths against re-entry: a rapid double-click would
  // otherwise read the same pre-refresh topic list twice and stack duplicate blank topics.
  const isCreatingTopicRef = useRef(false)
  const ownerFallbackRequestIdRef = useRef(0)
  const [lastUsedAssistantId, setLastUsedAssistantId] = usePersistCache(LAST_USED_ASSISTANT_CACHE_KEY)
  const [, setLastUsedTopicId] = usePersistCache('ui.chat.last_used_topic_id')
  const lastRecordedRecentTopicRef = useRef<string | undefined>(undefined)
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const [topicDisplayMode, setTopicDisplayMode] = usePreference('topic.tab.display_mode')
  const [panePosition, setPanePosition] = usePreference('topic.tab.position')
  const isClassicTopicLayout = topicDisplayMode === 'assistant'
  const [assistantPickerOpen, setAssistantPickerOpen] = useState(false)

  const routeSearch = parseChatRouteSearch(useSearch({ strict: false }) as Record<string, unknown>)
  const navigate = useNavigate()
  const routeTopicId = routeSearch.topicId
  const routeAssistantId = routeSearch.assistantId
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
    !isWindowFrame && isClassicTopicLayout && panePosition === 'right' ? 'right' : 'left'
  const [topicPaneOpen, setTopicPaneOpen] = useClassicLayoutRightPaneOpen('chat', {
    enabled: isClassicTopicLayout,
    defaultOpen: !isWindowFrame && panePosition === 'right'
  })
  // Shared full-topics list source plus exact latest/reusable lookups.
  const assistantTopicsSource = useAssistantTopicsSource()
  const { topics: allTopics, loadLatestTopic, reuseOrCreateTopic } = assistantTopicsSource
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
      // A sidebar `?assistantId=` entry whose assistant has no topics yet creates for that exact
      // assistant, not whatever was last focused (mirrors AgentPage's `preferredAgentId`).
      if (isAvailableAssistantId(routeAssistantId)) {
        return { assistantId: routeAssistantId, source: 'route' }
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
    [assistantIdSet, assistants, routeAssistantId, validLastUsedAssistantId]
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

  useLayoutEffect(() => {
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
    : (activeTopic ??
      (isActiveTopicLoading && lastVisibleTopicRef.current?.id === activeTopicId
        ? lastVisibleTopicRef.current
        : undefined))
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
      setLastUsedTopicId(activeTopic.id)
    }
  }, [isActiveTab, activeTopic, activeTopicSource, setLastUsedTopicId])

  // Label this tab with its assistant emoji + topic name so multiple chat tabs
  // are distinguishable in the tab bar (every tab labels itself — not gated on active).
  const visibleAssistantId = visibleTopic?.assistantId
  const visibleAssistant = assistants.find((assistant) => assistant.id === visibleAssistantId)
  // Start the managed model query before assistant details resolve; Chat shares the same SWR request.
  useModelById(visibleAssistant?.modelId)
  const topicResourcePaneCount = useMemo<ResourcePaneCountButtonProps | undefined>(() => {
    if (!isClassicTopicLayout || topicListPosition !== 'right' || !visibleAssistantId) return undefined

    return {
      label: t('chat.topics.title'),
      count: allTopics.filter((topic) => topic.assistantId === visibleAssistantId).length
    }
  }, [allTopics, isClassicTopicLayout, topicListPosition, t, visibleAssistantId])
  // While the bound topic is still loading, keep the tab's stored title/icon instead of stamping
  // a generic one.
  const targetTopicId = isMessageOnlyView ? routeTopicId : (activeTopicId ?? undefined)
  const { locateMessageId, requestLocate, clearLocate } = useConversationLocateRequest({
    activeConversationId: targetTopicId,
    visibleConversationId: visibleTopic?.id
  })
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
      closeSurface()
      clearLocate()
      setActiveTopic(topic)
      return true
    },
    [clearLocate, closeSurface, setActiveTopic]
  )
  const clearActiveTopicAndCloseResourceView = useCallback(() => {
    closeSurface()
    reenterChatRoute()
  }, [closeSurface, reenterChatRoute])

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
    async (payload?: AddNewTopicPayload, options?: NewTopicAssistantTargetOptions): Promise<Topic> => {
      const selection = resolveNewTopicAssistantTarget(payload?.assistantId, options)
      const reuseTargetAssistantId = selection.assistantId ?? (payload?.assistantId === null ? null : undefined)
      const result =
        reuseTargetAssistantId === undefined
          ? {
              topic: await createTopic({
                ...(selection.assistantId ? { assistantId: selection.assistantId } : {})
              }),
              created: true
            }
          : await reuseOrCreateTopic(reuseTargetAssistantId)

      if (result.created) {
        void refreshTopics().catch((err) => {
          logger.warn('Failed to refresh topics after composer topic create', err as Error)
        })
      }
      return mapApiTopicToRendererTopic(result.topic)
    },
    [createTopic, refreshTopics, resolveNewTopicAssistantTarget, reuseOrCreateTopic]
  )

  const createAndActivateEmptyTopic = useCallback(
    async (payload?: AddNewTopicPayload, options?: NewTopicAssistantTargetOptions): Promise<Topic | null> => {
      if (isCreatingTopicRef.current) return null
      isCreatingTopicRef.current = true
      try {
        const topic = await resolveEmptyTopic(payload, options)
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

  const handleCreateEmptyTopic = useCallback(
    async (payload?: AddNewTopicPayload) => {
      await createAndActivateEmptyTopic(payload)
    },
    [createAndActivateEmptyTopic]
  )

  const handleCreateEmptyTopicForAssistant = useCallback(
    (assistantId: string | null) => resolveEmptyTopic({ assistantId }),
    [resolveEmptyTopic]
  )

  // A bare entry with no resolvable topic stays empty until the user explicitly starts a conversation.

  // After deleting the active assistant, settle on the latest remaining topic or the empty route.
  const handleActiveAssistantDeleted = useCallback(
    async (deletedAssistantId: string) => {
      const requestId = ++ownerFallbackRequestIdRef.current
      if (lastUsedAssistantId === deletedAssistantId) {
        setLastUsedAssistantId(null)
      }
      try {
        const nextTopic = await loadLatestTopic()
        if (requestId !== ownerFallbackRequestIdRef.current) return
        if (nextTopic) {
          setActiveTopicAndCloseResourceView(mapApiTopicToRendererTopic(nextTopic))
          return
        }
        reenterChatRoute()
      } catch (err) {
        if (requestId !== ownerFallbackRequestIdRef.current) return
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
      if (messageId) requestLocate(topic.id, messageId)
      topicRevealRequestIdRef.current += 1
      setTopicRevealRequest({
        clearFilters: true,
        clearQuery: true,
        itemId: topic.id,
        requestId: topicRevealRequestIdRef.current
      })
    },
    [closeSurface, requestLocate, setActiveTopicAndCloseResourceView, setShellPaneOpen]
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

  const handleLocateMessageHandled = clearLocate
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
        const activeAssistantGroupId = visibleTopic ? getTopicAssistantDisplayGroupId(visibleTopic) : undefined
        const collapsedAssistantGroupIds = Array.from(
          new Set(
            allTopics.map(getTopicAssistantDisplayGroupId).filter((groupId) => groupId !== activeAssistantGroupId)
          )
        )
        cacheService.setPersist('ui.topic.expansion.assistant', collapsedAssistantGroupIds)
      }
      await setPanePosition(position)
      setTopicPaneOpen(position === 'right', { force: true })
      setShellPaneOpen(true)
    },
    [allTopics, setPanePosition, setShellPaneOpen, setTopicDisplayMode, setTopicPaneOpen, visibleTopic]
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
    isClassicTopicLayout && topicListPosition === 'right' ? (
      <AssistantResourceList
        activeAssistantId={visibleAssistantId ?? null}
        dataEnabled={shellPaneOpen}
        assistantTopicsSource={assistantTopicsSource}
        onAddAssistant={() => {
          setAssistantPickerOpen(true)
        }}
        historyRecordsActive={historyRecordsActive}
        onOpenHistoryRecords={isWindowFrame ? undefined : openHistoryRecords}
        onSelectTopic={setActiveTopicAndCloseResourceView}
        onClearActiveTopic={clearActiveTopicAndCloseResourceView}
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
        clearActiveTopic={clearActiveTopicAndCloseResourceView}
        setActiveTopic={setActiveTopicAndCloseResourceView}
        onNewTopic={isMessageOnlyView ? undefined : handleCreateEmptyTopic}
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
    isClassicTopicLayout && topicListPosition === 'right'
      ? {
          label: t('chat.topics.title'),
          node: (
            <Topics
              assistantTopicsSource={assistantTopicsSource}
              dataEnabled={topicPaneOpen}
              presentation="right-panel"
              activeTopic={visibleTopic}
              assistantIdFilter={visibleAssistantId ?? null}
              clearActiveTopic={clearActiveTopicAndCloseResourceView}
              setActiveTopic={setActiveTopicAndCloseResourceView}
              onNewTopic={isMessageOnlyView ? undefined : handleCreateEmptyTopic}
              onSetPanePosition={setTopicListPosition}
              panePosition="right"
              revealRequest={topicRevealRequest}
            />
          )
        }
      : null
  const assistantPickerDialog = isClassicTopicLayout ? (
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
      onOpenChange={isClassicTopicLayout ? setTopicPaneOpen : undefined}
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
            onNewTopic={isMessageOnlyView ? undefined : handleCreateEmptyTopic}
            onCreateEmptyTopic={isMessageOnlyView ? undefined : handleCreateEmptyTopic}
            showResourceListControls={!isMessageOnlyView}
            sidebarOpen={shellPaneOpen}
            onSidebarToggle={toggleShellPane}
            locateMessageId={locateMessageId}
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
