import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useCommandHandler } from '@renderer/commands'
import { ChatAppShell, EmptyState, LoadingState } from '@renderer/components/chat'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resources'
import type { ResourceListRevealPayload } from '@renderer/components/chat/resources/resourceListRevealEvents'
import {
  createRecentTopicEntryFromTopic,
  upsertGlobalSearchRecentEntry
} from '@renderer/components/GlobalSearch/globalSearchGroups'
import { getTabInstanceKey } from '@renderer/config/tabInstanceMetadata'
import { useCurrentTab, useCurrentTabId, useIsActiveTab, useTabSelfMetadata } from '@renderer/context/TabIdContext'
import { useWindowFrame } from '@renderer/context/WindowFrameContext'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useAssistantApiById } from '@renderer/hooks/useAssistant'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { type TemporaryConversation, useTemporaryConversation } from '@renderer/hooks/useTemporaryConversation'
import { mapApiTopicToRendererTopic, useActiveTopic, useTopicById, useTopicMutations } from '@renderer/hooks/useTopic'
import HistoryRecordsPage from '@renderer/pages/history/HistoryRecordsPage'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Topic } from '@renderer/types'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { MIN_WINDOW_HEIGHT, SECOND_MIN_WINDOW_WIDTH } from '@shared/config/constant'
import { useLocation, useSearch } from '@tanstack/react-router'
import type { FC } from 'react'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import Chat from './Chat'
import { parseChatRouteSearch } from './routeSearch'
import HomeTabs from './Tabs'
import type { AddNewTopicPayload } from './types'

const logger = loggerService.withContext('HomePage')
const LAST_USED_ASSISTANT_CACHE_KEY = 'ui.chat.last_used_assistant_id'
type RuntimeAssistantTarget = string | null

/**
 * Synthesise a renderer Topic shape from a freshly-leased temporary id.
 * Generic creation inherits the last used assistant, while explicit
 * assistant-group creation still wins.
 */
function buildPendingTemporaryTopic(id: string, assistantId?: string | null): Topic {
  const nowIso = new Date().toISOString()
  return {
    id,
    assistantId: assistantId ?? null,
    name: '',
    createdAt: nowIso,
    updatedAt: nowIso,
    messages: [],
    pinned: false,
    isNameManuallyEdited: false
  }
}

function getTopicAssistantId(topic?: Pick<Topic, 'assistantId'> | null): string | null {
  return topic?.assistantId ?? null
}

