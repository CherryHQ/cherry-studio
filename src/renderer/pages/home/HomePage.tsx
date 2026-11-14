import { getRouteApi, useNavigate } from '@tanstack/react-router'
import type { FC, HTMLAttributes } from 'react'
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cacheService } from '@data/CacheService'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import type { ResourcePaneConfig, ResourcePaneCountButtonProps } from '@renderer/components/chat/panes/Shell'
import { AssistantResourceList } from '@renderer/components/chat/resourceList/AssistantResourceList'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resourceList/base'
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
import { useCurrentTabId, useIsActiveTab } from '@renderer/hooks/tab'
import { useAssistantApiById, useAssistants } from '@renderer/hooks/useAssistant'
import { toCreateAssistantDtoFromCatalogPreset } from '@renderer/hooks/useAssistantCatalogPresets'
import { useClassicLayoutRightPaneOpen } from '@renderer/hooks/useClassicLayoutRightPaneOpen'
import { useComposerFocusRequest } from '@renderer/hooks/useComposerFocusRequest'
import { useConversationCenterSurface } from '@renderer/hooks/useConversationCenterSurface'
import { useConversationLocateRequest } from '@renderer/hooks/useConversationLocateRequest'
import { useConversationShellPaneState } from '@renderer/hooks/useConversationShellPaneState'
import { useModelById } from '@renderer/hooks/useModel'
import { mapApiTopicToRendererTopic, useActiveTopic, useTopicMutations } from '@renderer/hooks/useTopic'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { ResourceListRevealPayload } from '@renderer/services/resourceListRevealEvents'
import { toast } from '@renderer/services/toast'
import type { AppRouter } from '@renderer/types/router'
import type { Topic } from '@renderer/types/topic'
import { getTopicAssistantDisplayGroupId } from '@renderer/utils/chat/topicsHelpers'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { cn } from '@renderer/utils/style'
import { isDataApiNotFoundError } from '@shared/data/api/errors'

import Chat from './Chat'
import {
  AssistantConversationPickerDialog,
  type AssistantConversationSelection
} from './components/AssistantConversationPickerDialog'
import { HomeTabRuntime } from './components/HomeTabRuntime'
import { TopicRightPane } from './components/TopicRightPane'
import { Topics } from './Tabs/components/topics'
import HomeTabs from './Tabs/HomeTabs'
import type { AddNewTopicPayload } from './types'

