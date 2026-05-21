import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resources'
import {
  createRecentTopicEntryFromTopic,
  upsertGlobalSearchRecentEntry
} from '@renderer/components/global-search/globalSearchGroups'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { type TemporaryConversation, useTemporaryConversation } from '@renderer/hooks/useTemporaryConversation'
import { useActiveTopic, useTopicMutations } from '@renderer/hooks/useTopic'
import HistoryRecordsPage from '@renderer/pages/history/HistoryRecordsPage'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import NavigationService from '@renderer/services/NavigationService'
import type { Topic } from '@renderer/types'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, SECOND_MIN_WINDOW_WIDTH } from '@shared/config/constant'
import { useLocation, useNavigate } from '@tanstack/react-router'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'

import Chat from './Chat'
import HomeSidePanelDrawer from './components/HomeSidePanelDrawer'
import HomeTabs from './Tabs'
import type { AddNewTopicPayload } from './types'

const logger = loggerService.withContext('HomePage')
const LAST_USED_ASSISTANT_CACHE_KEY = 'ui.chat.last_used_assistant_id'

/**
 * Synthesise a renderer Topic shape from a freshly-leased temporary id.
 * Generic creation inherits the last used assistant, while explicit
 * assistant-group creation still wins.
 */
function buildPendingTemporaryTopic(id: string, assistantId?: string | null): Topic {
  const nowIso = new Date().toISOString()
  return {
    id,
    assistantId: assistantId ?? undefined,
    name: '',
    createdAt: nowIso,
    updatedAt: nowIso,
    messages: [],
    pinned: false,
    isNameManuallyEdited: false
  }
}

function getTopicAssistantId(topic?: Pick<Topic, 'assistantId'> | null): string | undefined {
  return topic?.assistantId || undefined
}

