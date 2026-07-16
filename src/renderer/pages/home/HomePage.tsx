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
import { useClassicLayoutRightPaneOpen } from '@renderer/hooks/useClassicLayoutRightPaneOpen'
import {
  type ConversationCenterResourceDefinition,
  useConversationCenterSurface
} from '@renderer/hooks/useConversationCenterSurface'
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
import { findLatestUpdated } from '@renderer/utils/resourceEntity'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { cn } from '@renderer/utils/style'
import { getTabInstanceKey } from '@renderer/utils/tabInstanceMetadata'
import type { Topic as ApiTopic } from '@shared/data/types/topic'
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

// A topic is a reusable empty placeholder when it is structurally empty *and* not a deliberately
// named one. Emptiness is read straight from `activeNodeId`: a fresh topic starts with no active node
// and the first real message points it at one (the virtual root can never be the active node), so
// `!activeNodeId` provably means "no conversation started". This is authoritative and migration-safe —
// unlike an `updatedAt`-vs-`createdAt` timestamp proxy, which reads persisted / migrated rows as
// "untouched" even when they already carry messages, and so would reopen a real conversation (#16434).
// The name guard mirrors the agent-session `isUntitledPlaceholderSession`: it keeps a placeholder the
// user manually renamed from being silently repurposed on the next "new topic".
function isReusableEmptyTopic(topic: { activeNodeId?: string; name: string; isNameManuallyEdited?: boolean }): boolean {
  return !topic.activeNodeId && !topic.name.trim() && !topic.isNameManuallyEdited
}

// Reuse the assistant's latest empty placeholder topic instead of stacking a new one. The empty topic
// only exists to surface the assistant in the classic-layout rail, so on repeated adds we reopen the
// existing placeholder rather than pile up blanks.
function findReusableEmptyTopic<
  T extends {
    assistantId?: string
    activeNodeId?: string
    name: string
    isNameManuallyEdited?: boolean
    updatedAt?: string
  }
>(topics: readonly T[], assistantId: string | null | undefined): T | undefined {
  // `undefined` → no reuse target (e.g. runtime fallback with no assistants). `null` → the
  // default/unassigned group: match empty topics that likewise have no assistant, so repeated "new
  // topic" there reopens the placeholder instead of stacking blanks. `!topic.assistantId` covers every
  // "no assistant" encoding (undefined / null / '').
  if (assistantId === undefined) return undefined
  const matchesTarget = (topic: T) => (assistantId === null ? !topic.assistantId : topic.assistantId === assistantId)
  // `findLatestUpdated` only ranks the already-confirmed-empty matches; it never decides emptiness.
  return findLatestUpdated(topics.filter((topic) => matchesTarget(topic) && isReusableEmptyTopic(topic)))
}

