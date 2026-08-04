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
import { useCurrentTab, useCurrentTabId, useIsActiveTab, useTabSelfMetadata } from '@renderer/hooks/tab'
import { useAssistantApiById, useAssistants } from '@renderer/hooks/useAssistant'
import { toCreateAssistantDtoFromCatalogPreset } from '@renderer/hooks/useAssistantCatalogPresets'
import { useClassicLayoutRightPaneOpen } from '@renderer/hooks/useClassicLayoutRightPaneOpen'
import {
  type ConversationCenterResourceDefinition,
  useConversationCenterSurface
} from '@renderer/hooks/useConversationCenterSurface'
import { useConversationShellPaneState } from '@renderer/hooks/useConversationShellPaneState'
import { useModelById } from '@renderer/hooks/useModel'
import {
  mapApiTopicToRendererTopic,
  useActiveTopic,
  useLatestTopic,
  useTopicById,
  useTopicMutations
} from '@renderer/hooks/useTopic'
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
import type { AddNewTopicPayload, AddNewTopicWithReusePayload } from './types'

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
  const [rightPaneAssistantScopeId, setRightPaneAssistantScopeId] = useState<string | null | undefined>(undefined)
  const lastRecordedRecentTopicRef = useRef<string | undefined>(undefined)
  const [pendingLocateMessageId, setPendingLocateMessageId] = useState<string | undefined>()
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const [topicDisplayMode, setTopicDisplayMode] = usePreference('topic.tab.display_mode')
  const [panePosition, setPanePosition] = usePreference('topic.tab.position')
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
  const assistantTopicsSource = useAssistantTopicsSource()
  const { stats: topicStats, loadLatestTopic, loadReusableTopic } = assistantTopicsSource
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
  // Resume target frozen at mount: `last_used_topic_id` is rewritten as soon as any topic
  // activates, so a reactive read would chase this page's own writes. Route / tab-metadata
  // targets and assistant deep links take precedence over resume.
  const [resumeTopicId] = useState<string | null>(() =>
    shouldAutoCreateTopic && !routeActiveTopicId && !routeAssistantId
      ? cacheService.getPersist('ui.chat.last_used_topic_id')
      : null
  )
  const { topic: resumeApiTopic, isLoading: isResumeTopicLoading } = useTopicById(resumeTopicId ?? undefined)
  // The global most-recently-active query is the final fallback, not a parallel page dependency. An explicit
  // topic/tab or assistant deep link wins outright; a remembered topic gets one chance to resolve before we ask for it.
  const shouldLoadLatestTopic =
    shouldAutoCreateTopic &&
    !isMessageOnlyView &&
    !routeActiveTopicId &&
    !routeAssistantId &&
    !isResumeTopicLoading &&
    !resumeApiTopic
  const { latestTopic, isLoading: isLatestTopicLoading } = useLatestTopic({
    enabled: shouldLoadLatestTopic
  })
  const isLatestTopicReady = !shouldLoadLatestTopic || !isLatestTopicLoading

  useEffect(() => {
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
    recordGlobalSearchRecentEntry(createRecentTopicEntryFromTopic(activeTopic))
  }, [activeTopic, isMessageOnlyView])

  const [topicPaneUserOpenIntentSeq, setTopicPaneUserOpenIntentSeq] = useState(0)
  useCommandHandler('app.sidebar.toggle', toggleShellPane)

  useEffect(() => {
    if (isMessageOnlyView) return
    if (!state?.topic) return
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
      setActiveTopic(topic)
      return true
    },
    [assistantIdSet, closeSurface, isAssistantListResolved, setActiveTopic]
  )
  const clearActiveTopicAfterReplacementFailure = useCallback(() => {
    activeTopicSelectionRef.current = undefined
    closeSurface()
    setPendingLocateMessageId(undefined)
    setTopicRevealRequest(undefined)
    clearActiveTopic()
  }, [clearActiveTopic, closeSurface])
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
    async (payload?: AddNewTopicWithReusePayload, options?: NewTopicAssistantTargetOptions): Promise<Topic | null> => {
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
        const reusableTopic =
          reusableApiTopic && reusableApiTopic.id !== payload?.excludeReuseTopicId
            ? mapApiTopicToRendererTopic(reusableApiTopic)
            : undefined
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
    async (payload?: AddNewTopicWithReusePayload) => {
      const created = await createAndActivateEmptyTopic(payload)
      if (!created && payload?.excludeReuseTopicId) {
        clearActiveTopicAfterReplacementFailure()
      }
      return created
    },
    [clearActiveTopicAfterReplacementFailure, createAndActivateEmptyTopic]
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

    // Resume the last-focused topic before falling back to the most-recently-active one —
    // "last viewed" and "last edited" differ, and sidebar/restart re-entry should land on
    // what the user was looking at. A deleted (or unfetchable) last-used topic falls through.
    if (resumeTopicId) {
      if (isResumeTopicLoading) return
      if (resumeApiTopic) {
        initialTopicStartStateRef.current.firstLaunchStarted = true
        setActiveTopic(mapApiTopicToRendererTopic(resumeApiTopic))
        return
      }
    }

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
    isResumeTopicLoading,
    latestTopic,
    resumeApiTopic,
    resumeTopicId,
    routeAssistantId,
    setActiveTopic,
    shouldAutoCreateTopic,
    state?.topic
  ])

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

      const nextTopic = await loadLatestTopic()
      if (!isCurrent()) return
      if (nextTopic && setActiveTopicAndCloseResourceView(mapApiTopicToRendererTopic(nextTopic))) {
        return
      }

      const created = await createAndActivateEmptyTopic(undefined, { excludedAssistantIds: [deletedAssistantId] })
      if (!created && isCurrent()) clearActiveTopicAfterReplacementFailure()
    },
    [
      clearActiveTopicAfterReplacementFailure,
      createAndActivateEmptyTopic,
      lastUsedAssistantId,
      loadLatestTopic,
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
    void ipcApi.request('window.main.set_minimum_size', { width: SECOND_MIN_WINDOW_WIDTH, height: MIN_WINDOW_HEIGHT })

    return () => {
      void ipcApi.request('window.main.reset_minimum_size')
    }
  }, [])

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
        const activeAssistantGroupId = visibleTopic ? getTopicAssistantDisplayGroupId(visibleTopic) : undefined
        const collapsedAssistantGroupIds = Array.from(
          new Set(
            (topicStats?.byAssistant ?? [])
              .map(({ assistantId }) => getTopicAssistantDisplayGroupId({ assistantId }))
              .filter((groupId) => groupId !== activeAssistantGroupId)
          )
        )
        cacheService.setPersist('ui.topic.expansion.assistant', collapsedAssistantGroupIds)
      }
      await setPanePosition(position)
      setTopicPaneOpen(position === 'right', { force: true })
      setShellPaneOpen(true)
    },
    [setPanePosition, setShellPaneOpen, setTopicDisplayMode, setTopicPaneOpen, topicStats?.byAssistant, visibleTopic]
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

  // Classic layout = entity rail + right topic panel; modern layout = the single sidebar (HomeTabs).
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
        onCreateTopicAfterClear={(assistantId) => createAndActivateFreshTopic({ assistantId })}
        onSelectedAssistantClick={() => {
          closeSurface()
          if (!topicPaneOpen) setTopicPaneUserOpenIntentSeq((seq) => seq + 1)
          setTopicPaneOpen(!topicPaneOpen)
        }}
        onCreateTopic={handleCreateEmptyTopicForAssistant}
        resourceMenuItems={resourceMenuItems}
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
        onClearActiveTopic={clearActiveTopicAfterReplacementFailure}
        onCreateTopicAfterClear={createAndActivateFreshTopic}
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
              dataEnabled={topicPaneOpen}
              presentation="right-panel"
              activeTopic={visibleTopic}
              assistantIdFilter={activeResourceAssistantId}
              setActiveTopic={setActiveTopicAndCloseResourceView}
              onClearActiveTopic={clearActiveTopicAfterReplacementFailure}
              onCreateTopicAfterClear={createAndActivateFreshTopic}
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
            centerSurface={centerSurface}
            pane={pane}
            paneOpen={shellPaneOpen}
            panePosition="left"
            onPaneCollapse={() => setShellPaneOpenManually(false)}
            onPaneAutoCollapseChange={handlePaneAutoCollapseChange}
            paneManualToggle={paneManualToggle}
            onNewTopic={isMessageOnlyView ? undefined : (payload) => void handleCreateEmptyTopic(payload)}
            onCreateEmptyTopic={isMessageOnlyView ? undefined : (payload) => void handleCreateEmptyTopic(payload)}
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