const logger = loggerService.withContext('HomePage')
const chatRouteApi = getRouteApi('/app/chat')
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
  const lastRecordedRecentTopicRef = useRef<string | undefined>(undefined)
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const [topicDisplayMode, setTopicDisplayMode] = usePreference('topic.tab.display_mode')
  const [panePosition, setPanePosition] = usePreference('topic.tab.position')
  const isClassicTopicLayout = topicDisplayMode === 'assistant'
  const [assistantPickerOpen, setAssistantPickerOpen] = useState(false)

  const routeSearch = chatRouteApi.useSearch<AppRouter>()
  const navigate = useNavigate()
  const routeTopicId = routeSearch.topicId
  const routeAssistantId = routeSearch.assistantId
  const {
    isWindowFrame,
    shellPaneOpen,
    paneManualToggle,
    setShellPaneOpen,
    setShellPaneOpenManually,
    toggleShellPane,
    handlePaneAutoCollapseChange
  } = useConversationShellPaneState({
    persistedPaneOpen: showSidebar,
    setPersistedPaneOpen: setShowSidebar
  })
  const topicListPosition: ChatPanePosition =
    !isWindowFrame && isClassicTopicLayout && panePosition === 'right' ? 'right' : 'left'
  const [topicPaneOpen, setTopicPaneOpen] = useClassicLayoutRightPaneOpen('chat', {
    enabled: isClassicTopicLayout,
    defaultOpen: !isWindowFrame && panePosition === 'right'
  })
  // Shared full-topics list source plus exact latest/reusable lookups.
  const assistantTopicsSource = useAssistantTopicsSource()
  const { topics: allTopics, rendererTopics, loadLatestTopic, reuseOrCreateTopic } = assistantTopicsSource

  const { createTopic, refreshTopics } = useTopicMutations()
  const {
    assistants,
    total: assistantsTotal,
    hasLoaded: hasAssistantsLoaded,
    isLoading: isAssistantsLoading,
    isRefreshing: isAssistantsRefreshing,
    error: assistantsError,
    addAssistant
  } = useAssistants()
  const assistantIdSet = useMemo(() => new Set(assistants.map((assistant) => assistant.id)), [assistants])
  const { assistant: routeAssistant, error: routeAssistantError } = useAssistantApiById(
    !routeTopicId && routeAssistantId && !assistantIdSet.has(routeAssistantId) ? routeAssistantId : undefined
  )
  const availableRouteAssistantId =
    !routeTopicId && routeAssistantId && !isDataApiNotFoundError(routeAssistantError) ? routeAssistantId : undefined
  const assistantIdSetRef = useRef(assistantIdSet)
  assistantIdSetRef.current = assistantIdSet
  const validLastUsedAssistantId =
    lastUsedAssistantId && assistantIdSet.has(lastUsedAssistantId) ? lastUsedAssistantId : undefined
  const isAssistantListResolved = hasAssistantsLoaded && !isAssistantsLoading && !isAssistantsRefreshing
  const isAssistantListComplete = isAssistantListResolved && !assistantsError && assistants.length >= assistantsTotal
  const isAssistantListCompleteRef = useRef(isAssistantListComplete)
  isAssistantListCompleteRef.current = isAssistantListComplete
  const resolveNewTopicAssistantTarget = useCallback(
    (
      explicitAssistantId?: string | null,
      options: NewTopicAssistantTargetOptions = {}
    ): ResolvedNewTopicAssistantSelection => {
      const excludedAssistantIds = new Set(options.excludedAssistantIds ?? [])
      const isAvailableAssistantId = (assistantId: string | null | undefined): assistantId is string =>
        !!assistantId &&
        (assistantIdSet.has(assistantId) || assistantId === availableRouteAssistantId) &&
        !excludedAssistantIds.has(assistantId)

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
    [assistantIdSet, assistants, availableRouteAssistantId, routeAssistantId, validLastUsedAssistantId]
  )

  const routeActiveTopicId = routeTopicId ?? null
  const [activeTopicId, setActiveTopicIdState] = useState<string | null>(() => routeActiveTopicId)
  const activeTopicIdRef = useRef(activeTopicId)
  activeTopicIdRef.current = activeTopicId
  // Page-initiated selection writes the tab URL — the conversation's sole identity channel —
  // and mirrors into state immediately so the UI doesn't wait a router round trip. Route-driven
  // changes (entry interceptor, recovery) flow back through the sync effect below. Clearing
  // (`null`) never navigates: the next selection or the recovery path owns the URL then.
  const setActiveTopicId = useCallback(
    (id: string | null) => {
      ownerFallbackRequestIdRef.current += 1
      activeTopicIdRef.current = id
      setActiveTopicIdState(id)
      if (id) {
        if (archiveSelectionRef.current.topicId !== id) archiveSelectionVersionRef.current += 1
        if (archiveSelectionRef.current.topicId !== id) {
          archiveSelectionRef.current = { topicId: id, assistantId: undefined }
        }
        void navigate({ to: '/app/chat', search: { topicId: id }, replace: true })
      }
    },
    [navigate]
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
    setActiveTopic: setActiveTopicValue,
    clearActiveTopic,
    isLoading: isActiveTopicLoading,
    error: activeTopicError,
    topicSource: activeTopicSource
  } = useActiveTopic({
    activeTopicId,
    setActiveTopicId
  })
  const setActiveTopic = useCallback(
    (topic: Topic) => {
      const identity = { topicId: topic.id, assistantId: topic.assistantId ?? null }
      if (
        archiveSelectionRef.current.topicId !== identity.topicId ||
        (archiveSelectionRef.current.assistantId !== undefined &&
          archiveSelectionRef.current.assistantId !== identity.assistantId)
      ) {
        archiveSelectionVersionRef.current += 1
      }
      archiveSelectionRef.current = identity
      setActiveTopicValue(topic)
    },
    [setActiveTopicValue]
  )
  const onSelectedTopicOwnerChanged = useCallback((topic: Topic) => {
    if (activeTopicIdRef.current !== topic.id) return
    const identity = archiveSelectionRef.current
    if (
      identity.topicId === topic.id &&
      identity.assistantId !== undefined &&
      identity.assistantId !== (topic.assistantId ?? null)
    ) {
      archiveSelectionVersionRef.current += 1
    }
    archiveSelectionRef.current = { topicId: topic.id, assistantId: topic.assistantId ?? null }
  }, [])
  const reenterChatRoute = useCallback(() => {
    const staleTopicId = activeTopicId ?? routeTopicId
    if (staleTopicId) {
      cacheService.setPersist('ui.chat.last_used_topic_id', (current) => (current === staleTopicId ? null : current))
    }
    clearActiveTopic()
    void navigate({ to: '/app/chat', search: {}, replace: true })
  }, [activeTopicId, routeTopicId, clearActiveTopic, navigate])
  const archiveSelectionVersionRef = useRef(0)
  const getArchiveSelectionVersion = useCallback(() => archiveSelectionVersionRef.current, [])
  const archiveRouteRef = useRef({ topicId: routeTopicId, assistantId: routeAssistantId })
  // Undefined means unresolved ownership; null means a confirmed unlinked topic.
  const archiveSelectionRef = useRef<{ topicId: string | undefined; assistantId: string | null | undefined }>({
    topicId: routeTopicId,
    assistantId: routeTopicId ? undefined : routeAssistantId
  })
  if (archiveRouteRef.current.topicId !== routeTopicId || archiveRouteRef.current.assistantId !== routeAssistantId) {
    const assistantId = routeTopicId
      ? archiveSelectionRef.current.topicId === routeTopicId
        ? archiveSelectionRef.current.assistantId
        : undefined
      : routeAssistantId
    if (
      archiveSelectionRef.current.topicId !== routeTopicId ||
      archiveSelectionRef.current.assistantId !== assistantId
    ) {
      archiveSelectionVersionRef.current += 1
      archiveSelectionRef.current = { topicId: routeTopicId, assistantId }
    }
    archiveRouteRef.current = { topicId: routeTopicId, assistantId: routeAssistantId }
  }
  if (
    activeTopic &&
    archiveSelectionRef.current.topicId === activeTopic.id &&
    archiveSelectionRef.current.assistantId === undefined
  ) {
    archiveSelectionRef.current.assistantId = activeTopic.assistantId ?? null
  }
  const pendingLocalArchivesRef = useRef(new Map<string, Map<symbol | undefined, number>>())
  const [pendingLocalArchiveIds, setPendingLocalArchiveIds] = useState<ReadonlySet<string>>(new Set())
  const onLocalArchivePendingChange = useCallback((topicId: string, pending: boolean, token?: symbol) => {
    if (pending) {
      const attempts = pendingLocalArchivesRef.current.get(topicId) ?? new Map<symbol | undefined, number>()
      attempts.set(token, archiveSelectionVersionRef.current)
      pendingLocalArchivesRef.current.set(topicId, attempts)
    } else {
      const attempts = pendingLocalArchivesRef.current.get(topicId)
      attempts?.delete(token)
      if (!attempts?.size) pendingLocalArchivesRef.current.delete(topicId)
    }
    setPendingLocalArchiveIds(new Set(pendingLocalArchivesRef.current.keys()))
  }, [])
  const pendingLocalPermanentDeleteIdRef = useRef<string | null>(null)
  const [pendingLocalPermanentDeleteId, setPendingLocalPermanentDeleteId] = useState<string | null>(null)
  const onLocalPermanentDeletePendingChange = useCallback((id: string | null) => {
    pendingLocalPermanentDeleteIdRef.current = id
    setPendingLocalPermanentDeleteId(id)
  }, [])
  // The URL-bound topic no longer exists: its by-id query settled with NOT_FOUND (deleted while
  // this tab was dormant, or a rotted deep link). Recovery is a plain replace-navigation back
  // through the entry interceptor, which resolves the next target — no in-page state surgery.
  useEffect(() => {
    if (!routeTopicId || activeTopicId !== routeTopicId || activeTopicIdRef.current !== routeTopicId) return
    if (activeTopic || isActiveTopicLoading) return
    if (!isDataApiNotFoundError(activeTopicError)) return
    if (pendingLocalPermanentDeleteIdRef.current === routeTopicId) return
    if (
      [...(pendingLocalArchivesRef.current.get(routeTopicId)?.values() ?? [])].includes(
        archiveSelectionVersionRef.current
      )
    )
      return
    reenterChatRoute()
  }, [
    activeTopic,
    activeTopicError,
    activeTopicId,
    isActiveTopicLoading,
    pendingLocalPermanentDeleteId,
    pendingLocalArchiveIds,
    reenterChatRoute,
    routeTopicId
  ])
  const lastVisibleTopicRef = useRef<Topic | undefined>(undefined)
  const visibleTopic =
    activeTopic ??
    (isActiveTopicLoading && lastVisibleTopicRef.current?.id === activeTopicId
      ? lastVisibleTopicRef.current
      : undefined)
  const requestComposerFocus = useComposerFocusRequest(visibleTopic?.id)
  const resourceConversationKey = useMemo(() => {
    if (visibleTopic?.id) return `topic:${visibleTopic.id}`
    return 'empty'
  }, [visibleTopic?.id])
  const conversationResourcesEnabled = !isWindowFrame
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
  // own HomePage. `currentTabId` is *this* tab's id.
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
    if (!visibleTopic?.id) return
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
  }, [currentTabId])

  const visibleAssistantId = visibleTopic
    ? visibleTopic.assistantId
    : availableRouteAssistantId
      ? availableRouteAssistantId
      : undefined
  const visibleAssistant =
    assistants.find((assistant) => assistant.id === visibleAssistantId) ??
    (routeAssistant?.id === visibleAssistantId ? routeAssistant : undefined)
  // Start the managed model query before assistant details resolve; Chat shares the same SWR request.
  useModelById(visibleAssistant?.modelId)
  const topicResourcePaneCount = useMemo<ResourcePaneCountButtonProps | undefined>(() => {
    if (!isClassicTopicLayout || topicListPosition !== 'right' || !visibleAssistantId) return undefined

    return {
      label: t('chat.topics.title'),
      count: allTopics.filter((topic) => topic.assistantId === visibleAssistantId).length
    }
  }, [allTopics, isClassicTopicLayout, topicListPosition, t, visibleAssistantId])
  const targetTopicId = activeTopicId ?? undefined
  const { locateMessageId, locateToEnd, requestLocate, clearLocate } = useConversationLocateRequest({
    navigationTabId: currentTabId ?? undefined,
    activeConversationId: targetTopicId,
    visibleConversationId: visibleTopic?.id
  })
  // Label this tab with its assistant emoji + topic name so multiple chat tabs are distinguishable.
  const preserveTabVisuals = !!targetTopicId && visibleTopic?.id !== targetTopicId
  const tabTitle = visibleTopic?.name?.trim() || visibleAssistant?.name?.trim() || getDefaultRouteTitle('/app/chat')

  useEffect(() => {
    if (locateMessageId || locateToEnd) closeSurface()
  }, [closeSurface, locateMessageId, locateToEnd])

  useEffect(() => {
    if (activeTopic) lastVisibleTopicRef.current = activeTopic
  }, [activeTopic])

  useEffect(() => {
    if (!activeTopic) return
    const signature = `${activeTopic.id}:${activeTopic.name}`
    if (lastRecordedRecentTopicRef.current === signature) return

    lastRecordedRecentTopicRef.current = signature
    recordGlobalSearchRecentEntry(createRecentTopicEntryFromTopic(activeTopic))
  }, [activeTopic])

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

  const onActiveTopicArchived = useCallback(
    (topic: Topic, token?: symbol) => {
      if (!topic.assistantId) return
      if (isAssistantListCompleteRef.current && !assistantIdSetRef.current.has(topic.assistantId)) return
      if (pendingLocalArchivesRef.current.get(topic.id)?.get(token) !== archiveSelectionVersionRef.current) return
      cacheService.setPersist('ui.chat.last_used_topic_id', (current) => (current === topic.id ? null : current))
      closeSurface()
      clearLocate()
      clearActiveTopic()
      void navigate({ to: '/app/chat', search: { assistantId: topic.assistantId }, replace: true })
    },
    [clearActiveTopic, clearLocate, closeSurface, navigate]
  )

  const onLocalArchiveRecordSelected = useCallback(
    (archived: Topic, replacement: Topic, token?: symbol) => {
      if (pendingLocalArchivesRef.current.get(archived.id)?.get(token) !== archiveSelectionVersionRef.current)
        return false
      clearLocate()
      setActiveTopic(replacement)
      return true
    },
    [clearLocate, setActiveTopic]
  )
  const onLocalArchiveTopicSelected = useCallback(
    (archived: Topic, replacement: Topic, token?: symbol) => {
      if (onLocalArchiveRecordSelected(archived, replacement, token)) closeSurface()
    },
    [closeSurface, onLocalArchiveRecordSelected]
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

  const isActiveTab = useIsActiveTab()
  const cycleTopic = useCallback(
    (step: 1 | -1) => {
      // Cycle the renderer topics the list actually shows: the visible assistant's topics, or
      // only unlinked topics when no assistant is visible (matches `matchesAssistantFilter`).
      const scopedTopics = visibleAssistantId
        ? rendererTopics.filter((topic) => topic.assistantId === visibleAssistantId)
        : rendererTopics.filter((topic) => !topic.assistantId)
      if (scopedTopics.length === 0) return
      const currentIndex = scopedTopics.findIndex((topic) => topic.id === activeTopicId)
      const nextIndex = currentIndex === -1 ? 0 : (currentIndex + step + scopedTopics.length) % scopedTopics.length
      const nextTopic = scopedTopics[nextIndex]
      if (nextTopic.id !== activeTopicId) setActiveTopicAndCloseResourceView(nextTopic)
    },
    [activeTopicId, rendererTopics, setActiveTopicAndCloseResourceView, visibleAssistantId]
  )
  const cycleAssistant = useCallback(
    (step: 1 | -1) => {
      if (assistants.length === 0) return
      const currentIndex = assistants.findIndex((assistant) => assistant.id === visibleAssistantId)
      const nextIndex = currentIndex === -1 ? 0 : (currentIndex + step + assistants.length) % assistants.length
      const nextAssistant = assistants[nextIndex]
      if (nextAssistant.id === visibleAssistantId) return
      void handleAssistantConversationSelect({ type: 'assistant', assistantId: nextAssistant.id })
    },
    [assistants, handleAssistantConversationSelect, visibleAssistantId]
  )
  useCommandHandler('topic.next', () => cycleTopic(1), { enabled: isActiveTab })
  useCommandHandler('topic.prev', () => cycleTopic(-1), { enabled: isActiveTab })
  useCommandHandler('assistant.next', () => cycleAssistant(1), { enabled: isActiveTab })
  useCommandHandler('assistant.prev', () => cycleAssistant(-1), { enabled: isActiveTab })

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
    (topic: Topic) => {
      closeHistoryRecords()
      handleHistoryTopicSelect(topic)
    },
    [closeHistoryRecords, handleHistoryTopicSelect]
  )
  const handleHistoryActiveTopicChange = useCallback(
    (topic: Topic | null) => {
      clearLocate()
      if (topic) setActiveTopic(topic)
      else reenterChatRoute()
    },
    [clearLocate, reenterChatRoute, setActiveTopic]
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
                  !isWindowFrame ? (
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
    [activeResourceKind, shellPaneOpen, handleOpenAssistantChatFromLibrary, isWindowFrame, toggleShellPane]
  )
  const historyRecordsCenter = historyRecordsActive
    ? {
        className: 'relative',
        content: (
          <HistoryRecordsView
            mode="assistant"
            open={historyRecordsActive && !isWindowFrame}
            activeRecordId={activeTopicId}
            onClose={closeHistoryRecords}
            onRecordSelect={handleHistoryRecordsTopicSelect}
            onActiveRecordChange={handleHistoryActiveTopicChange}
            getArchiveSelectionVersion={getArchiveSelectionVersion}
            isAssistantListComplete={isAssistantListComplete}
            onActiveTopicArchived={onActiveTopicArchived}
            onLocalArchiveRecordSelected={onLocalArchiveRecordSelected}
            onLocalArchivePendingChange={onLocalArchivePendingChange}
            onLocalPermanentDeletePendingChange={onLocalPermanentDeletePendingChange}
            toolbarLeading={
              !isWindowFrame ? (
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
        if (isWindowFrame) {
          cacheService.set('ui.window.chat.topic.expansion.assistant', collapsedAssistantGroupIds)
        } else {
          cacheService.setPersist('ui.topic.expansion.assistant', collapsedAssistantGroupIds)
        }
      }
      await setPanePosition(position)
      setTopicPaneOpen(position === 'right', { force: true })
      setShellPaneOpen(true)
    },
    [allTopics, isWindowFrame, setPanePosition, setShellPaneOpen, setTopicDisplayMode, setTopicPaneOpen, visibleTopic]
  )
  // Classic layout = entity rail + right topic panel; modern layout = one left navigation panel (HomeTabs).
  const pane =
    isClassicTopicLayout && topicListPosition === 'right' ? (
      <AssistantResourceList
        activeAssistant={visibleAssistant}
        activeAssistantId={visibleAssistantId ?? null}
        activeTopicId={visibleTopic?.id ?? null}
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
        activeTopicId={activeTopicId}
        dataEnabled={shellPaneOpen}
        assistantTopicsSource={assistantTopicsSource}
        onActiveAssistantDeleted={handleActiveAssistantDeleted}
        onAddAssistant={() => {
          setAssistantPickerOpen(true)
        }}
        clearActiveTopic={clearActiveTopicAndCloseResourceView}
        setActiveTopic={setActiveTopicAndCloseResourceView}
        onNewTopic={handleCreateEmptyTopic}
        historyRecordsActive={historyRecordsActive}
        onOpenHistoryRecords={isWindowFrame ? undefined : openHistoryRecords}
        getArchiveSelectionVersion={getArchiveSelectionVersion}
        isAssistantListComplete={isAssistantListComplete}
        onActiveTopicArchived={onActiveTopicArchived}
        onLocalArchiveRecordSelected={onLocalArchiveTopicSelected}
        onSelectedTopicOwnerChanged={onSelectedTopicOwnerChanged}
        onLocalArchivePendingChange={onLocalArchivePendingChange}
        onLocalPermanentDeletePendingChange={onLocalPermanentDeletePendingChange}
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
              activeTopicId={activeTopicId}
              assistantIdFilter={visibleAssistantId ?? null}
              clearActiveTopic={clearActiveTopicAndCloseResourceView}
              setActiveTopic={setActiveTopicAndCloseResourceView}
              onNewTopic={handleCreateEmptyTopic}
              getArchiveSelectionVersion={getArchiveSelectionVersion}
              isAssistantListComplete={isAssistantListComplete}
              onActiveTopicArchived={onActiveTopicArchived}
              onLocalArchiveRecordSelected={onLocalArchiveTopicSelected}
              onSelectedTopicOwnerChanged={onSelectedTopicOwnerChanged}
              onLocalArchivePendingChange={onLocalArchivePendingChange}
              onLocalPermanentDeletePendingChange={onLocalPermanentDeletePendingChange}
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
      <HomeTabRuntime
        title={tabTitle}
        emoji={visibleAssistant?.emoji}
        preserveVisuals={preserveTabVisuals}
        activeTopicId={activeTopic?.id}
        activeTopicSource={activeTopicSource}
      />
      <Container id="home-page">
        <ContentContainer $detached={isWindowFrame}>
          <Chat
            activeTopic={visibleTopic}
            topicPending={isActiveTopicLoading}
            centerSurface={centerSurface}
            pane={pane}
            paneOpen={shellPaneOpen}
            panePosition="left"
            onPaneCollapse={() => setShellPaneOpenManually(false)}
            onPaneAutoCollapseChange={handlePaneAutoCollapseChange}
            paneManualToggle={paneManualToggle}
            onNewTopic={handleCreateEmptyTopic}
            onCreateEmptyTopic={handleCreateEmptyTopic}
            showResourceListControls
            sidebarOpen={shellPaneOpen}
            onSidebarToggle={toggleShellPane}
            locateMessageId={locateMessageId}
            locateToEnd={locateToEnd}
            onLocateMessageHandled={handleLocateMessageHandled}
            resourcePaneCount={topicResourcePaneCount}
          />
        </ContentContainer>
        {assistantPickerDialog}
      </Container>
    </TopicRightPane.Scope>
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
