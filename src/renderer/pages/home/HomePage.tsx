import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import {
  type ResourcePaneConfig,
  ResourcePaneCountButton,
  type ResourcePaneCountButtonProps,
  useResourcePane
} from '@renderer/components/chat/panes/Shell'
import { EmptyState, LoadingState } from '@renderer/components/chat/primitives'
import { AssistantResourceList } from '@renderer/components/chat/resourceList/AssistantResourceList'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resourceList/base'
import { ChatAppShell } from '@renderer/components/chat/shell/ChatAppShell'
import ConversationPageShell from '@renderer/components/chat/shell/ConversationPageShell'
import ConversationShell from '@renderer/components/chat/shell/ConversationShell'
import { ConversationSidebarToggleButton } from '@renderer/components/chat/shell/ConversationSidebarToggleButton'
import ConversationStageCenter from '@renderer/components/chat/shell/ConversationStageCenter'
import type { ChatPanePosition } from '@renderer/components/chat/shell/paneLayout'
import { ChatHomePlacementComposer } from '@renderer/components/composer/variants/ChatComposer'
import {
  createRecentTopicEntryFromTopic,
  upsertGlobalSearchRecentEntry
} from '@renderer/components/GlobalSearch/globalSearchGroups'
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
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { mapApiTopicToRendererTopic, useActiveTopic, useTopicById, useTopicMutations } from '@renderer/hooks/useTopic'
import { useWindowFrame } from '@renderer/hooks/useWindowFrame'
import { ipcApi } from '@renderer/ipc'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { ResourceListRevealPayload } from '@renderer/services/resourceListRevealEvents'
import type { FileMetadata } from '@renderer/types/file'
import type { Topic } from '@renderer/types/topic'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { findLatestUpdated, isUntouchedSinceCreation } from '@renderer/utils/resourceEntity'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { cn } from '@renderer/utils/style'
import { getTabInstanceKey } from '@renderer/utils/tabInstanceMetadata'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { MIN_WINDOW_HEIGHT, SECOND_MIN_WINDOW_WIDTH } from '@shared/utils/window'
import { useLocation, useSearch } from '@tanstack/react-router'
import { MessageCircle } from 'lucide-react'
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
import { Topics } from './Tabs/components/Topics'
import HomeTabs from './Tabs/HomeTabs'
import type { AddNewTopicPayload } from './types'

const logger = loggerService.withContext('HomePage')
const LAST_USED_ASSISTANT_CACHE_KEY = 'ui.chat.last_used_assistant_id'
type AssistantConversationResourceKind = 'assistant'

type DraftAssistantSelectionSource = 'explicit' | 'last-used' | 'first-assistant' | 'runtime-fallback'
type ResolvedDraftAssistantSelection = { assistantId?: string; source: DraftAssistantSelectionSource }
type DraftAssistantStartState = {
  firstLaunchStarted: boolean
}