function mergeReusableTopicCandidates(apiTopics: readonly ApiTopic[], visibleTopic?: Topic): Topic[] {
  const byId = new Map<string, Topic>()

  for (const topic of apiTopics) {
    byId.set(topic.id, mapApiTopicToRendererTopic(topic))
  }
  // The in-memory active topic may be a just-created placeholder not yet in the persisted source;
  // include it (only while still empty) so it is reusable before the topic list refetches.
  if (visibleTopic?.id && isReusableEmptyTopic(visibleTopic)) {
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
  const [detachedSidebarOpen, setDetachedSidebarOpen] = useState(false)
  const [topicDisplayMode, setTopicDisplayMode] = usePreference('topic.tab.display_mode')
  const [panePosition, setPanePosition] = usePreference('topic.tab.position')
  const [autoCollapsedResourceList, setAutoCollapsedResourceList] = useState(false)
  const isClassicTopicLayout = topicDisplayMode === 'assistant'
  // Classic-layout right-pane open state, cached on the assistant surface's own key.
  const [topicPaneOpen, setTopicPaneOpen] = useClassicLayoutRightPaneOpen('chat', isClassicTopicLayout)
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
  const { topics: allTopics } = assistantTopicsSource
  // First-entry selection resumes the most-recently-updated topic. A dedicated `updatedAt DESC LIMIT 1`
  // query proves the global latest, so it neither waits for the full topic history to paginate in nor
  // depends on the pinned-first `/topics` list order (which would miss the latest unpinned topic when
  // ≥200 pinned topics fill the first page).
  const { latestTopic, isLoading: isLatestTopicLoading } = useLatestTopic({ enabled: !isMessageOnlyView })
  const isLatestTopicReady = isMessageOnlyView || !isLatestTopicLoading
  const isWindowFrame = useWindowFrame().mode === 'window'
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
  const topicReuseCandidates = useMemo(
    () => mergeReusableTopicCandidates(allTopics, visibleTopic),
    [allTopics, visibleTopic]
  )
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
      setLastUsedTopicId(activeTopic.id)
    }
  }, [isActiveTab, activeTopic, activeTopicSource, setLastUsedTopicId])

  // Label this tab with its assistant emoji + topic name so multiple chat tabs
  // are distinguishable in the tab bar (every tab labels itself — not gated on active).
  const visibleAssistantId = visibleTopic?.assistantId
  const { assistant: visibleAssistant } = useAssistantApiById(visibleAssistantId ?? undefined)
  const topicListPosition: ChatPanePosition =
    !isWindowFrame && isClassicTopicLayout && panePosition === 'right' ? 'right' : 'left'
  const topicResourcePaneCount = useMemo<ResourcePaneCountButtonProps | undefined>(() => {
    if (!isClassicTopicLayout || topicListPosition !== 'right' || !visibleAssistantId) return undefined

    return {
      label: t('chat.topics.title'),
      count: allTopics.filter((topic) => topic.assistantId === visibleAssistantId).length
    }
  }, [allTopics, isClassicTopicLayout, topicListPosition, t, visibleAssistantId])
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
    setActiveTopic(state.topic)
  }, [isMessageOnlyView, setActiveTopic, state?.topic])

  const setActiveTopicAndCloseResourceView = useCallback(
    (topic: Topic) => {
      closeSurface()
      setActiveTopic(topic)
      return true
    },
    [closeSurface, setActiveTopic]
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
    async (payload?: AddNewTopicWithReusePayload, options?: NewTopicAssistantTargetOptions): Promise<Topic | null> => {
      if (isCreatingTopicRef.current) return null
      isCreatingTopicRef.current = true
      try {
        const selection = resolveNewTopicAssistantTarget(payload?.assistantId, options)
        // The explicit default/unassigned group (`payload.assistantId === null`) resolves to no target
        // assistant, but its empty placeholders must still be reused rather than restacked — mark it with
        // `null` so `findReusableEmptyTopic` matches "no assistant" topics.
        const reuseTargetAssistantId = selection.assistantId ?? (payload?.assistantId === null ? null : undefined)
        // Drop the topic being replaced (post-delete): a stale candidate list still holds it, and
        // reusing it would reactivate the just-deleted topic instead of opening a fresh one.
        const reuseCandidates = payload?.excludeReuseTopicId
          ? topicReuseCandidates.filter((topic) => topic.id !== payload.excludeReuseTopicId)
          : topicReuseCandidates
        const reusableTopic = findReusableEmptyTopic(reuseCandidates, reuseTargetAssistantId)
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
    async (payload?: AddNewTopicWithReusePayload) => {
      const created = await createAndActivateEmptyTopic(payload)
      // Post-delete replacement (delete flow passes `excludeReuseTopicId`): if the replacement create
      // fails, the active topic still points at the just-deleted topic — clear it so the awaiting delete
      // handler doesn't strand the view on a deleted conversation.
      if (!created && payload?.excludeReuseTopicId) {
        clearActiveTopic()
      }
    },
    [clearActiveTopic, createAndActivateEmptyTopic]
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
    if (!isLatestTopicReady) return

    // Resume the globally most-recently-updated topic as soon as `/latest` resolves — the chat center
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
    latestTopic,
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
    async (deletedAssistantId: string) => {
      const nextTopic = findLatestUpdated(allTopics.filter((topic) => topic.assistantId !== deletedAssistantId))
      if (lastUsedAssistantId === deletedAssistantId) {
        setLastUsedAssistantId(null)
      }
      if (nextTopic && setActiveTopicAndCloseResourceView(mapApiTopicToRendererTopic(nextTopic))) {
        return
      }
      const created = await createAndActivateEmptyTopic(undefined, { excludedAssistantIds: [deletedAssistantId] })
      // Creation failed → don't leave the view on a topic that belonged to the deleted assistant.
      if (!created) {
        clearActiveTopic()
      }
    },
    [
      allTopics,
      clearActiveTopic,
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
    isClassicTopicLayout && topicListPosition === 'right' ? (
      <AssistantResourceList
        activeAssistantId={visibleAssistantId ?? null}
        assistantTopicsSource={assistantTopicsSource}
        onAddAssistant={() => {
          setAssistantPickerOpen(true)
        }}
        historyRecordsActive={historyRecordsActive}
        onOpenHistoryRecords={isWindowFrame ? undefined : openHistoryRecords}
        onSelectTopic={setActiveTopicAndCloseResourceView}
        onCreateTopicAfterClear={(assistantId) => createAndActivateFreshTopic({ assistantId })}
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
        onCreateTopicAfterClear={isMessageOnlyView ? undefined : createAndActivateFreshTopic}
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
    <TopicRightPane
      resourcePane={resourcePane}
      topicId={visibleTopic?.id}
      topicName={visibleTopic?.name}
      traceId={visibleTopic?.traceId}
      present={!centerSurface}
      defaultOpen={topicPaneOpen}
      onOpenChange={isClassicTopicLayout ? setTopicPaneOpen : undefined}
      revealRequest={topicRevealRequest}>
      <Container id="home-page">
        <ContentContainer $detached={isWindowFrame}>
          <Chat
            activeTopic={visibleTopic}
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