const HomePage: FC = () => {
  const navigate = useNavigate()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyOrigin, setHistoryOrigin] = useState<DOMRectReadOnly>()
  const [topicRevealRequest, setTopicRevealRequest] = useState<ResourceListRevealRequest>()
  const topicRevealRequestIdRef = useRef(0)
  const startingTemporaryTopicRef = useRef(false)
  const startingTemporaryAssistantIdRef = useRef<string | undefined>(undefined)
  const pendingTemporaryTopicRef = useRef<{ topicId: string; assistantId?: string | null } | null>(null)
  const queuedTemporaryTopicTargetRef = useRef<{ assistantId?: string } | null>(null)
  const [lastUsedAssistantId, setLastUsedAssistantId] = usePersistCache(LAST_USED_ASSISTANT_CACHE_KEY)
  const lastUsedAssistantIdRef = useRef<string | undefined>(lastUsedAssistantId ?? undefined)
  const [recentItems, setRecentItems] = usePersistCache('ui.global_search.recent_items')
  const lastRecordedRecentTopicRef = useRef<string | undefined>(undefined)
  const [pendingLocateMessageId, setPendingLocateMessageId] = useState<string | undefined>()

  const location = useLocation()
  const state = location.state as { topic?: Topic } | undefined

  const shouldUseTemporary = !state?.topic

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
    pendingTemporaryTopicRef.current =
      temporaryTopicConversation?.type === 'assistant'
        ? { topicId: temporaryTopicConversation.topicId, assistantId: temporaryTopicConversation.assistantId }
        : null
  }, [temporaryTopicConversation])

  const initialTopic = useMemo<Topic | undefined>(() => {
    if (state?.topic) return state.topic
    if (temporaryTopicConversation?.type === 'assistant') {
      return buildPendingTemporaryTopic(temporaryTopicConversation.topicId, temporaryTopicConversation.assistantId)
    }
    return undefined
  }, [state?.topic, temporaryTopicConversation])

  const {
    activeTopic,
    setActiveTopic,
    isLoading: isActiveTopicLoading
  } = useActiveTopic(initialTopic, {
    // While we're waiting for the temporary topic to lease, suppress the
    // auto-pick-first-topic effect so the UI doesn't flash a stale topic
    // before our blank one shows up.
    autoPickFirst: !shouldUseTemporary
  })
  const lastVisibleTopicRef = useRef<Topic | null>(null)
  const visibleTopic = activeTopic ?? (isActiveTopicLoading ? lastVisibleTopicRef.current : undefined)

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

  useEffect(() => {
    if (activeTopic) lastVisibleTopicRef.current = activeTopic
  }, [activeTopic])

  useEffect(() => {
    if (!activeTopic) return
    if (temporaryTopicConversation?.type === 'assistant' && activeTopic.id === temporaryTopicConversation.topicId)
      return

    const signature = `${activeTopic.id}:${activeTopic.name}:${activeTopic.assistantId ?? ''}`
    if (lastRecordedRecentTopicRef.current === signature) return

    const nextItems = upsertGlobalSearchRecentEntry(recentItems, createRecentTopicEntryFromTopic(activeTopic))
    lastRecordedRecentTopicRef.current = signature
    if (nextItems !== recentItems) {
      setRecentItems(nextItems)
    }
  }, [activeTopic, recentItems, setRecentItems, temporaryTopicConversation])

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
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')

  useShortcut('general.toggle_sidebar', () => {
    if (!showSidebar) {
      void setShowSidebar(true)
      requestAnimationFrame(() => {
        void EventEmitter.emit(EVENT_NAMES.SHOW_ASSISTANTS)
      })
      return
    }

    void EventEmitter.emit(EVENT_NAMES.SHOW_ASSISTANTS)
  })

  useShortcut('topic.toggle_show_topics', () => {
    if (!showSidebar) {
      void setShowSidebar(true)
      requestAnimationFrame(() => {
        void EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
      })
      return
    }

    void EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
  })

  useEffect(() => {
    NavigationService.setNavigate(navigate)
  }, [navigate])

  useEffect(() => {
    if (!state?.topic) return
    setActiveTopic(state.topic)
    void discardTemporaryConversation()
  }, [discardTemporaryConversation, setActiveTopic, state?.topic])

  const startTemporaryTopic = useCallback(
    async (payload?: AddNewTopicPayload) => {
      try {
        const hasExplicitAssistantTarget = !!payload && 'assistantId' in payload
        const targetAssistantId = hasExplicitAssistantTarget
          ? (payload.assistantId ?? undefined)
          : lastUsedAssistantIdRef.current

        if (temporaryTopicConversation?.type === 'assistant') {
          const currentAssistantId = temporaryTopicConversation.assistantId ?? undefined
          if (!hasExplicitAssistantTarget || currentAssistantId === targetAssistantId) {
            setActiveTopic(buildPendingTemporaryTopic(temporaryTopicConversation.topicId, currentAssistantId))
            void EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
            return
          }
        }

        if (pendingTemporaryTopicRef.current) {
          const pending = pendingTemporaryTopicRef.current
          const pendingAssistantId = pending.assistantId ?? undefined
          if (!hasExplicitAssistantTarget || pendingAssistantId === targetAssistantId) {
            setActiveTopic(buildPendingTemporaryTopic(pending.topicId, pendingAssistantId))
            void EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
            return
          }
        }

        if (startingTemporaryTopicRef.current) {
          if (startingTemporaryAssistantIdRef.current !== targetAssistantId) {
            queuedTemporaryTopicTargetRef.current = { assistantId: targetAssistantId }
          }
          void EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
          return
        }

        startingTemporaryTopicRef.current = true
        startingTemporaryAssistantIdRef.current = targetAssistantId
        const next = await startTemporaryConversation({ assistantId: targetAssistantId })
        if (next?.type !== 'assistant') return
        pendingTemporaryTopicRef.current = { topicId: next.topicId, assistantId: next.assistantId }
        setActiveTopic(buildPendingTemporaryTopic(next.topicId, next.assistantId))
        void EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
      } catch (err) {
        logger.error('Failed to start temporary topic', err as Error)
      } finally {
        startingTemporaryTopicRef.current = false
        startingTemporaryAssistantIdRef.current = undefined
        const queuedTarget = queuedTemporaryTopicTargetRef.current
        queuedTemporaryTopicTargetRef.current = null
        if (queuedTarget) {
          void startTemporaryTopic({ assistantId: queuedTarget.assistantId ?? null })
        }
      }
    },
    [setActiveTopic, startTemporaryConversation, temporaryTopicConversation]
  )

  const updateTemporaryTopicAssistant = useCallback(
    async (assistantId: string | null) => {
      if (!assistantId || temporaryTopicConversation?.type !== 'assistant') return
      if (assistantId === temporaryTopicConversation.assistantId) return

      try {
        const next = await updateTemporaryAssistant(assistantId)
        if (!next || next.type !== 'assistant') return
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
    firstTemporaryStartedRef.current = true
    void startTemporaryTopic()
  }, [shouldUseTemporary, startTemporaryTopic, state?.topic])

  const setActiveTopicAndDiscardTemporary = useCallback(
    (topic: Topic) => {
      if (temporaryTopicConversation?.id && topic.id !== temporaryTopicConversation.id) {
        void discardTemporaryConversation()
      }
      setActiveTopic(topic)
    },
    [discardTemporaryConversation, setActiveTopic, temporaryTopicConversation?.id]
  )

  useEffect(() => {
    void window.api.window.setMinimumSize(showSidebar ? MIN_WINDOW_WIDTH : SECOND_MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)

    return () => {
      void window.api.window.resetMinimumSize()
    }
  }, [showSidebar])

  const openHistory = useCallback((origin?: DOMRectReadOnly) => {
    setHistoryOrigin(origin)
    setHistoryOpen(true)
  }, [])
  const closeHistory = useCallback(() => setHistoryOpen(false), [])
  const handleHistoryTopicSelect = useCallback(
    (topic: Topic) => {
      void setShowSidebar(true)
      setActiveTopicAndDiscardTemporary(topic)
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

  useEffect(() => {
    const unsubscribe = EventEmitter.on(EVENT_NAMES.GLOBAL_SEARCH_SELECT_TOPIC, (topic) => {
      setPendingLocateMessageId(undefined)
      handleHistoryTopicSelect(topic as Topic)
    })
    const unsubscribeMessage = EventEmitter.on(EVENT_NAMES.GLOBAL_SEARCH_SELECT_TOPIC_MESSAGE, (payload) => {
      const { messageId, topic } = payload as { messageId?: string; topic?: Topic }
      if (!topic || !messageId) return

      setPendingLocateMessageId(messageId)
      handleHistoryTopicSelect(topic)
    })

    return () => {
      unsubscribe()
      unsubscribeMessage()
    }
  }, [handleHistoryTopicSelect])

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

  const openSidePanelDrawer = useCallback(() => {
    if (!visibleTopic) return

    void HomeSidePanelDrawer.show({
      activeTopic: visibleTopic,
      setActiveTopic: setActiveTopicAndDiscardTemporary,
      onOpenHistory: openHistory,
      onNewTopic: startTemporaryTopic
    })
  }, [openHistory, setActiveTopicAndDiscardTemporary, startTemporaryTopic, visibleTopic])

  if (!visibleTopic) {
    return <Container id="home-page">{historyOverlay}</Container>
  }

  const panePosition = 'left'
  const isTemporaryTopicActive =
    temporaryTopicConversation?.type === 'assistant' && visibleTopic.id === temporaryTopicConversation.topicId

  return (
    <Container id="home-page">
      <ContentContainer>
        <Chat
          activeTopic={visibleTopic}
          pane={
            <HomeTabs
              activeTopic={visibleTopic}
              setActiveTopic={setActiveTopicAndDiscardTemporary}
              onOpenHistory={openHistory}
              onNewTopic={startTemporaryTopic}
              revealRequest={topicRevealRequest}
            />
          }
          paneOpen={showSidebar}
          panePosition={panePosition}
          onNewTopic={startTemporaryTopic}
          hideNavbar={isTemporaryTopicActive}
          onOpenSidePanelDrawer={openSidePanelDrawer}
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

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  max-width: 100vw;
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  overflow: hidden;
  max-width: calc(100vw - 12px);
`

export default HomePage
