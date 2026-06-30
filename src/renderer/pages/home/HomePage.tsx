import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import {
  ChatAppShell,
  type ChatPanePosition,
  ConversationShell,
  ConversationStageCenter,
  EmptyState,
  LoadingState
} from '@renderer/components/chat'
import {
  type ResourcePaneConfig,
  ResourcePaneCountButton,
  type ResourcePaneCountButtonProps,
  useResourcePane
} from '@renderer/components/chat/panes/Shell'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resources'
import type { ResourceListRevealPayload } from '@renderer/components/chat/resources/resourceListRevealEvents'
import { AssistantResourceList } from '@renderer/components/chat/resources/variants/AssistantResourceList'
import { useWindowFrame } from '@renderer/components/chat/shell/WindowFrameContext'
import { ChatHomePlacementComposer } from '@renderer/components/composer/variants/ChatComposer'
import {
  createRecentTopicEntryFromTopic,
  upsertGlobalSearchRecentEntry
} from '@renderer/components/GlobalSearch/globalSearchGroups'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useCommandHandler } from '@renderer/hooks/command'
import { useAssistantTopicsSource } from '@renderer/hooks/resourceViewSources'
import { useCurrentTab, useCurrentTabId, useIsActiveTab, useTabSelfMetadata } from '@renderer/hooks/tab'
import { useAssistantApiById, useAssistants } from '@renderer/hooks/useAssistant'
import { toCreateAssistantDtoFromCatalogPreset } from '@renderer/hooks/useAssistantCatalogPresets'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { mapApiTopicToRendererTopic, useActiveTopic, useTopicById, useTopicMutations } from '@renderer/hooks/useTopic'
import { ipcApi } from '@renderer/ipc'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { FileMetadata } from '@renderer/types/file'
import type { Topic } from '@renderer/types/topic'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { findLatestUpdated } from '@renderer/utils/resourceEntity'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { cn } from '@renderer/utils/style'
import { getTabInstanceKey } from '@renderer/utils/tabInstanceMetadata'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { MIN_WINDOW_HEIGHT, SECOND_MIN_WINDOW_WIDTH } from '@shared/utils/window'
import { useLocation, useSearch } from '@tanstack/react-router'
import type { FC, HTMLAttributes, ReactNode } from 'react'
import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import HistoryRecordsPage from '../history/HistoryRecordsPage'
import Chat from './Chat'
import {
  AssistantConversationPickerDialog,
  type AssistantConversationSelection
} from './components/AssistantConversationPickerDialog'
import ChatNavbar from './components/ChatNavbar'
import { TopicRightPane } from './components/TopicRightPane'
import { parseChatRouteSearch } from './routeSearch'
import HomeTabs from './Tabs'
import { Topics } from './Tabs/components/Topics'
import type { AddNewTopicPayload } from './types'

const logger = loggerService.withContext('HomePage')
const LAST_USED_ASSISTANT_CACHE_KEY = 'ui.chat.last_used_assistant_id'
const CHAT_RIGHT_PANE_OPEN_CACHE_KEY = 'ui.chat.right_pane_open'

type DraftAssistantSelectionSource = 'explicit' | 'last-used' | 'first-assistant' | 'runtime-fallback'
type ResolvedDraftAssistantSelection = { assistantId?: string; source: DraftAssistantSelectionSource }
type DraftAssistantStartState = {
  firstLaunchStarted: boolean
}

type DraftAssistantSelection = {
  assistantId?: string
}