type DraftAssistantSelection = {
  assistantId?: string
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
  // Guards the classic-layout topic-create paths against re-entry: a rapid double-click would
  // otherwise read the same pre-refresh topic list twice and stack duplicate blank topics.
  const isCreatingTopicRef = useRef(false)
  const [draftAssistantSelection, setDraftAssistantSelection] = useState<DraftAssistantSelection | undefined>()
  const [lastUsedAssistantId, setLastUsedAssistantId] = usePersistCache(LAST_USED_ASSISTANT_CACHE_KEY)
  const [, setLastUsedTopicId] = usePersistCache('ui.chat.last_used_topic_id')
  const [, setRecentItems] = usePersistCache('ui.global_search.recent_items')
  const lastRecordedRecentTopicRef = useRef<string | undefined>(undefined)
  const [pendingLocateMessageId, setPendingLocateMessageId] = useState<string | undefined>()
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const [topicLayout] = usePreference('topic.layout')
  const isClassicTopicLayout = topicLayout === 'classic'
  // Classic-layout right-pane open state, cached on the assistant surface's own key.
  const [topicPaneOpen, setTopicPaneOpen] = useClassicLayoutRightPaneOpen('chat', isClassicTopicLayout)
  // Classic layout shares this full-topics source with the rail; modern layout leaves it disabled (no fetch).
  // The picker uses it to reuse an empty placeholder topic instead of stacking new ones.
  const {
    topics: classicLayoutTopics,
    isLoadingAll: isClassicTopicLayoutLoading,
    isFullyLoaded: isClassicTopicLayoutFullyLoaded
  } = useAssistantTopicsSource({ enabled: isClassicTopicLayout })
  const isClassicTopicLayoutHistoryReady =
    !isClassicTopicLayout || (!isClassicTopicLayoutLoading && isClassicTopicLayoutFullyLoaded)
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
  const resourceConversationKey = useMemo(() => {
    if (visibleTopic?.id) return `topic:${visibleTopic.id}`
    if (draftAssistantSelectionSnapshot) return `draft:${draftAssistantSelectionSnapshot.assistantId ?? 'default'}`
    return 'empty'
  }, [draftAssistantSelectionSnapshot, visibleTopic?.id])
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
    if (!isClassicTopicLayout || !visibleAssistantId) return undefined

    return {
      label: t('chat.topics.title'),
      count: classicLayoutTopics.filter((topic) => topic.assistantId === visibleAssistantId).length
    }
  }, [isClassicTopicLayout, classicLayoutTopics, t, visibleAssistantId])
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
        closeResourceView()
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
    [closeResourceView, resolveDraftAssistantTarget, setDraftAssistantSelectionState]
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
    if (isClassicTopicLayout && !isClassicTopicLayoutHistoryReady) return

    if (isClassicTopicLayout && !routeAssistantId) {
      const latestTopic = findLatestUpdated(classicLayoutTopics)
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
    isClassicTopicLayout,
    isClassicTopicLayoutHistoryReady,
    classicLayoutTopics,
    routeAssistantId,
    setActiveTopic,
    setDraftAssistantSelectionState,
    shouldUseDraft,
    startDraftAssistantSelection,
    state?.topic
  ])

  const setActiveTopicAndDiscardDraft = useCallback(
    (topic: Topic) => {
      closeResourceView()
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
    [closeResourceView, conversationNav, currentTabId, setActiveTopic, setDraftAssistantSelectionState]
  )
  // Classic-layout reset after deleting the active assistant: select the latest
  // remaining topic (across other assistants). Filter by the deleted id so this
  // is correct even before the topic cache refetches. If nothing remains, fall
  // back to the draft compose — classic layout has no empty-with-rail state to show.
  const handleActiveAssistantDeleted = useCallback(
    (deletedAssistantId: string) => {
      const nextTopic = findLatestUpdated(
        classicLayoutTopics.filter((topic) => topic.assistantId !== deletedAssistantId)
      )
      // setActiveTopicAndDiscardDraft returns false when the next topic is already open in another
      // tab (it focuses that tab). In that case the current tab would otherwise keep pointing at the
      // just-deleted topic, so fall through to a draft instead of leaving a ghost.
      if (nextTopic && setActiveTopicAndDiscardDraft(mapApiTopicToRendererTopic(nextTopic))) {
        return
      }
      startDraftAssistantSelection()
    },
    [classicLayoutTopics, setActiveTopicAndDiscardDraft, startDraftAssistantSelection]
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
        const reusableTopic = findReusableEmptyTopic(classicLayoutTopics, assistantId)

        const topic = reusableTopic ?? (await createTopic({ assistantId }))
        const rendererTopic = mapApiTopicToRendererTopic(topic)

        // One tab per topic: a reused topic already open in another tab focuses that tab instead of
        // duplicating it here; this also discards any pending draft selection.
        setActiveTopicAndDiscardDraft(rendererTopic)
        if (!reusableTopic) {
          void refreshTopics().catch((err) => {
            logger.warn('Failed to refresh topics after assistant picker topic create', err as Error)
          })
        }
      } catch (err) {
        logger.error('Failed to create assistant conversation from classic-layout picker', err as Error)
        window.toast.error(formatErrorMessageWithPrefix(err, t('common.error')))
      } finally {
        isCreatingTopicRef.current = false
      }
    },
    [createTopic, classicLayoutTopics, refreshTopics, resolveAssistantIdForSelection, setActiveTopicAndDiscardDraft, t]
  )

  const createAndActivateEmptyTopic = useCallback(
    async (payload?: AddNewTopicPayload) => {
      if (isCreatingTopicRef.current) return
      isCreatingTopicRef.current = true
      try {
        const selection = resolveDraftAssistantTarget(payload?.assistantId)
        const reusableTopic = findReusableEmptyTopic(classicLayoutTopics, selection.assistantId)
        const topic =
          reusableTopic ??
          (await createTopic({
            ...(selection.assistantId ? { assistantId: selection.assistantId } : {})
          }))
        const rendererTopic = mapApiTopicToRendererTopic(topic)

        // One tab per topic: a reused topic already open in another tab focuses that tab instead of
        // duplicating it here; this also discards any pending draft selection.
        setActiveTopicAndDiscardDraft(rendererTopic)
        if (!reusableTopic) {
          void refreshTopics().catch((err) => {
            logger.warn('Failed to refresh topics after composer topic create', err as Error)
          })
        }
      } catch (err) {
        logger.error('Failed to create empty topic from classic-layout composer', err as Error)
        window.toast.error(formatErrorMessageWithPrefix(err, t('common.error')))
      } finally {
        isCreatingTopicRef.current = false
      }
    },
    [createTopic, classicLayoutTopics, refreshTopics, resolveDraftAssistantTarget, setActiveTopicAndDiscardDraft, t]
  )

  // "去对话" from the assistant library (after adding a preset). The legacy navigate-to-chat no longer
  // fits the classic/modern split, so branch on layout: classic auto-creates an empty topic and
  // switches to it; modern drops into the draft compose with the assistant pre-selected. Both handlers
  // already close the resource center internally.
  const handleOpenAssistantChatFromLibrary = useCallback(
    (assistantId: string) => {
      if (isClassicTopicLayout) {
        void createAndActivateEmptyTopic({ assistantId })
      } else {
        startDraftAssistantSelection({ assistantId })
      }
    },
    [createAndActivateEmptyTopic, isClassicTopicLayout, startDraftAssistantSelection]
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
    [closeResourceView, setActiveTopicAndDiscardDraft, setResourceListOpen]
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

  if (!visibleTopic && !draftAssistantSelectionSnapshot && !resourceCenter) {
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
  const panePosition: ChatPanePosition = 'left'
  const pane = isClassicTopicLayout ? (
    <AssistantResourceList
      activeAssistantId={visibleAssistantId ?? null}
      onAddAssistant={() => {
        setAssistantPickerOpen(true)
      }}
      onOpenHistoryRecords={openHistoryRecords}
      onSelectTopic={setActiveTopicAndDiscardDraft}
      onStartDraftAssistant={(assistantId) => startDraftAssistantSelection({ assistantId })}
      resourceMenuItems={resourceMenuItems}
      onActiveAssistantDeleted={handleActiveAssistantDeleted}
    />
  ) : (
    <HomeTabs
      activeTopic={visibleTopic}
      setActiveTopic={setActiveTopicAndDiscardDraft}
      onNewTopic={isMessageOnlyView ? undefined : startDraftAssistantSelection}
      onOpenHistoryRecords={openHistoryRecords}
      revealRequest={topicRevealRequest}
      resourceMenuItems={resourceMenuItems}
    />
  )
  // In classic layout the topic list moves into the chat's right pane as a tab; the single page-level
  // provider owns the Shell for both views so the rail and the right panel share its open/maximize
  // state. New (sidebar) view passes a null config, leaving the pane as branch/trace only.
  const resourcePane: ResourcePaneConfig | null = isClassicTopicLayout
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
            panePosition={panePosition}
            onPaneCollapse={() => setResourceListOpen(false)}
          />
        </ContentContainer>
        {assistantPickerDialog}
        {historyRecordsOverlay}
      </Container>
    )
  }

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
            onCreateEmptyTopic={isClassicTopicLayout && !isMessageOnlyView ? createAndActivateEmptyTopic : undefined}
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
          onCreateEmptyTopic={isClassicTopicLayout && !isMessageOnlyView ? createAndActivateEmptyTopic : undefined}
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
            <TopicRightPane.Shortcuts />
            <TopicRightPane.Toggle />
          </>
        ) : undefined
      }
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
