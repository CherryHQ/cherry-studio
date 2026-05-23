import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resources'
import {
  createRecentSessionEntryFromSession,
  upsertGlobalSearchRecentEntry
} from '@renderer/components/global-search/globalSearchGroups'
import { useCache, usePersistCache } from '@renderer/data/hooks/useCache'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import { useAgents } from '@renderer/hooks/agents/useAgent'
import { useSession } from '@renderer/hooks/agents/useSession'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { type TemporaryConversationDefaults, useTemporaryConversation } from '@renderer/hooks/useTemporaryConversation'
import HistoryRecordsPage from '@renderer/pages/history/HistoryRecordsPage'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { cn } from '@renderer/utils'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, SECOND_MIN_WINDOW_WIDTH } from '@shared/config/constant'
import { useSearch } from '@tanstack/react-router'
import type { PropsWithChildren } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AgentChat from './AgentChat'
import AgentSidePanel from './AgentSidePanel'
import { AgentEmpty } from './components/status'
import { parseAgentRouteSearch } from './routeSearch'

const logger = loggerService.withContext('AgentPage')

const AgentPage = () => {
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyOrigin, setHistoryOrigin] = useState<DOMRectReadOnly>()
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const routeSearch = parseAgentRouteSearch(useSearch({ strict: false }) as Record<string, unknown>)
  const routeSessionId = routeSearch.sessionId
  const isMessageOnlyView = routeSearch.view === 'message' && !!routeSessionId
  const effectiveShowSidebar = !isMessageOnlyView && showSidebar
  const toggleShowSidebar = () => void setShowSidebar(!showSidebar)
  const { session: routeSession, isLoading: isRouteSessionLoading } = useSession(
    isMessageOnlyView ? routeSessionId : null
  )
  const { agents } = useAgents()
  const [activeSessionId, setActiveSessionId] = useCache('agent.active_session_id')
  const [lastUsedAgentId, setLastUsedAgentId] = usePersistCache('ui.agent.last_used_agent_id')
  const [lastUsedWorkspaceId, setLastUsedWorkspaceId] = usePersistCache('ui.agent.last_used_workspace_id')
  const { session: activeSession } = useSession(activeSessionId)
  const [recentItems, setRecentItems] = usePersistCache('ui.global_search.recent_items')
  const lastRecordedRecentSessionRef = useRef<string | undefined>(undefined)
  const [sessionRevealRequest, setSessionRevealRequest] = useState<ResourceListRevealRequest>()
  const [pendingLocateMessageId, setPendingLocateMessageId] = useState<string | undefined>()
  const sessionRevealRequestIdRef = useRef(0)
  const initialTemporarySessionEvaluatedRef = useRef(false)
  const [replacingTemporaryAgent, setReplacingTemporaryAgent] = useState(false)
  const [replacingTemporaryWorkspace, setReplacingTemporaryWorkspace] = useState(false)
  const { t } = useTranslation()
  const invalidateCache = useInvalidateCache()
  const temporaryConversation = useTemporaryConversation({ type: 'agent' })
  const {
    conversation: temporaryAgentConversation,
    persistedConversation,
    start: startTemporaryConversation,
    replace: replaceTemporaryConversation,
    persist: persistTemporaryConversation,
    discard: discardTemporaryConversation
  } = temporaryConversation

  useShortcut('general.toggle_sidebar', () => {
    if (isMessageOnlyView) return

    toggleShowSidebar()
  })

  useShortcut('topic.toggle_show_topics', () => {
    if (isMessageOnlyView) return

    void EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
  })

  useEffect(() => {
    if (isMessageOnlyView) return
    if (!activeSession) return

    const signature = `${activeSession.id}:${activeSession.name}:${activeSession.agentId ?? ''}`
    if (lastRecordedRecentSessionRef.current === signature) return

    const currentRecentItems = recentItems ?? []
    const nextItems = upsertGlobalSearchRecentEntry(
      currentRecentItems,
      createRecentSessionEntryFromSession(activeSession)
    )
    lastRecordedRecentSessionRef.current = signature
    if (nextItems !== currentRecentItems) {
      setRecentItems(nextItems)
    }
  }, [activeSession, isMessageOnlyView, recentItems, setRecentItems])

  useEffect(() => {
    void window.api.window.setMinimumSize(
      effectiveShowSidebar ? MIN_WINDOW_WIDTH : SECOND_MIN_WINDOW_WIDTH,
      MIN_WINDOW_HEIGHT
    )
    return () => {
      void window.api.window.resetMinimumSize()
    }
  }, [effectiveShowSidebar])

  const openHistory = useCallback((origin?: DOMRectReadOnly) => {
    setHistoryOrigin(origin)
    setHistoryOpen(true)
  }, [])
  const closeHistory = useCallback(() => setHistoryOpen(false), [])
  const handleHistorySessionSelect = useCallback(
    (sessionId: string | null) => {
      void setShowSidebar(true)
      void discardTemporaryConversation()
      setActiveSessionId(sessionId)

      if (!sessionId) return

      sessionRevealRequestIdRef.current += 1
      setSessionRevealRequest({
        clearFilters: true,
        clearQuery: true,
        itemId: sessionId,
        requestId: sessionRevealRequestIdRef.current
      })
    },
    [discardTemporaryConversation, setActiveSessionId, setShowSidebar]
  )

  useEffect(() => {
    const unsubscribeSession = EventEmitter.on(EVENT_NAMES.GLOBAL_SEARCH_SELECT_AGENT_SESSION, (sessionId) => {
      setPendingLocateMessageId(undefined)
      handleHistorySessionSelect(sessionId as string)
    })
    const unsubscribeMessage = EventEmitter.on(EVENT_NAMES.GLOBAL_SEARCH_SELECT_AGENT_SESSION_MESSAGE, (payload) => {
      const { messageId, sessionId } = payload as { messageId?: string; sessionId?: string }
      if (!sessionId || !messageId) return

      setPendingLocateMessageId(messageId)
      handleHistorySessionSelect(sessionId)
    })

    return () => {
      unsubscribeSession()
      unsubscribeMessage()
    }
  }, [handleHistorySessionSelect])

  const startTemporarySession = useCallback(
    async (defaults: TemporaryConversationDefaults) => {
      const rememberedWorkspaceId = defaults.workspaceId ?? lastUsedWorkspaceId ?? undefined
      if (
        temporaryAgentConversation?.type === 'agent' &&
        defaults.agentId === temporaryAgentConversation.agentId &&
        (rememberedWorkspaceId ?? null) === (temporaryAgentConversation.session.workspaceId ?? null)
      ) {
        if (temporaryAgentConversation.session.workspaceId) {
          setLastUsedWorkspaceId(temporaryAgentConversation.session.workspaceId)
        }
        setActiveSessionId(null)
        return
      }

      const startDefaults = {
        ...defaults,
        ...(rememberedWorkspaceId ? { workspaceId: rememberedWorkspaceId } : {}),
        name: defaults.name ?? t('common.unnamed')
      }

      let started: Awaited<ReturnType<typeof startTemporaryConversation>>
      try {
        started = await startTemporaryConversation(startDefaults)
      } catch (err) {
        if (!rememberedWorkspaceId || defaults.workspaceId) throw err

        logger.warn('Failed to start temporary session with remembered workspace', err as Error, {
          workspaceId: rememberedWorkspaceId
        })
        setLastUsedWorkspaceId(null)
        started = await startTemporaryConversation({ ...defaults, name: defaults.name ?? t('common.unnamed') })
      }
      if (started?.type === 'agent') {
        setLastUsedAgentId(started.agentId)
        if (started.session.workspaceId) {
          setLastUsedWorkspaceId(started.session.workspaceId)
        }
      }
      setActiveSessionId(null)
    },
    [
      lastUsedWorkspaceId,
      setActiveSessionId,
      setLastUsedAgentId,
      setLastUsedWorkspaceId,
      startTemporaryConversation,
      t,
      temporaryAgentConversation
    ]
  )

  useEffect(() => {
    if (initialTemporarySessionEvaluatedRef.current) {
      return
    }

    if (isMessageOnlyView) {
      initialTemporarySessionEvaluatedRef.current = true
      return
    }

    if (activeSessionId || temporaryAgentConversation) {
      initialTemporarySessionEvaluatedRef.current = true
      return
    }

    const rememberedAgent = lastUsedAgentId ? agents?.find((agent) => agent.id === lastUsedAgentId) : undefined
    const defaultAgent = rememberedAgent ?? agents?.[0]
    if (!defaultAgent) return

    initialTemporarySessionEvaluatedRef.current = true
    void startTemporarySession({ agentId: defaultAgent.id })
  }, [activeSessionId, agents, isMessageOnlyView, lastUsedAgentId, startTemporarySession, temporaryAgentConversation])

  const persistTemporarySession = useCallback(
    async (initialName?: string) => {
      const persisted = await persistTemporaryConversation(initialName)
      if (persisted?.type === 'agent') {
        setLastUsedAgentId(persisted.agentId)
        if (persisted.session.workspaceId) {
          setLastUsedWorkspaceId(persisted.session.workspaceId)
        }
        setActiveSessionId(persisted.sessionId)
        void invalidateCache(['/sessions', '/workspaces', `/sessions/${persisted.sessionId}`]).catch((err) => {
          logger.warn('Failed to refresh session metadata after temporary session persist', err as Error)
        })
        return persisted
      }
      return null
    },
    [invalidateCache, persistTemporaryConversation, setActiveSessionId, setLastUsedAgentId, setLastUsedWorkspaceId]
  )
  const replaceTemporaryAgent = useCallback(
    async (agentId: string | null) => {
      if (!agentId || temporaryAgentConversation?.type !== 'agent') return
      if (agentId === temporaryAgentConversation.agentId || replacingTemporaryAgent) return

      const agent = agents?.find((candidate) => candidate.id === agentId)
      if (!agent) {
        window.toast.error(t('agent.session.create.error.failed'))
        return
      }

      setReplacingTemporaryAgent(true)
      try {
        await replaceTemporaryConversation({
          agentId,
          workspaceId: temporaryAgentConversation.session.workspaceId ?? undefined,
          name: temporaryAgentConversation.name ?? t('common.unnamed')
        })
        setLastUsedAgentId(agentId)
        setActiveSessionId(null)
      } catch (err) {
        window.toast.error(formatErrorMessageWithPrefix(err, t('agent.session.create.error.failed')))
      } finally {
        setReplacingTemporaryAgent(false)
      }
    },
    [
      agents,
      replaceTemporaryConversation,
      replacingTemporaryAgent,
      setActiveSessionId,
      setLastUsedAgentId,
      t,
      temporaryAgentConversation
    ]
  )
  const replaceTemporaryWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!workspaceId || temporaryAgentConversation?.type !== 'agent') return
      if (workspaceId === temporaryAgentConversation.session.workspaceId) {
        setLastUsedWorkspaceId(workspaceId)
        return
      }
      if (replacingTemporaryWorkspace) return

      setReplacingTemporaryWorkspace(true)
      try {
        await replaceTemporaryConversation({
          agentId: temporaryAgentConversation.agentId,
          workspaceId,
          name: temporaryAgentConversation.name ?? t('common.unnamed')
        })
        setLastUsedWorkspaceId(workspaceId)
        setActiveSessionId(null)
      } catch (err) {
        logger.error('Failed to replace temporary workspace', err as Error, { workspaceId })
        window.toast.error(formatErrorMessageWithPrefix(err, t('agent.session.create.error.failed')))
      } finally {
        setReplacingTemporaryWorkspace(false)
      }
    },
    [
      replaceTemporaryConversation,
      replacingTemporaryWorkspace,
      setActiveSessionId,
      setLastUsedWorkspaceId,
      t,
      temporaryAgentConversation
    ]
  )
  const handleLocateMessageHandled = useCallback(() => {
    setPendingLocateMessageId(undefined)
  }, [])

  const historyOverlay = (
    <HistoryRecordsPage
      mode="agent"
      open={historyOpen}
      activeRecordId={activeSessionId}
      origin={historyOrigin}
      onClose={closeHistory}
      onRecordSelect={handleHistorySessionSelect}
    />
  )

  if (agents && agents.length === 0) {
    return (
      <Container>
        <AgentEmpty />
        {historyOverlay}
      </Container>
    )
  }

  const panePosition = 'left'
  const pendingSession =
    persistedConversation?.type === 'agent' && activeSessionId === persistedConversation.sessionId
      ? persistedConversation.session
      : null

  return (
    <Container>
      <div className="flex min-w-0 flex-1 shrink flex-row overflow-hidden">
        <AgentChat
          pendingSession={pendingSession}
          pane={
            <AgentSidePanel
              onOpenHistory={openHistory}
              revealRequest={sessionRevealRequest}
              onDiscardTemporarySession={discardTemporaryConversation}
              onStartTemporarySession={startTemporarySession}
            />
          }
          lockedSession={isMessageOnlyView ? (routeSession ?? null) : undefined}
          lockedSessionLoading={isMessageOnlyView && isRouteSessionLoading}
          paneOpen={effectiveShowSidebar}
          panePosition={panePosition}
          showResourceListControls={!isMessageOnlyView}
          temporaryConversation={isMessageOnlyView ? null : temporaryAgentConversation}
          onStartTemporarySession={isMessageOnlyView ? undefined : startTemporarySession}
          onPersistTemporarySession={isMessageOnlyView ? undefined : persistTemporarySession}
          onDraftAgentChange={isMessageOnlyView ? undefined : replaceTemporaryAgent}
          onDraftWorkspaceChange={isMessageOnlyView ? undefined : replaceTemporaryWorkspace}
          onVisibleAgentChange={isMessageOnlyView ? undefined : setLastUsedAgentId}
          onVisibleWorkspaceChange={isMessageOnlyView ? undefined : setLastUsedWorkspaceId}
          locateMessageId={pendingLocateMessageId}
          onLocateMessageHandled={handleLocateMessageHandled}
          replacingTemporaryAgent={replacingTemporaryAgent}
          replacingTemporaryWorkspace={replacingTemporaryWorkspace}
        />
      </div>
      {historyOverlay}
    </Container>
  )
}

const Container = ({ children, className }: PropsWithChildren<{ className?: string }>) => {
  return (
    <div id="agent-page" className={cn('relative flex flex-1 flex-col overflow-hidden', className)}>
      {children}
    </div>
  )
}

export default AgentPage