// Reuse the assistant's latest *empty* placeholder topic instead of stacking a new one. The empty
// topic only exists to surface the assistant in the traditional-view rail, so on repeated adds we reopen the
// existing placeholder rather than pile up blanks.
//
// "Empty" is approximated by a blank name: the list API exposes no message count, and a topic is
// auto-titled once it gets messages. A still-untitled topic that already has messages would also be
// treated as reusable — acceptable, since reuse just reopens it (no data loss, no duplicate). Swap
// the name test for a backend `messageCount` on the topic list if that ever lands.
function findReusableEmptyTopic<T extends { name: string; assistantId?: string; updatedAt?: string }>(
  topics: readonly T[],
  assistantId: string | undefined
): T | undefined {
  if (!assistantId) return undefined
  return findLatestUpdated(topics.filter((topic) => topic.assistantId === assistantId && topic.name.trim() === ''))
}

type DraftChatSendOptions = {
  files?: FileMetadata[]
  mentionedModels?: UniqueModelId[]
  knowledgeBaseIds?: string[]
  userMessageParts?: CherryMessagePart[]
}

const HomePage: FC = () => {
  const { t } = useTranslation()
  const draftScopeId = useId()
  const [topicRevealRequest, setTopicRevealRequest] = useState<ResourceListRevealRequest>()
  const topicRevealRequestIdRef = useRef(0)
  const draftAssistantStartStateRef = useRef<DraftAssistantStartState>({ firstLaunchStarted: false })
  const draftAssistantSelectionRef = useRef<DraftAssistantSelection | null>(null)
  const [draftAssistantSelection, setDraftAssistantSelection] = useState<DraftAssistantSelection | undefined>()
  const [lastUsedAssistantId, setLastUsedAssistantId] = usePersistCache(LAST_USED_ASSISTANT_CACHE_KEY)
  const [, setLastUsedTopicId] = usePersistCache('ui.chat.last_used_topic_id')
  const [traditionalViewRightPaneOpen, setTraditionalViewRightPaneOpenCache] =
    usePersistCache(CHAT_RIGHT_PANE_OPEN_CACHE_KEY)
  const [, setRecentItems] = usePersistCache('ui.global_search.recent_items')
  const lastRecordedRecentTopicRef = useRef<string | undefined>(undefined)
  const [pendingLocateMessageId, setPendingLocateMessageId] = useState<string | undefined>()
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const [topicView] = usePreference('chat.topic_view')
  const isTraditionalTopicView = topicView === 'traditional'
  // Traditional-view right-pane open state is shared via the `ui.chat.right_pane_open` cache; derive the
  // topic-scoped open flag + gated setter here (efficiency view leaves the setter a no-op).
  const topicPaneOpen = isTraditionalTopicView && traditionalViewRightPaneOpen
  const setTopicPaneOpen = useCallback(
    (open: boolean) => {
      if (isTraditionalTopicView) setTraditionalViewRightPaneOpenCache(open)
    },
    [isTraditionalTopicView, setTraditionalViewRightPaneOpenCache]
  )
  // Traditional view shares this full-topics source with the rail; efficiency view leaves it disabled (no fetch).
  // The picker uses it to reuse an empty placeholder topic instead of stacking new ones.
  const {
    topics: traditionalViewTopics,
    isLoadingAll: isTraditionalTopicViewLoading = false,
    isFullyLoaded: isTraditionalTopicViewFullyLoaded = true
  } = useAssistantTopicsSource({ enabled: isTraditionalTopicView })
  const isTraditionalTopicViewHistoryReady =
    !isTraditionalTopicView || (!isTraditionalTopicViewLoading && isTraditionalTopicViewFullyLoaded)
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
  // Detached windows are single-topic: no topic list, so no sidebar at all.
  const isWindowFrame = useWindowFrame().mode === 'window'
  const effectiveShowSidebar = !isMessageOnlyView && !isWindowFrame && showSidebar
  const { topic: routeApiTopic, isLoading: isRouteTopicLoading } = useTopicById(
    isMessageOnlyView ? routeTopicId : undefined
  )
  const routeTopic = useMemo(
    () => (routeApiTopic ? mapApiTopicToRendererTopic(routeApiTopic) : undefined),
    [routeApiTopic]
  )

  const shouldUseDraft = !state?.topic && !isMessageOnlyView

  const setDraftAssistantSelectionState = useCallback((selection?: DraftAssistantSelection) => {
    draftAssistantSelectionRef.current = selection ?? null
    setDraftAssistantSelection(selection)
  }, [])

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
  const fallbackAssistantId = assistants[0]?.id
  const isAssistantListResolved = hasAssistantsLoaded && !isAssistantsLoading && !isAssistantsRefreshing
  const resolveDraftAssistantTarget = useCallback(
    (explicitAssistantId?: string | null): ResolvedDraftAssistantSelection => {
      if (explicitAssistantId === null) {
        return { source: 'explicit' }
      }
      if (explicitAssistantId && assistantIdSet.has(explicitAssistantId)) {
        return { assistantId: explicitAssistantId, source: 'explicit' }
      }
      if (validLastUsedAssistantId) {
        return { assistantId: validLastUsedAssistantId, source: 'last-used' }
      }
      if (fallbackAssistantId) {
        return { assistantId: fallbackAssistantId, source: 'first-assistant' }
      }
      return { source: 'runtime-fallback' }
    },
    [assistantIdSet, fallbackAssistantId, validLastUsedAssistantId]
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
  const draftAssistantSelectionSnapshot = useMemo<DraftAssistantSelection | undefined>(() => {
    if (isMessageOnlyView) return undefined
    return draftAssistantSelection
  }, [draftAssistantSelection, isMessageOnlyView])
  const visibleTopic = isMessageOnlyView
    ? routeTopic
    : draftAssistantSelectionSnapshot
      ? undefined
      : (activeTopic ?? (isActiveTopicLoading ? lastVisibleTopicRef.current : undefined) ?? undefined)
  const draftScopeKey = `home-draft:${draftScopeId}`

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
  // own HomePage. `currentTabId` is *this* tab; the conversation-nav boundary uses it to
  // exclude self when deduping. `useIsActiveTab` answers "am I the globally-focused tab".
  const currentTabId = useCurrentTabId()
  const conversationNav = useConversationNavigation('assistants')
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
    // Track "last focused topic" only for persisted topics — draft views have
    // no stable topic id to restore on the next sidebar click. Drives
    // the sidebar `assistants` dedupe key (mirror of agent's last_used_session).
    // Gated on the active tab: `last_used` is a single global "what I'm looking
    // at now", so background tabs (also mounted) must not clobber it.
    if (!isActiveTab) return
    if (activeTopic?.id && activeTopicSource === 'query') {
      setLastUsedTopicId(activeTopic.id)
    }
  }, [isActiveTab, activeTopic, activeTopicSource, setLastUsedTopicId])

  // Label this tab with its assistant emoji + topic name so multiple chat tabs
  // are distinguishable in the tab bar (every tab labels itself — not gated on active).
  const visibleAssistantId = visibleTopic?.assistantId ?? draftAssistantSelectionSnapshot?.assistantId
  const { assistant: visibleAssistant } = useAssistantApiById(visibleAssistantId ?? undefined)
  const topicResourcePaneCount = useMemo<ResourcePaneCountButtonProps | undefined>(() => {
    if (!isTraditionalTopicView || !visibleAssistantId) return undefined

    return {
      label: t('chat.topics.title'),
      count: traditionalViewTopics.filter((topic) => topic.assistantId === visibleAssistantId).length
    }
  }, [isTraditionalTopicView, traditionalViewTopics, t, visibleAssistantId])
  const isDraftView = !isMessageOnlyView && !!draftAssistantSelectionSnapshot
  const tabInstanceTopicId =
    !isMessageOnlyView && !isDraftView ? (visibleTopic?.id ?? routeActiveTopicId ?? undefined) : undefined
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

  const sendDraftMessage = useCallback(
    async (text: string, options?: DraftChatSendOptions) => {
      const current = draftAssistantSelectionRef.current
      if (!current) {
        throw new Error('Draft topic handoff failed: no active draft topic')
      }

      const topic = await createTopic({
        ...(current.assistantId ? { assistantId: current.assistantId } : {})
      })
      const ack = await ipcApi.request('ai.stream_open', {
        trigger: 'submit-message',
        topicId: topic.id,
        userMessageParts: options?.userMessageParts ?? [{ type: 'text', text }],
        mentionedModelIds: options?.mentionedModels
      })
      const rendererTopic = mapApiTopicToRendererTopic(topic)
      setDraftAssistantSelectionState(undefined)
      setActiveTopic(rendererTopic)
      void refreshTopics().catch((err) => {
        logger.warn('Failed to refresh topics after draft topic create', err as Error)
      })
      if (ack.mode === 'blocked') {
        window.toast?.error(ack.message)
      }
    },
    [createTopic, refreshTopics, setActiveTopic, setDraftAssistantSelectionState]
  )
  const setResourceListOpen = useCallback(
    (open: boolean) => {
      void setShowSidebar(open)
    },
    [setShowSidebar]
  )
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
    setDraftAssistantSelectionState(undefined)
  }, [isMessageOnlyView, setActiveTopic, setDraftAssistantSelectionState, state?.topic])

  const startDraftAssistantSelection = useCallback(
    (payload?: AddNewTopicPayload) => {
      try {
        const selection = resolveDraftAssistantTarget(payload?.assistantId)
        const targetAssistantId = selection.assistantId
        const current = draftAssistantSelectionRef.current

        if (current && current.assistantId === targetAssistantId) {
          setActiveTopicId(null)
          return
        }

        setDraftAssistantSelectionState({ assistantId: targetAssistantId })
        setActiveTopicId(null)
      } catch (err) {
        logger.error('Failed to start draft topic', err as Error)
      }
    },
    [resolveDraftAssistantTarget, setDraftAssistantSelectionState]
  )

  const updateDraftAssistantSelection = useCallback(
    (assistantId: string | null) => {
      const current = draftAssistantSelectionRef.current
      if (!assistantId || !current) return
      if (assistantId === current.assistantId) return

      setDraftAssistantSelectionState({ assistantId })
    },
    [setDraftAssistantSelectionState]
  )

  useEffect(() => {
    if (!shouldUseDraft || draftAssistantStartStateRef.current.firstLaunchStarted || state?.topic) return
    if (draftAssistantSelectionSnapshot || activeTopic || isActiveTopicLoading) return
    if (!isAssistantListResolved) return
    if (isTraditionalTopicView && !isTraditionalTopicViewHistoryReady) return

    if (isTraditionalTopicView && !routeAssistantId) {
      const latestTopic = findLatestUpdated(traditionalViewTopics)
      if (latestTopic) {
        draftAssistantStartStateRef.current.firstLaunchStarted = true
        setDraftAssistantSelectionState(undefined)
        setActiveTopic(mapApiTopicToRendererTopic(latestTopic))
        return
      }
    }

    draftAssistantStartStateRef.current.firstLaunchStarted = true
    startDraftAssistantSelection(routeAssistantId ? { assistantId: routeAssistantId } : undefined)
  }, [
    activeTopic,
    draftAssistantSelectionSnapshot,
    isActiveTopicLoading,
    isAssistantListResolved,
    isTraditionalTopicView,
    isTraditionalTopicViewHistoryReady,
    traditionalViewTopics,
    routeAssistantId,
    setActiveTopic,
    setDraftAssistantSelectionState,
    shouldUseDraft,
    startDraftAssistantSelection,
    state?.topic
  ])

  const setActiveTopicAndDiscardDraft = useCallback(
    (topic: Topic) => {
      // One tab per topic: if this topic is already open in another tab, focus
      // that tab instead of navigating the current one (which would duplicate
      // it in the tab bar). The current tab keeps its own topic untouched.
      if (conversationNav.focusExistingTab(topic.id, { excludeTabId: currentTabId ?? undefined })) return false

      if (draftAssistantSelectionRef.current) {
        setDraftAssistantSelectionState(undefined)
      }
      setActiveTopic(topic)
      return true
    },
    [conversationNav, currentTabId, setActiveTopic, setDraftAssistantSelectionState]
  )
  // Traditional-view reset after deleting the active assistant: select the latest
  // remaining topic (across other assistants). Filter by the deleted id so this
  // is correct even before the topic cache refetches. If nothing remains, fall
  // back to the draft compose — traditional view has no empty-with-rail state to show.
  const handleActiveAssistantDeleted = useCallback(
    (deletedAssistantId: string) => {
      const nextTopic = findLatestUpdated(
        traditionalViewTopics.filter((topic) => topic.assistantId !== deletedAssistantId)
      )
      if (nextTopic) {
        setActiveTopicAndDiscardDraft(mapApiTopicToRendererTopic(nextTopic))
        return
      }
      startDraftAssistantSelection()
    },
    [traditionalViewTopics, setActiveTopicAndDiscardDraft, startDraftAssistantSelection]
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
      // Close the picker first so the topic/assistant data churn below doesn't refresh the dialog
      // while it's still visible (which reads as a black/white flash + the dialog reopening).
      setAssistantPickerOpen(false)
      try {
        const assistantId = await resolveAssistantIdForSelection(selection)

        // Reuse the assistant's latest empty placeholder topic (see findReusableEmptyTopic).
        const reusableTopic = findReusableEmptyTopic(traditionalViewTopics, assistantId)

        const topic = reusableTopic ?? (await createTopic({ assistantId }))
        const rendererTopic = mapApiTopicToRendererTopic(topic)

        setDraftAssistantSelectionState(undefined)
        setActiveTopic(rendererTopic)
        if (!reusableTopic) {
          void refreshTopics().catch((err) => {
            logger.warn('Failed to refresh topics after assistant picker topic create', err as Error)
          })
        }
      } catch (err) {
        logger.error('Failed to create assistant conversation from traditional-view picker', err as Error)
        window.toast.error(formatErrorMessageWithPrefix(err, t('common.error')))
      }
    },
    [
      createTopic,
      traditionalViewTopics,
      refreshTopics,
      resolveAssistantIdForSelection,
      setActiveTopic,
      setDraftAssistantSelectionState,
      t
    ]
  )

  const createAndActivateEmptyTopic = useCallback(
    async (payload?: AddNewTopicPayload) => {
      try {
        const selection = resolveDraftAssistantTarget(payload?.assistantId)
        const reusableTopic = findReusableEmptyTopic(traditionalViewTopics, selection.assistantId)
        const topic =
          reusableTopic ??
          (await createTopic({
            ...(selection.assistantId ? { assistantId: selection.assistantId } : {})
          }))
        const rendererTopic = mapApiTopicToRendererTopic(topic)

        setDraftAssistantSelectionState(undefined)
        setActiveTopic(rendererTopic)
        if (!reusableTopic) {
          void refreshTopics().catch((err) => {
            logger.warn('Failed to refresh topics after composer topic create', err as Error)
          })
        }
      } catch (err) {
        logger.error('Failed to create empty topic from traditional-view composer', err as Error)
        window.toast.error(formatErrorMessageWithPrefix(err, t('common.error')))
      }
    },
    [
      createTopic,
      traditionalViewTopics,
      refreshTopics,
      resolveDraftAssistantTarget,
      setActiveTopic,
      setDraftAssistantSelectionState,
      t
    ]
  )

  useEffect(() => {
    void window.api.window.setMinimumSize(SECOND_MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)

    return () => {
      void window.api.window.resetMinimumSize()
    }
  }, [])

  const handleHistoryTopicSelect = useCallback(
    (topic: Topic, messageId?: string) => {
      if (!setActiveTopicAndDiscardDraft(topic)) return
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
    [setActiveTopicAndDiscardDraft, setResourceListOpen]
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
        startDraftAssistantSelection()
        return
      }

      handleHistoryTopicSelect(topic)
    },
    [closeHistoryRecords, handleHistoryTopicSelect, startDraftAssistantSelection]
  )
  const handleGlobalSearchTopicSelect = useEffectEvent((topic: Topic, messageId?: string) => {
    handleHistoryTopicSelect(topic, messageId)
  })

  useEffect(() => {
    const unsubscribe = EventEmitter.on(EVENT_NAMES.GLOBAL_SEARCH_SELECT_TOPIC, (topic) => {
      handleGlobalSearchTopicSelect(topic as Topic)
    })
    const unsubscribeMessage = EventEmitter.on(EVENT_NAMES.GLOBAL_SEARCH_SELECT_TOPIC_MESSAGE, (payload) => {
      const { messageId, topic } = payload as { messageId?: string; topic?: Topic }
      if (!topic || !messageId) return

      handleGlobalSearchTopicSelect(topic, messageId)
    })

    return () => {
      unsubscribe()
      unsubscribeMessage()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `useEffectEvent` reads latest tab/topic state without resubscribing.
  }, [])

  const handleLocateMessageHandled = useCallback(() => {
    setPendingLocateMessageId(undefined)
  }, [])

  if (!visibleTopic && !draftAssistantSelectionSnapshot) {
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

  // Traditional view = entity rail + right topic panel; efficiency view = the classic single sidebar (HomeTabs).
  const panePosition: ChatPanePosition = 'left'
  const pane = isTraditionalTopicView ? (
    <AssistantResourceList
      activeAssistantId={visibleAssistantId ?? null}
      onAddAssistant={() => setAssistantPickerOpen(true)}
      onOpenHistoryRecords={openHistoryRecords}
      onSelectTopic={setActiveTopicAndDiscardDraft}
      onStartDraftAssistant={(assistantId) => startDraftAssistantSelection({ assistantId })}
      onActiveAssistantDeleted={handleActiveAssistantDeleted}
    />
  ) : (
    <HomeTabs
      activeTopic={visibleTopic}
      setActiveTopic={setActiveTopicAndDiscardDraft}
      onNewTopic={isMessageOnlyView ? undefined : startDraftAssistantSelection}
      onOpenHistoryRecords={openHistoryRecords}
      revealRequest={topicRevealRequest}
    />
  )
  // In traditional view the topic list moves into the chat's right pane as a tab; the single page-level
  // provider owns the Shell for both views so the rail and the right panel share its open/maximize
  // state. New (sidebar) view passes a null config, leaving the pane as branch/trace only.
  const resourcePane: ResourcePaneConfig | null = isTraditionalTopicView
    ? {
        label: t('chat.topics.title'),
        node: (
          <Topics
            presentation="right-panel"
            activeTopic={visibleTopic}
            assistantIdFilter={visibleAssistantId ?? null}
            setActiveTopic={setActiveTopicAndDiscardDraft}
            onNewTopic={isMessageOnlyView ? undefined : startDraftAssistantSelection}
            revealRequest={topicRevealRequest}
          />
        )
      }
    : null
  const renderWithRightPane = (content: ReactNode) => (
    <TopicRightPane
      resourcePane={resourcePane}
      defaultOpen={topicPaneOpen}
      onOpenChange={isTraditionalTopicView ? setTopicPaneOpen : undefined}
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
  const assistantPickerDialog = isTraditionalTopicView ? (
    <AssistantConversationPickerDialog
      open={assistantPickerOpen}
      onOpenChange={setAssistantPickerOpen}
      assistants={assistants}
      assistantsLoading={isAssistantsLoading || isAssistantsRefreshing}
      onSelect={handleAssistantConversationSelect}
    />
  ) : null

  if (draftAssistantSelectionSnapshot) {
    return renderWithRightPane(
      <Container id="home-page">
        <ContentContainer $detached={isWindowFrame}>
          <DraftWelcomeChat
            assistantId={draftAssistantSelectionSnapshot.assistantId}
            scopeKey={draftScopeKey}
            pane={pane}
            paneOpen={effectiveShowSidebar}
            panePosition={panePosition}
            onPaneCollapse={() => setResourceListOpen(false)}
            onNewTopic={isMessageOnlyView ? undefined : startDraftAssistantSelection}
            onCreateEmptyTopic={isTraditionalTopicView && !isMessageOnlyView ? createAndActivateEmptyTopic : undefined}
            onDraftAssistantChange={updateDraftAssistantSelection}
            onSend={sendDraftMessage}
            showResourceListControls={!isMessageOnlyView && !isWindowFrame}
            sidebarOpen={effectiveShowSidebar}
            onSidebarToggle={toggleResourceListOpen}
            resourcePaneCount={topicResourcePaneCount}
            welcomeText={t('chat.home.welcome_title')}
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
          panePosition={panePosition}
          onPaneCollapse={() => setResourceListOpen(false)}
          onNewTopic={isMessageOnlyView ? undefined : startDraftAssistantSelection}
          onCreateEmptyTopic={isTraditionalTopicView && !isMessageOnlyView ? createAndActivateEmptyTopic : undefined}
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

type DraftWelcomeChatProps = {
  assistantId?: string
  scopeKey: string
  pane?: ReactNode
  paneOpen?: boolean
  panePosition?: ChatPanePosition
  onPaneCollapse?: () => void
  onNewTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  onCreateEmptyTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  onDraftAssistantChange?: (assistantId: string | null) => void | Promise<void>
  onSend: (text: string, options?: DraftChatSendOptions) => Promise<void>
  resourcePaneCount?: ResourcePaneCountButtonProps
  showResourceListControls?: boolean
  sidebarOpen?: boolean
  onSidebarToggle?: () => void
  welcomeText: string
}

function DraftWelcomeChat({
  assistantId,
  scopeKey,
  pane,
  paneOpen,
  panePosition,
  onPaneCollapse,
  onNewTopic,
  onCreateEmptyTopic,
  onDraftAssistantChange,
  onSend,
  resourcePaneCount,
  showResourceListControls,
  sidebarOpen,
  onSidebarToggle,
  welcomeText
}: DraftWelcomeChatProps) {
  const [messageStyle] = usePreference('chat.message.style')
  const resourcePane = useResourcePane()

  const composer = (
    <ChatHomePlacementComposer
      scopeKey={scopeKey}
      assistantId={assistantId}
      onSend={onSend}
      onDraftAssistantChange={onDraftAssistantChange}
      onNewTopic={onNewTopic}
      onCreateEmptyTopic={onCreateEmptyTopic}
    />
  )

  return (
    <ConversationShell
      id="chat"
      className={messageStyle}
      pane={pane}
      paneOpen={paneOpen}
      panePosition={panePosition}
      onPaneCollapse={onPaneCollapse}
      topBar={
        <ChatNavbar
          showSidebarControls={showResourceListControls}
          sidebarOpen={sidebarOpen}
          onSidebarToggle={onSidebarToggle}
        />
      }
      topRightTool={
        resourcePane ? (
          <>
            {resourcePaneCount && <ResourcePaneCountButton {...resourcePaneCount} />}
            <TopicRightPane.Toggle />
          </>
        ) : undefined
      }
      topRightToolReserve={resourcePaneCount ? 'history' : 'single'}
      center={
        <ConversationStageCenter placement="home" main={null} composer={composer} homeWelcomeText={welcomeText} />
      }
      centerOverlay={resourcePane ? <TopicRightPane.MaximizedOverlay /> : undefined}
      rightPane={resourcePane ? <TopicRightPane.Host /> : undefined}
      centerId="chat-main"
      centerClassName="transform-[translateZ(0)] relative justify-between"
    />
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
