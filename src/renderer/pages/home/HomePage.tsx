import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { type ResourcePaneConfig, type ResourcePaneCountButtonProps } from '@renderer/components/chat/panes/Shell'
import { EmptyState, LoadingState } from '@renderer/components/chat/primitives'
import { AssistantResourceList } from '@renderer/components/chat/resourceList/AssistantResourceList'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resourceList/base'
import { ChatAppShell } from '@renderer/components/chat/shell/ChatAppShell'
import ConversationPageShell from '@renderer/components/chat/shell/ConversationPageShell'
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
import {
  ConversationResourceView,
  type ConversationResourceViewDefinition,
  useConversationResourceView
} from '@renderer/components/resourceCatalog/conversation'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useCommandHandler } from '@renderer/hooks/command'
import { useAssistantTopicsSource } from '@renderer/hooks/resourceViewSources'
import { useCurrentTab, useCurrentTabId, useIsActiveTab, useTabSelfMetadata } from '@renderer/hooks/tab'
import { useAssistantApiById, useAssistants } from '@renderer/hooks/useAssistant'
import { toCreateAssistantDtoFromCatalogPreset } from '@renderer/hooks/useAssistantCatalogPresets'
import { useClassicLayoutRightPaneOpen } from '@renderer/hooks/useClassicLayoutRightPaneOpen'
import { mapApiTopicToRendererTopic, useActiveTopic, useTopicById, useTopicMutations } from '@renderer/hooks/useTopic'
import { useWindowFrame } from '@renderer/hooks/useWindowFrame'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { ResourceListRevealPayload } from '@renderer/services/resourceListRevealEvents'
import { toast } from '@renderer/services/toast'
import type { Topic } from '@renderer/types/topic'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { findLatestUpdated, isUntouchedSinceCreation } from '@renderer/utils/resourceEntity'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { cn } from '@renderer/utils/style'
import { getTabInstanceKey } from '@renderer/utils/tabInstanceMetadata'
import type { Topic as ApiTopic } from '@shared/data/types/topic'
import { MIN_WINDOW_HEIGHT, SECOND_MIN_WINDOW_WIDTH } from '@shared/utils/window'
import { useLocation, useSearch } from '@tanstack/react-router'
import { MessageCircle } from 'lucide-react'
import type { FC, HTMLAttributes, ReactNode } from 'react'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import HistoryRecordsPage from '../history/HistoryRecordsPage'
import Chat from './Chat'
import {
  AssistantConversationPickerDialog,
  type AssistantConversationSelection
} from './components/AssistantConversationPickerDialog'
import { TopicRightPane } from './components/TopicRightPane'
import { parseChatRouteSearch } from './routeSearch'
import { Topics } from './Tabs/components/Topics'
import { getTopicAssistantDisplayGroupId } from './Tabs/components/topicsHelpers'
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

// Reuse the assistant's latest *empty* placeholder topic instead of stacking a new one. The empty
// topic only exists to surface the assistant in the classic-layout rail, so on repeated adds we reopen the
// existing placeholder rather than pile up blanks.
//
// Emptiness is detected via `isUntouchedSinceCreation` (updatedAt === createdAt), not a blank name:
// with auto-naming off a chatted-in topic keeps a blank name forever, so a name test would reopen it
// instead of starting a new conversation. See isUntouchedSinceCreation for the full rationale.
function findReusableEmptyTopic<T extends { assistantId?: string; createdAt?: string; updatedAt?: string }>(
  topics: readonly T[],
  assistantId: string | undefined
): T | undefined {
  if (!assistantId) return undefined
  return findLatestUpdated(
    topics.filter((topic) => topic.assistantId === assistantId && isUntouchedSinceCreation(topic))
  )
}

function mergeReusableTopicCandidates(apiTopics: readonly ApiTopic[], visibleTopic?: Topic): Topic[] {
  const byId = new Map<string, Topic>()

  for (const topic of apiTopics) {
    byId.set(topic.id, mapApiTopicToRendererTopic(topic))
  }
  if (visibleTopic?.id && !visibleTopic.name.trim()) {
    byId.set(visibleTopic.id, visibleTopic)
  }

  return Array.from(byId.values())
}

