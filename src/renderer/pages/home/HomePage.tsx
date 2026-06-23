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
import { ChatPlacementComposer } from '@renderer/components/chat/composer/variants/ChatComposer'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resources'
import type { ResourceListRevealPayload } from '@renderer/components/chat/resources/resourceListRevealEvents'
import { useWindowFrame } from '@renderer/components/chat/shell/WindowFrameContext'
import { getTabInstanceKey } from '@renderer/config/tabInstanceMetadata'
import { useCurrentTab, useCurrentTabId, useIsActiveTab, useTabSelfMetadata } from '@renderer/context/TabIdContext'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useCommandHandler } from '@renderer/hooks/command'
import { useAssistantApiById, useAssistants } from '@renderer/hooks/useAssistant'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { mapApiTopicToRendererTopic, useActiveTopic, useTopicById, useTopicMutations } from '@renderer/hooks/useTopic'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { FileMetadata, Topic } from '@renderer/types'
import { cn } from '@renderer/utils'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { MIN_WINDOW_HEIGHT, SECOND_MIN_WINDOW_WIDTH } from '@shared/utils/window'
import { useLocation, useSearch } from '@tanstack/react-router'
import type { FC, HTMLAttributes, ReactNode } from 'react'
import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import HistoryRecordsPage from '../history/HistoryRecordsPage'
import Chat from './Chat'
import ChatNavbar from './components/ChatNavbar'
import { parseChatRouteSearch } from './routeSearch'
import HomeTabs from './Tabs'
import type { AddNewTopicPayload } from './types'

const logger = loggerService.withContext('HomePage')
const LAST_USED_ASSISTANT_CACHE_KEY = 'ui.chat.last_used_assistant_id'

type DraftAssistantSelectionSource = 'explicit' | 'last-used' | 'first-assistant' | 'runtime-fallback'
type ResolvedDraftAssistantSelection = { assistantId?: string; source: DraftAssistantSelectionSource }
type DraftAssistantStartState = {
  firstLaunchStarted: boolean
}

type DraftAssistantSelection = {
  assistantId?: string
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
  const [pendingLocateMessageId, setPendingLocateMessageId] = useState<string | undefined>()
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const [historyRecordsOpen, setHistoryRecordsOpen] = useState(false)

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
    isRefreshing: isAssistantsRefreshing
  } = useAssistants()
  const assistantIdSet = useMemo(() => new Set(assistants.map((assistant) => assistant.id)), [assistants])
  const validLastUsedAssistantId =
    lastUsedAssistantId && assistantIdSet.has(lastUsedAssistantId) ? lastUsedAssistantId : undefined
  const fallbackAssistantId = assistants[0]?.id
  const isAssistantListResolved = hasAssistantsLoaded && !isAssistantsLoading && !isAssistantsRefreshing
  const resolveDraftAssistantTarget = useCallback(
    (explicitAssistantId?: string | null): ResolvedDraftAssistantSelection => {
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

  const sendDraftMessage = useCallback(
    async (text: string, options?: DraftChatSendOptions) => {
      const current = draftAssistantSelectionRef.current
      if (!current) {
        throw new Error('Draft topic handoff failed: no active draft topic')
      }

      const topic = await createTopic({
        ...(current.assistantId ? { assistantId: current.assistantId } : {})
      })
      const ack = await window.api.ai.streamOpen({
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

    draftAssistantStartStateRef.current.firstLaunchStarted = true
    startDraftAssistantSelection(routeAssistantId ? { assistantId: routeAssistantId } : undefined)
  }, [
    activeTopic,
    draftAssistantSelectionSnapshot,
    isActiveTopicLoading,
    isAssistantListResolved,
    routeAssistantId,
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

  const panePosition = 'left'
  const pane = (
    <HomeTabs
      activeTopic={visibleTopic}
      setActiveTopic={setActiveTopicAndDiscardDraft}
      onNewTopic={isMessageOnlyView ? undefined : startDraftAssistantSelection}
      onOpenHistoryRecords={openHistoryRecords}
      revealRequest={topicRevealRequest}
    />
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

  if (draftAssistantSelectionSnapshot) {
    return (
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
            onDraftAssistantChange={updateDraftAssistantSelection}
            onSend={sendDraftMessage}
            showResourceListControls={!isMessageOnlyView && !isWindowFrame}
            sidebarOpen={effectiveShowSidebar}
            onSidebarToggle={toggleResourceListOpen}
            welcomeText={t('chat.home.welcome_title')}
          />
        </ContentContainer>
        {historyRecordsOverlay}
      </Container>
    )
  }

  const chatTopic = visibleTopic
  if (!chatTopic) return <Container id="home-page" />

  return (
    <Container id="home-page">
      <ContentContainer $detached={isWindowFrame}>
        <Chat
          activeTopic={chatTopic}
          pane={pane}
          paneOpen={effectiveShowSidebar}
          panePosition={panePosition}
          onPaneCollapse={() => setResourceListOpen(false)}
          onNewTopic={isMessageOnlyView ? undefined : startDraftAssistantSelection}
          showResourceListControls={!isMessageOnlyView && !isWindowFrame}
          sidebarOpen={effectiveShowSidebar}
          onSidebarToggle={toggleResourceListOpen}
          locateMessageId={pendingLocateMessageId}
          onLocateMessageHandled={handleLocateMessageHandled}
        />
      </ContentContainer>
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
  onDraftAssistantChange?: (assistantId: string | null) => void | Promise<void>
  onSend: (text: string, options?: DraftChatSendOptions) => Promise<void>
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
  onDraftAssistantChange,
  onSend,
  showResourceListControls,
  sidebarOpen,
  onSidebarToggle,
  welcomeText
}: DraftWelcomeChatProps) {
  const [messageStyle] = usePreference('chat.message.style')

  const composer = (
    <ChatPlacementComposer
      isHome
      scopeKey={scopeKey}
      assistantId={assistantId}
      onSend={onSend}
      onDraftAssistantChange={onDraftAssistantChange}
      onNewTopic={onNewTopic}
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
      center={
        <ConversationStageCenter placement="home" main={null} composer={composer} homeWelcomeText={welcomeText} />
      }
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