const HomePage: FC = () => {
  const { t } = useTranslation()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyOrigin, setHistoryOrigin] = useState<DOMRectReadOnly>()
  const [topicRevealRequest, setTopicRevealRequest] = useState<ResourceListRevealRequest>()
  const topicRevealRequestIdRef = useRef(0)
  const startingTemporaryTopicRef = useRef(false)
  const startingTemporaryAssistantIdRef = useRef<RuntimeAssistantTarget | undefined>(undefined)
  const pendingTemporaryTopicRef = useRef<{ topicId: string; assistantId?: string | null } | null>(null)
  const queuedTemporaryTopicTargetRef = useRef<{ assistantId: RuntimeAssistantTarget } | null>(null)
  const [ignoredTemporaryTopicId, setIgnoredTemporaryTopicId] = useState<string | null>(null)
  const [lastUsedAssistantId, setLastUsedAssistantId] = usePersistCache(LAST_USED_ASSISTANT_CACHE_KEY)
  const lastUsedAssistantIdRef = useRef<string | undefined>(lastUsedAssistantId ?? undefined)
  const [, setLastUsedTopicId] = usePersistCache('ui.chat.last_used_topic_id')
  const [recentItems, setRecentItems] = usePersistCache('ui.global_search.recent_items')
  const lastRecordedRecentTopicRef = useRef<string | undefined>(undefined)
  const [pendingLocateMessageId, setPendingLocateMessageId] = useState<string | undefined>()
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')

  const location = useLocation()
  const routeSearch = parseChatRouteSearch(useSearch({ strict: false }) as Record<string, unknown>)
  const currentTab = useCurrentTab()
  const state = location.state as { topic?: Topic } | undefined
  const routeTopicId = routeSearch.topicId
  const tabMetadataTopicId = currentTab ? getTabInstanceKey(currentTab, 'assistants') : undefined
  const routeAssistantId = routeTopicId ? undefined : routeSearch.assistantId
  const isMessageOnlyView = routeSearch.view === 'message' && !!routeTopicId
  // In a detached window the user popped this topic out to focus on it — hide the
  // topic list pane and its toggle, locking the window to one topic.
  const isWindowFrame = useWindowFrame().mode === 'window'
  const effectiveShowSidebar = !isMessageOnlyView && !isWindowFrame && showSidebar
  const { topic: routeApiTopic, isLoading: isRouteTopicLoading } = useTopicById(
    isMessageOnlyView ? routeTopicId : undefined
  )
  const routeTopic = useMemo(
    () => (routeApiTopic ? mapApiTopicToRendererTopic(routeApiTopic) : undefined),
    [routeApiTopic]
  )

  const shouldUseTemporary = !state?.topic && !isMessageOnlyView

  const temporaryConversation = useTemporaryConversation({ type: 'assistant' })
  const {
    conversation: temporaryTopicConversation,
    start: startTemporaryConversation,
    updateAssistant: updateTemporaryAssistant,
    persist: persistTemporaryConversation,
    discard: discardTemporaryConversation
  } = temporaryConversation

  const { refreshTopics } = useTopicMutations()

  useEffect(() => {
    if (temporaryTopicConversation?.type !== 'assistant') {
      pendingTemporaryTopicRef.current = null
      setIgnoredTemporaryTopicId(null)
      return
    }

    if (ignoredTemporaryTopicId === temporaryTopicConversation.topicId) {
      pendingTemporaryTopicRef.current = null
      return
    }

    pendingTemporaryTopicRef.current = {
      topicId: temporaryTopicConversation.topicId,
      assistantId: temporaryTopicConversation.assistantId
    }
  }, [ignoredTemporaryTopicId, temporaryTopicConversation])

  const temporaryTopic = useMemo<Topic | undefined>(() => {
    if (isMessageOnlyView || state?.topic) return undefined
    if (
      temporaryTopicConversation?.type === 'assistant' &&
      temporaryTopicConversation.topicId !== ignoredTemporaryTopicId
    ) {
      return buildPendingTemporaryTopic(temporaryTopicConversation.topicId, temporaryTopicConversation.assistantId)
    }
    return undefined
  }, [ignoredTemporaryTopicId, isMessageOnlyView, state?.topic, temporaryTopicConversation])
  const pendingTemporaryTopic = pendingTemporaryTopicRef.current
  const pendingTemporaryTopicSnapshot = useMemo<Topic | undefined>(() => {
    if (isMessageOnlyView || !pendingTemporaryTopic) return undefined
    if (pendingTemporaryTopic.topicId === ignoredTemporaryTopicId) return undefined
    return buildPendingTemporaryTopic(pendingTemporaryTopic.topicId, pendingTemporaryTopic.assistantId)
  }, [ignoredTemporaryTopicId, isMessageOnlyView, pendingTemporaryTopic])

  const initialTopic = useMemo<Topic | undefined>(() => {
    if (isMessageOnlyView) return undefined
    if (state?.topic) return state.topic
    return temporaryTopic ?? pendingTemporaryTopicSnapshot
  }, [isMessageOnlyView, pendingTemporaryTopicSnapshot, state?.topic, temporaryTopic])

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
  const lastVisibleTopicRef = useRef<Topic | null>(null)
  const temporaryTopicSnapshot = useMemo<Topic | undefined>(() => {
    if (temporaryTopic) return temporaryTopic
    if (!pendingTemporaryTopicSnapshot) return undefined
    if (state?.topic && activeTopic?.id !== pendingTemporaryTopicSnapshot.id) return undefined
    return pendingTemporaryTopicSnapshot
  }, [activeTopic?.id, pendingTemporaryTopicSnapshot, state?.topic, temporaryTopic])
  const visibleTopic = isMessageOnlyView
    ? routeTopic
    : (temporaryTopicSnapshot ?? activeTopic ?? (isActiveTopicLoading ? lastVisibleTopicRef.current : undefined))

  useEffect(() => {
    lastUsedAssistantIdRef.current = lastUsedAssistantId ?? undefined
  }, [lastUsedAssistantId])

  useEffect(() => {
    const assistantId = getTopicAssistantId(activeTopic)
    if (assistantId) {
      lastUsedAssistantIdRef.current = assistantId
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
    // Track "last focused topic" only for persisted topics — temp ids are
    // ephemeral and would point to nothing on the next sidebar click. Drives
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
  const { assistant: visibleAssistant } = useAssistantApiById(visibleTopic?.assistantId ?? undefined)
  // Unpersisted temp topics do not have a stable instance key.
  const isTemporaryView =
    !isMessageOnlyView && !!temporaryTopicSnapshot && visibleTopic?.id === temporaryTopicSnapshot.id
  const tabInstanceTopicId =
    !isMessageOnlyView && !isTemporaryView ? (visibleTopic?.id ?? routeActiveTopicId ?? undefined) : undefined
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
    if (temporaryTopicConversation?.type === 'assistant' && activeTopic.id === temporaryTopicConversation.topicId)
      return

    const signature = `${activeTopic.id}:${activeTopic.name}:${activeTopic.assistantId ?? ''}`
    if (lastRecordedRecentTopicRef.current === signature) return

    const currentRecentItems = recentItems ?? []
    const nextItems = upsertGlobalSearchRecentEntry(currentRecentItems, createRecentTopicEntryFromTopic(activeTopic))
    lastRecordedRecentTopicRef.current = signature
    if (nextItems !== currentRecentItems) {
      setRecentItems(nextItems)
    }
  }, [activeTopic, isMessageOnlyView, recentItems, setRecentItems, temporaryTopicConversation])

  const persistTemporaryTopicAndRefresh = useCallback(
    async (initialName?: string): Promise<TemporaryConversation | null> => {
      const persisted = await persistTemporaryConversation(initialName)
      if (persisted?.type !== 'assistant') {
        throw new Error('Temporary topic handoff failed: no active assistant lease')
      }
      void refreshTopics().catch((err) => {
        logger.warn('Failed to refresh topics after temporary topic persist', err as Error)
      })
      return persisted
    },
    [persistTemporaryConversation, refreshTopics]
  )
  useCommandHandler('app.sidebar.toggle', () => {
    if (isMessageOnlyView) return

    if (showSidebar) {
      void setShowSidebar(false)
      return
    }

    void setShowSidebar(true)
    requestAnimationFrame(() => {
      void EventEmitter.emit(EVENT_NAMES.SHOW_ASSISTANTS)
    })
  })

  useEffect(() => {
    if (isMessageOnlyView) return
    if (!state?.topic) return
    setActiveTopic(state.topic)
    void discardTemporaryConversation()
  }, [discardTemporaryConversation, isMessageOnlyView, setActiveTopic, state?.topic])

  const startTemporaryTopic = useCallback(
    async (payload?: AddNewTopicPayload) => {
      try {
        const hasExplicitAssistantTarget = !!payload && 'assistantId' in payload
        const targetAssistantId = hasExplicitAssistantTarget
          ? (payload.assistantId ?? null)
          : (lastUsedAssistantIdRef.current ?? null)
        const shouldReuseTemporaryTopic = (currentAssistantId: string | null) =>
          currentAssistantId === targetAssistantId

        if (temporaryTopicConversation?.type === 'assistant') {
          const currentAssistantId = temporaryTopicConversation.assistantId ?? null
          if (shouldReuseTemporaryTopic(currentAssistantId)) {
            setIgnoredTemporaryTopicId(null)
            setActiveTopic(buildPendingTemporaryTopic(temporaryTopicConversation.topicId, currentAssistantId))
            return
          }
        }

        if (pendingTemporaryTopicRef.current) {
          const pending = pendingTemporaryTopicRef.current
          const pendingAssistantId = pending.assistantId ?? null
          if (shouldReuseTemporaryTopic(pendingAssistantId)) {
            setIgnoredTemporaryTopicId(null)
            setActiveTopic(buildPendingTemporaryTopic(pending.topicId, pendingAssistantId))
            return
          }
        }

        if (startingTemporaryTopicRef.current) {
          if (startingTemporaryAssistantIdRef.current !== targetAssistantId) {
            queuedTemporaryTopicTargetRef.current = { assistantId: targetAssistantId }
          }
          return
        }

        startingTemporaryTopicRef.current = true
        startingTemporaryAssistantIdRef.current = targetAssistantId
        const next = await startTemporaryConversation({ assistantId: targetAssistantId })
        if (next?.type !== 'assistant') return
        setIgnoredTemporaryTopicId(null)
        pendingTemporaryTopicRef.current = { topicId: next.topicId, assistantId: next.assistantId }
        setActiveTopic(buildPendingTemporaryTopic(next.topicId, next.assistantId))
      } catch (err) {
        logger.error('Failed to start temporary topic', err as Error)
      } finally {
        startingTemporaryTopicRef.current = false
        startingTemporaryAssistantIdRef.current = undefined
        const queuedTarget = queuedTemporaryTopicTargetRef.current
        queuedTemporaryTopicTargetRef.current = null
        if (queuedTarget) {
          void startTemporaryTopic({ assistantId: queuedTarget.assistantId })
        }
      }
    },
    [setActiveTopic, startTemporaryConversation, temporaryTopicConversation]
  )

  const updateTemporaryTopicAssistant = useCallback(
    async (assistantId: string | null) => {
      if (temporaryTopicConversation?.type !== 'assistant') return
      if (assistantId === (temporaryTopicConversation.assistantId ?? null)) return

      try {
        const next = await updateTemporaryAssistant(assistantId)
        if (!next || next.type !== 'assistant') return
        setIgnoredTemporaryTopicId(null)
        setActiveTopic(buildPendingTemporaryTopic(next.topicId, next.assistantId))
      } catch (err) {
        logger.error('Failed to update temporary topic assistant', err as Error)
      }
    },
    [setActiveTopic, temporaryTopicConversation, updateTemporaryAssistant]
  )

  const firstTemporaryStartedRef = useRef(false)
  useEffect(() => {
    if (!shouldUseTemporary || firstTemporaryStartedRef.current || state?.topic) return
    if (temporaryTopicSnapshot || activeTopic || isActiveTopicLoading) return

    firstTemporaryStartedRef.current = true
    void startTemporaryTopic(routeAssistantId ? { assistantId: routeAssistantId } : undefined)
  }, [
    activeTopic,
    isActiveTopicLoading,
    routeAssistantId,
    shouldUseTemporary,
    startTemporaryTopic,
    state?.topic,
    temporaryTopicSnapshot
  ])

  const setActiveTopicAndDiscardTemporary = useCallback(
    (topic: Topic) => {
      // One tab per topic: if this topic is already open in another tab, focus
      // that tab instead of navigating the current one (which would duplicate
      // it in the tab bar). The current tab keeps its own topic untouched.
      if (conversationNav.focusExistingTab(topic.id, { excludeTabId: currentTabId ?? undefined })) return false

      const currentTemporaryTopicId =
        temporaryTopicConversation?.type === 'assistant'
          ? temporaryTopicConversation.topicId
          : pendingTemporaryTopicRef.current?.topicId

      if (currentTemporaryTopicId && topic.id !== currentTemporaryTopicId) {
        pendingTemporaryTopicRef.current = null
        setIgnoredTemporaryTopicId(currentTemporaryTopicId)
        void discardTemporaryConversation()
      }
      setActiveTopic(topic)
      return true
    },
    [conversationNav, currentTabId, discardTemporaryConversation, setActiveTopic, temporaryTopicConversation]
  )

  useEffect(() => {
    void window.api.window.setMinimumSize(SECOND_MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)

    return () => {
      void window.api.window.resetMinimumSize()
    }
  }, [])

  const openHistory = useCallback((origin?: DOMRectReadOnly) => {
    setHistoryOrigin(origin)
    setHistoryOpen(true)
  }, [])
  const closeHistory = useCallback(() => setHistoryOpen(false), [])
  const handleHistoryTopicSelect = useCallback(
    (topic: Topic, messageId?: string) => {
      if (!setActiveTopicAndDiscardTemporary(topic)) return
      void setShowSidebar(true)
      setPendingLocateMessageId(messageId)
      topicRevealRequestIdRef.current += 1
      setTopicRevealRequest({
        clearFilters: true,
        clearQuery: true,
        itemId: topic.id,
        requestId: topicRevealRequestIdRef.current
      })
    },
    [setActiveTopicAndDiscardTemporary, setShowSidebar]
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

  const historyOverlay = (
    <HistoryRecordsPage
      mode="assistant"
      open={historyOpen}
      activeRecordId={visibleTopic?.id}
      origin={historyOrigin}
      onClose={closeHistory}
      onRecordSelect={handleHistoryTopicSelect}
    />
  )

  if (!visibleTopic) {
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
          {historyOverlay}
        </Container>
      )
    }

    return <Container id="home-page">{historyOverlay}</Container>
  }

  const panePosition = 'left'
  const isTemporaryTopicActive =
    !isMessageOnlyView && !!temporaryTopicSnapshot && visibleTopic.id === temporaryTopicSnapshot.id

  return (
    <Container id="home-page">
      <ContentContainer $detached={isWindowFrame}>
        <Chat
          activeTopic={visibleTopic}
          pane={
            <HomeTabs
              activeTopic={visibleTopic}
              setActiveTopic={setActiveTopicAndDiscardTemporary}
              onOpenHistory={openHistory}
              onNewTopic={isMessageOnlyView ? undefined : startTemporaryTopic}
              revealRequest={topicRevealRequest}
            />
          }
          paneOpen={effectiveShowSidebar}
          panePosition={panePosition}
          onPaneCollapse={() => void setShowSidebar(false)}
          onNewTopic={isMessageOnlyView ? undefined : startTemporaryTopic}
          showResourceListControls={!isMessageOnlyView && !isWindowFrame}
          // Wire the persist callback only while the temp lease is the
          // currently-active topic. If the user clicks a sidebar topic
          // before sending, the active id no longer matches the lease and
          // the next send won't accidentally persist an empty lease.
          onPersistTemporaryTopic={isTemporaryTopicActive ? persistTemporaryTopicAndRefresh : undefined}
          onTemporaryAssistantChange={isTemporaryTopicActive ? updateTemporaryTopicAssistant : undefined}
          locateMessageId={pendingLocateMessageId}
          onLocateMessageHandled={handleLocateMessageHandled}
        />
      </ContentContainer>
      {historyOverlay}
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
    <div className="flex h-[calc(100vh-var(--navbar-height)-6px)] flex-1 overflow-hidden rounded-tl-[10px] rounded-bl-[10px] bg-background">
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

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  max-width: 100vw;
`

const ContentContainer = styled.div<{ $detached?: boolean }>`
  display: flex;
  flex: 1;
  flex-direction: row;
  min-height: 0;
  overflow: hidden;
  /* The 12px inset is for the main window's rounded content edge; a detached
     sub-window has no such inset, so it would just leave a dead right gap. */
  max-width: ${({ $detached }) => ($detached ? '100vw' : 'calc(100vw - 12px)')};
`

export default HomePage