const HomePage: FC = () => {
  const { t } = useTranslation()
  const [topicRevealRequest, setTopicRevealRequest] = useState<ResourceListRevealRequest>()
  const topicRevealRequestIdRef = useRef(0)
  const initialTopicStartStateRef = useRef<InitialTopicStartState>({ firstLaunchStarted: false })
  // Guards the classic-layout topic-create paths against re-entry: a rapid double-click would
  // otherwise read the same pre-refresh topic list twice and stack duplicate blank topics.
  const isCreatingTopicRef = useRef(false)
  const [lastUsedAssistantId, setLastUsedAssistantId] = usePersistCache(LAST_USED_ASSISTANT_CACHE_KEY)
  const [, setLastUsedTopicId] = usePersistCache('ui.chat.last_used_topic_id')
  const [, setRecentItems] = usePersistCache('ui.global_search.recent_items')
  const [, setTopicExpansionAssistant] = usePersistCache('ui.topic.expansion.assistant')
  const lastRecordedRecentTopicRef = useRef<string | undefined>(undefined)
  const [pendingLocateMessageId, setPendingLocateMessageId] = useState<string | undefined>()
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const [topicDisplayMode, setTopicDisplayMode] = usePreference('topic.tab.display_mode')
  const [panePosition, setPanePosition] = usePreference('topic.tab.position')
  const [autoCollapsedResourceList, setAutoCollapsedResourceList] = useState(false)
  const isClassicTopicLayout = topicDisplayMode === 'assistant'
  // Classic-layout right-pane open state, cached on the assistant surface's own key.
  const [topicPaneOpen, setTopicPaneOpen] = useClassicLayoutRightPaneOpen('chat', isClassicTopicLayout)
  const [historyRecordsOpen, setHistoryRecordsOpen] = useState(false)
  const [assistantPickerOpen, setAssistantPickerOpen] = useState(false)

  const location = useLocation()
  const routeSearch = parseChatRouteSearch(useSearch({ strict: false }) as Record<string, unknown>)
  const currentTab = useCurrentTab()
  const state = location.state as { topic?: Topic } | undefined
  const routeTopicId = routeSearch.topicId
  const tabMetadataTopicId = currentTab ? getTabInstanceKey(currentTab, 'assistants') : undefined
  const routeAssistantId = routeTopicId ? undefined : routeSearch.assistantId
  const isMessageOnlyView = routeSearch.view === 'message' && !!routeTopicId
  // Shared full-topics source for classic history selection and persisted empty-topic reuse.
  // Modern layout also creates real empty topics now, so it needs the same candidates.
  const assistantTopicsSource = useAssistantTopicsSource({ enabled: !isMessageOnlyView })
  const { topics: allTopics, isLoading: isTopicsFirstPageLoading } = assistantTopicsSource
  // First-entry selection only needs the most-recently-updated topic, which arrives on the first
  // page (the server orders topics by `updatedAt DESC`). Gate on the first page landing, not on the
  // full history finishing pagination, so a large topic history never blocks the initial paint.
  const isTopicListFirstPageReady = isMessageOnlyView || !isTopicsFirstPageLoading
  // Detached windows are single-topic: no topic list, so no sidebar at all.
  const isWindowFrame = useWindowFrame().mode === 'window'
  const effectiveShowSidebar = !isMessageOnlyView && !isWindowFrame && showSidebar && !autoCollapsedResourceList
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
    setActiveTopicId(routeActiveTopicId)
  }, [routeActiveTopicId])

  const {
    activeTopic,
    setActiveTopic,
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
    : (activeTopic ?? (isActiveTopicLoading ? lastVisibleTopicRef.current : undefined) ?? undefined)
  const topicReuseCandidates = useMemo(
    () => mergeReusableTopicCandidates(allTopics, visibleTopic),
    [allTopics, visibleTopic]
  )
  const resourceConversationKey = useMemo(() => {
    if (visibleTopic?.id) return `topic:${visibleTopic.id}`
    return 'empty'
  }, [visibleTopic?.id])
  const resourceViewDefinitions = useMemo<
    readonly ConversationResourceViewDefinition<AssistantConversationResourceKind>[]
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
    activeKind: activeResourceViewKind,
    close: closeResourceView,
    menuItems: resourceMenuItems
  } = useConversationResourceView<AssistantConversationResourceKind>({
    conversationKey: resourceConversationKey,
    definitions: resourceViewDefinitions,
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
      setLastUsedTopicId(activeTopic.id)
    }
  }, [isActiveTab, activeTopic, activeTopicSource, setLastUsedTopicId])

  // Label this tab with its assistant emoji + topic name so multiple chat tabs
  // are distinguishable in the tab bar (every tab labels itself — not gated on active).
  const visibleAssistantId = visibleTopic?.assistantId
  const { assistant: visibleAssistant } = useAssistantApiById(visibleAssistantId ?? undefined)
  const topicResourcePaneCount = useMemo<ResourcePaneCountButtonProps | undefined>(() => {
    if (!isClassicTopicLayout || panePosition !== 'right' || !visibleAssistantId) return undefined

    return {
      label: t('chat.topics.title'),
      count: allTopics.filter((topic) => topic.assistantId === visibleAssistantId).length
    }
  }, [allTopics, isClassicTopicLayout, panePosition, t, visibleAssistantId])
  const tabInstanceTopicId = !isMessageOnlyView ? (visibleTopic?.id ?? routeActiveTopicId ?? undefined) : undefined
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
    setRecentItems((prev) => upsertGlobalSearchRecentEntry(prev ?? [], createRecentTopicEntryFromTopic(activeTopic)))
  }, [activeTopic, isMessageOnlyView, setRecentItems])

  const setResourceListOpen = useCallback(
    (open: boolean) => {
      setAutoCollapsedResourceList(false)
      void setShowSidebar(open)
    },
    [setShowSidebar]
  )
  const handleResourceListAutoCollapseChange = useCallback((collapsed: boolean) => {
    setAutoCollapsedResourceList(collapsed)
  }, [])
  const toggleResourceListOpen = useCallback(() => {
    if (isMessageOnlyView || isWindowFrame) return

    if (effectiveShowSidebar) {
      setResourceListOpen(false)
      return
    }

    setResourceListOpen(true)
    requestAnimationFrame(() => {
      void EventEmitter.emit(EVENT_NAMES.SHOW_ASSISTANTS)
    })
  }, [effectiveShowSidebar, isMessageOnlyView, isWindowFrame, setResourceListOpen])
  useCommandHandler('app.sidebar.toggle', toggleResourceListOpen)

  useEffect(() => {
    if (isMessageOnlyView) return
    if (!state?.topic) return
    setActiveTopic(state.topic)
  }, [isMessageOnlyView, setActiveTopic, state?.topic])

  const setActiveTopicAndCloseResourceView = useCallback(
    (topic: Topic) => {
      closeResourceView()
      setActiveTopic(topic)
      return true
    },
    [closeResourceView, setActiveTopic]
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

        // Reuse the assistant's latest empty placeholder topic (see findReusableEmptyTopic).
        const reusableTopic = findReusableEmptyTopic(topicReuseCandidates, assistantId)

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
      refreshTopics,
      resolveAssistantIdForSelection,
      setActiveTopicAndCloseResourceView,
      t,
      topicReuseCandidates
    ]
  )

  const createAndActivateEmptyTopic = useCallback(
    async (payload?: AddNewTopicPayload, options?: NewTopicAssistantTargetOptions): Promise<Topic | null> => {
      if (isCreatingTopicRef.current) return null
      isCreatingTopicRef.current = true
      try {
        const selection = resolveNewTopicAssistantTarget(payload?.assistantId, options)
        const reusableTopic = findReusableEmptyTopic(topicReuseCandidates, selection.assistantId)
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
      refreshTopics,
      resolveNewTopicAssistantTarget,
      setActiveTopicAndCloseResourceView,
      t,
      topicReuseCandidates
    ]
  )

  const createAndActivateFreshTopic = useCallback(
    async (payload: AddNewTopicPayload) => {
      if (isCreatingTopicRef.current) return
      isCreatingTopicRef.current = true
      try {
        const selection = resolveNewTopicAssistantTarget(payload.assistantId)
        const topic = await createTopic({
          ...(selection.assistantId ? { assistantId: selection.assistantId } : {})
        })
        setActiveTopicAndCloseResourceView(mapApiTopicToRendererTopic(topic))
        void refreshTopics().catch((err) => {
          logger.warn('Failed to refresh topics after fresh topic create', err as Error)
        })
      } catch (err) {
        logger.error('Failed to create fresh topic', err as Error)
        toast.error(formatErrorMessageWithPrefix(err, t('common.error')))
      } finally {
        isCreatingTopicRef.current = false
      }
    },
    [createTopic, refreshTopics, resolveNewTopicAssistantTarget, setActiveTopicAndCloseResourceView, t]
  )

  const handleCreateEmptyTopic = useCallback(
    (payload?: AddNewTopicPayload) => {
      void createAndActivateEmptyTopic(payload)
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
    if (!shouldAutoCreateTopic || initialTopicStartStateRef.current.firstLaunchStarted || state?.topic) return
    if (activeTopic || isActiveTopicLoading) return
    if (!isAssistantListResolved) return
    if (!isTopicListFirstPageReady) return

    initialTopicStartStateRef.current.firstLaunchStarted = true

    // Both layouts resume the most-recently-updated topic on entry; only a genuinely empty library
    // falls through to creating a blank. A deep link that pins an assistant (`routeAssistantId`)
    // skips resume and opens a fresh topic for that assistant instead.
    if (!routeAssistantId) {
      const latestTopic = findLatestUpdated(allTopics)
      if (latestTopic) {
        setActiveTopic(mapApiTopicToRendererTopic(latestTopic))
        return
      }
    }

    void createAndActivateEmptyTopic(routeAssistantId ? { assistantId: routeAssistantId } : undefined).then((topic) => {
      if (!topic) initialTopicStartStateRef.current.firstLaunchStarted = false
    })
  }, [
    activeTopic,
    allTopics,
    createAndActivateEmptyTopic,
    isActiveTopicLoading,
    isAssistantListResolved,
    isTopicListFirstPageReady,
    routeAssistantId,
    setActiveTopic,
    shouldAutoCreateTopic,
    state?.topic
  ])

  // Classic-layout reset after deleting the active assistant: select the latest
  // remaining topic (across other assistants). Filter by the deleted id so this
  // is correct even before the topic cache refetches. If nothing remains, create
  // a real empty topic with another available assistant.
  const handleActiveAssistantDeleted = useCallback(
    (deletedAssistantId: string) => {
      const nextTopic = findLatestUpdated(allTopics.filter((topic) => topic.assistantId !== deletedAssistantId))
      if (lastUsedAssistantId === deletedAssistantId) {
        setLastUsedAssistantId(null)
      }
      if (nextTopic && setActiveTopicAndCloseResourceView(mapApiTopicToRendererTopic(nextTopic))) {
        return
      }
      void createAndActivateEmptyTopic(undefined, { excludedAssistantIds: [deletedAssistantId] })
    },
    [
      allTopics,
      createAndActivateEmptyTopic,
      lastUsedAssistantId,
      setActiveTopicAndCloseResourceView,
      setLastUsedAssistantId
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

  useEffect(() => {
    void window.api.window.setMinimumSize(SECOND_MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)

    return () => {
      void window.api.window.resetMinimumSize()
    }
  }, [])

  const handleHistoryTopicSelect = useCallback(
    (topic: Topic, messageId?: string) => {
      closeResourceView()
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
    [closeResourceView, setActiveTopicAndCloseResourceView, setResourceListOpen]
  )
  const closeHistoryRecords = useCallback(() => {
    setHistoryRecordsOpen(false)
  }, [])
  const openHistoryRecords = useCallback(() => {
    setHistoryRecordsOpen(true)
  }, [])
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
      activeResourceViewKind
        ? {
            className: 'relative',
            content: (
              <ConversationResourceView
                kind={activeResourceViewKind}
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
      activeResourceViewKind,
      effectiveShowSidebar,
      handleOpenAssistantChatFromLibrary,
      isMessageOnlyView,
      isWindowFrame,
      toggleResourceListOpen
    ]
  )
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
        setTopicExpansionAssistant(collapsedAssistantGroupIds)
      }
      await setPanePosition(position)
      setTopicPaneOpen(position === 'right', { force: true })
      setResourceListOpen(true)
    },
    [
      allTopics,
      setPanePosition,
      setResourceListOpen,
      setTopicDisplayMode,
      setTopicExpansionAssistant,
      setTopicPaneOpen,
      visibleTopic
    ]
  )
  const topicListPosition: ChatPanePosition = isClassicTopicLayout && panePosition === 'right' ? 'right' : 'left'
  const shellPanePosition: ChatPanePosition = 'left'

  if (!visibleTopic && !resourceCenter) {
    if (isMessageOnlyView) {
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

    return <Container id="home-page" />
  }

  // Classic layout = entity rail + right topic panel; modern layout = the single sidebar (HomeTabs).
  const pane =
    isClassicTopicLayout && topicListPosition === 'right' ? (
      <AssistantResourceList
        activeAssistantId={visibleAssistantId ?? null}
        assistantTopicsSource={assistantTopicsSource}
        onAddAssistant={() => {
          setAssistantPickerOpen(true)
        }}
        onOpenHistoryRecords={openHistoryRecords}
        onSelectTopic={setActiveTopicAndCloseResourceView}
        onCreateTopicAfterClear={(assistantId) => createAndActivateFreshTopic({ assistantId })}
        onSelectedAssistantClick={() => setTopicPaneOpen(!topicPaneOpen)}
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
        onCreateTopicAfterClear={isMessageOnlyView ? undefined : createAndActivateFreshTopic}
        onNewTopic={isMessageOnlyView ? undefined : handleCreateEmptyTopic}
        onOpenHistoryRecords={openHistoryRecords}
        revealRequest={topicRevealRequest}
        resourceMenuItems={resourceMenuItems}
        onSetPanePosition={setTopicListPosition}
        panePosition="left"
      />
    )
  // In classic layout the topic list moves into the chat's right pane as a tab; the single page-level
  // provider owns the Shell for both views so the rail and the right panel share its open/maximize
  // state. New (sidebar) view passes a null config, leaving the pane as branch/trace only.
  const resourcePane: ResourcePaneConfig | null =
    isClassicTopicLayout && topicListPosition === 'right'
      ? {
          label: t('chat.topics.title'),
          node: (
            <Topics
              assistantTopicsSource={assistantTopicsSource}
              presentation="right-panel"
              activeTopic={visibleTopic}
              assistantIdFilter={visibleAssistantId ?? null}
              setActiveTopic={setActiveTopicAndCloseResourceView}
              onCreateTopicAfterClear={isMessageOnlyView ? undefined : createAndActivateFreshTopic}
              onNewTopic={isMessageOnlyView ? undefined : handleCreateEmptyTopic}
              onSetPanePosition={setTopicListPosition}
              panePosition="right"
              revealRequest={topicRevealRequest}
            />
          )
        }
      : null
  const renderWithRightPane = (content: ReactNode) => (
    <TopicRightPane
      resourcePane={resourcePane}
      defaultOpen={topicPaneOpen}
      onOpenChange={isClassicTopicLayout ? setTopicPaneOpen : undefined}
      revealRequest={topicRevealRequest}>
      {content}
    </TopicRightPane>
  )
  const historyRecordsOverlay = (
    <HistoryRecordsPage
      mode="assistant"
      open={historyRecordsOpen && !isMessageOnlyView && !isWindowFrame}
      activeRecordId={activeTopicId}
      onClose={closeHistoryRecords}
      onRecordSelect={handleHistoryRecordsTopicSelect}
    />
  )
  const assistantPickerDialog = isClassicTopicLayout ? (
    <AssistantConversationPickerDialog
      open={assistantPickerOpen}
      onOpenChange={setAssistantPickerOpen}
      assistants={assistants}
      assistantsLoading={isAssistantsLoading || isAssistantsRefreshing}
      onSelect={handleAssistantConversationSelect}
    />
  ) : null

  if (resourceCenter) {
    return (
      <Container id="home-page">
        <ContentContainer $detached={isWindowFrame}>
          <ConversationPageShell
            id="chat"
            center={resourceCenter}
            pane={pane}
            paneOpen={effectiveShowSidebar}
            panePosition={shellPanePosition}
            onPaneCollapse={() => setResourceListOpen(false)}
            onPaneAutoCollapseChange={handleResourceListAutoCollapseChange}
          />
        </ContentContainer>
        {assistantPickerDialog}
        {historyRecordsOverlay}
      </Container>
    )
  }

  const chatTopic = visibleTopic
  if (!chatTopic) return <Container id="home-page" />

  return renderWithRightPane(
    <Container id="home-page">
      <ContentContainer $detached={isWindowFrame}>
        <Chat
          activeTopic={chatTopic}
          pane={pane}
          paneOpen={effectiveShowSidebar}
          panePosition={shellPanePosition}
          onPaneCollapse={() => setResourceListOpen(false)}
          onPaneAutoCollapseChange={handleResourceListAutoCollapseChange}
          onNewTopic={isMessageOnlyView ? undefined : handleCreateEmptyTopic}
          onCreateEmptyTopic={isMessageOnlyView ? undefined : handleCreateEmptyTopic}
          showResourceListControls={!isMessageOnlyView && !isWindowFrame}
          sidebarOpen={effectiveShowSidebar}
          onSidebarToggle={toggleResourceListOpen}
          locateMessageId={pendingLocateMessageId}
          onLocateMessageHandled={handleLocateMessageHandled}
          resourcePaneCount={topicResourcePaneCount}
        />
      </ContentContainer>
      {assistantPickerDialog}
      {historyRecordsOverlay}
    </Container>
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
