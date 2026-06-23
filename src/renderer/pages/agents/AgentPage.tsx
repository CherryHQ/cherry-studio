import { dataApiService } from '@data/DataApiService'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resources'
import type { ResourceListRevealPayload } from '@renderer/components/chat/resources/resourceListRevealEvents'
import { useWindowFrame } from '@renderer/components/chat/shell/WindowFrameContext'
import { getTabInstanceKey } from '@renderer/config/tabInstanceMetadata'
import { useCurrentTab, useCurrentTabId, useIsActiveTab, useTabSelfMetadata } from '@renderer/context/TabIdContext'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import { useAgent, useAgents } from '@renderer/hooks/agents/useAgent'
import { useActiveSession, useSession } from '@renderer/hooks/agents/useSession'
import { useCommandHandler } from '@renderer/hooks/command'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { cn } from '@renderer/utils'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE, type AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import { MIN_WINDOW_HEIGHT, SECOND_MIN_WINDOW_WIDTH } from '@shared/utils/window'
import { useSearch } from '@tanstack/react-router'
import type { PropsWithChildren } from 'react'
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import HistoryRecordsPage from '../history/HistoryRecordsPage'
import AgentChat from './AgentChat'
import AgentSidePanel from './AgentSidePanel'
import { parseAgentRouteSearch } from './routeSearch'
import type { DraftAgentSession, DraftAgentSessionDefaults, PersistentAgentSessionConversation } from './types'

const logger = loggerService.withContext('AgentPage')

function isUserWorkspaceSession(session: AgentSessionEntity | null | undefined): boolean {
  return !!session?.workspaceId && session.workspace?.type !== 'system'
}

const AgentPage = () => {
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const routeSearch = parseAgentRouteSearch(useSearch({ strict: false }) as Record<string, unknown>)
  const currentTab = useCurrentTab()
  const routeSessionId = routeSearch.sessionId
  const tabMetadataSessionId = currentTab ? getTabInstanceKey(currentTab, 'agents') : undefined
  const isMessageOnlyView = routeSearch.view === 'message' && !!routeSessionId
  const isWindowFrame = useWindowFrame().mode === 'window'
  // Detached windows are single-conversation: no session list, so no sidebar at all.
  const effectiveShowSidebar = !isMessageOnlyView && !isWindowFrame && showSidebar
  const { session: routeSession, isLoading: isRouteSessionLoading } = useSession(
    isMessageOnlyView ? routeSessionId : null
  )
  const { agents, isLoading: isAgentsLoading } = useAgents()
  const routeActiveSessionId = isMessageOnlyView ? null : (routeSessionId ?? tabMetadataSessionId ?? null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => routeActiveSessionId)
  const pendingSelectedSessionRef = useRef<AgentSessionEntity | null>(null)
  const draftSessionRef = useRef<DraftAgentSession | null>(null)
  const [draftSession, setDraftSession] = useState<DraftAgentSession | null>(null)
  const [historyRecordsOpen, setHistoryRecordsOpen] = useState(false)

  useEffect(() => {
    pendingSelectedSessionRef.current = null
    if (routeActiveSessionId === null && draftSessionRef.current) {
      setActiveSessionId(null)
      return
    }

    draftSessionRef.current = null
    setDraftSession(null)
    setActiveSessionId(routeActiveSessionId)
  }, [routeActiveSessionId])
  const [, setLastUsedSessionId] = usePersistCache('ui.agent.last_used_session_id')
  const [lastUsedAgentId, setLastUsedAgentId] = usePersistCache('ui.agent.last_used_agent_id')
  const [lastUsedWorkspaceId, setLastUsedWorkspaceId] = usePersistCache('ui.agent.last_used_workspace_id')
  const [sessionRevealRequest, setSessionRevealRequest] = useState<ResourceListRevealRequest>()
  const [pendingLocateMessageId, setPendingLocateMessageId] = useState<string | undefined>()
  const sessionRevealRequestIdRef = useRef(0)
  const initialDraftSessionEvaluatedRef = useRef(false)
  const [replacingDraftAgent, setReplacingDraftAgent] = useState(false)
  const [replacingDraftWorkspace, setReplacingDraftWorkspace] = useState(false)
  const [missingAgentDraft, setMissingAgentDraft] = useState(false)
  const { t } = useTranslation()
  const invalidateCache = useInvalidateCache()
  const pendingSelectedSession =
    pendingSelectedSessionRef.current?.id === activeSessionId ? pendingSelectedSessionRef.current : null
  const {
    session: activeSession,
    isLoading: isActiveSessionLoading,
    sessionSource: activeSessionSource
  } = useActiveSession({
    activeSessionId,
    setActiveSessionId,
    pendingSession: pendingSelectedSession
  })
  const lastVisibleSessionRef = useRef<AgentSessionEntity | null>(null)
  const visibleSession = isMessageOnlyView
    ? routeSession
    : (activeSession ?? (isActiveSessionLoading ? lastVisibleSessionRef.current : null))
  const visibleDraftSession = !isMessageOnlyView && !activeSessionId ? draftSession : null
  const setDraftSessionState = useCallback((nextDraft: DraftAgentSession | null) => {
    draftSessionRef.current = nextDraft
    setDraftSession(nextDraft)
  }, [])

  // All non-dormant tabs mount at once (Activity keep-alive), so each agent tab runs its
  // own AgentPage. `useIsActiveTab` answers "am I the globally-focused tab" (gates last_used).
  const isActiveTab = useIsActiveTab()
  const currentTabId = useCurrentTabId()
  const conversationNav = useConversationNavigation('agents')

  const clearSessionRevealRequestAfterPaint = useCallback((requestId: number) => {
    const clear = () => {
      setSessionRevealRequest((current) => (current?.requestId === requestId ? undefined : current))
    }

    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(clear)
      return
    }

    window.setTimeout(clear, 0)
  }, [])

  const revealActiveSessionInResourceList = useEffectEvent(() => {
    if (isMessageOnlyView || !activeSessionId) return
    const requestId = sessionRevealRequestIdRef.current + 1
    sessionRevealRequestIdRef.current = requestId
    setSessionRevealRequest({
      itemId: activeSessionId,
      requestId
    })
    clearSessionRevealRequestAfterPaint(requestId)
  })

  useEffect(() => {
    const unsubscribe = EventEmitter.on(EVENT_NAMES.REVEAL_ACTIVE_RESOURCE_LIST, (payload) => {
      const { source, tabId } = payload as ResourceListRevealPayload
      if (source !== 'agents' || tabId !== currentTabId) return
      revealActiveSessionInResourceList()
    })

    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `useEffectEvent` reads the latest session without resubscribing.
  }, [currentTabId])
  // Label this tab with its agent emoji + session name so multiple agent tabs
  // are distinguishable (every tab labels itself — not gated on active).
  const { agent: visibleAgent } = useAgent(visibleSession?.agentId ?? null)
  // Unpersisted draft sessions do not have a stable instance key.
  const isDraftView = !isMessageOnlyView && !activeSessionId && !!visibleDraftSession
  const tabInstanceSessionId =
    !isMessageOnlyView && !isDraftView ? (visibleSession?.id ?? routeActiveSessionId ?? undefined) : undefined
  useTabSelfMetadata({
    title: visibleSession?.name?.trim() || visibleAgent?.name?.trim() || getDefaultRouteTitle('/app/agents'),
    emoji: visibleAgent?.configuration?.avatar,
    instanceAppId: 'agents',
    instanceKey: tabInstanceSessionId ?? null
  })

  const setResourceListOpen = useCallback(
    (open: boolean) => {
      void setShowSidebar(open)
    },
    [setShowSidebar]
  )
  const toggleResourceListOpen = useCallback(() => {
    setResourceListOpen(!effectiveShowSidebar)
  }, [effectiveShowSidebar, setResourceListOpen])
  useCommandHandler(
    'app.sidebar.toggle',
    () => {
      if (isMessageOnlyView || isWindowFrame) return

      toggleResourceListOpen()
    },
    { enabled: isActiveTab }
  )

  useEffect(() => {
    if (activeSession) lastVisibleSessionRef.current = activeSession
  }, [activeSession])

  useEffect(() => {
    if (activeSessionSource === 'query' && pendingSelectedSessionRef.current?.id === activeSession?.id) {
      pendingSelectedSessionRef.current = null
    }
  }, [activeSession?.id, activeSessionSource])

  useEffect(() => {
    // Track "last focused session" only for persisted sessions — draft views have
    // no stable session id to restore on the next sidebar click. Gated on
    // the active tab: `last_used` is a single global "what I'm looking at now",
    // so background tabs must not clobber it and switching tabs must update it.
    if (!isActiveTab) return
    if (activeSession?.id && activeSessionSource === 'query') {
      setLastUsedSessionId(activeSession.id)
    }
  }, [isActiveTab, activeSession, activeSessionSource, setLastUsedSessionId])

  useEffect(() => {
    void window.api.window.setMinimumSize(SECOND_MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
    return () => {
      void window.api.window.resetMinimumSize()
    }
  }, [])

  const buildDraftSession = useCallback(
    async ({
      agentId,
      workspaceSource
    }: {
      agentId: string
      workspaceSource: AgentSessionWorkspaceSource
    }): Promise<DraftAgentSession> => {
      const workspace =
        workspaceSource.type === AGENT_WORKSPACE_TYPE.USER
          ? await dataApiService.get(`/agent-workspaces/${workspaceSource.workspaceId}`)
          : {
              type: AGENT_WORKSPACE_TYPE.SYSTEM,
              name: t('agent.session.workspace_selector.no_project'),
              path: ''
            }

      return {
        agentId,
        workspaceSource,
        workspace
      }
    },
    [t]
  )

  const startDraftSession = useCallback(
    async (defaults: DraftAgentSessionDefaults) => {
      const isSystemWorkspaceMode =
        defaults.workspace?.type === AGENT_WORKSPACE_TYPE.SYSTEM || defaults.workspaceMode === 'system'
      const rememberedWorkspaceId =
        defaults.workspace?.type === AGENT_WORKSPACE_TYPE.USER
          ? defaults.workspace.workspaceId
          : isSystemWorkspaceMode
            ? undefined
            : (defaults.workspaceId ?? lastUsedWorkspaceId ?? undefined)
      const workspaceSource: AgentSessionWorkspaceSource = isSystemWorkspaceMode
        ? { type: AGENT_WORKSPACE_TYPE.SYSTEM }
        : rememberedWorkspaceId
          ? { type: AGENT_WORKSPACE_TYPE.USER, workspaceId: rememberedWorkspaceId }
          : { type: AGENT_WORKSPACE_TYPE.SYSTEM }

      if (
        visibleDraftSession &&
        defaults.agentId === visibleDraftSession.agentId &&
        workspaceSource.type === visibleDraftSession.workspaceSource.type &&
        (workspaceSource.type === AGENT_WORKSPACE_TYPE.SYSTEM ||
          (visibleDraftSession.workspaceSource.type === AGENT_WORKSPACE_TYPE.USER &&
            workspaceSource.workspaceId === visibleDraftSession.workspaceSource.workspaceId))
      ) {
        if (visibleDraftSession.workspaceSource.type === AGENT_WORKSPACE_TYPE.USER) {
          setLastUsedWorkspaceId(visibleDraftSession.workspaceSource.workspaceId)
        }
        pendingSelectedSessionRef.current = null
        setActiveSessionId(null)
        return
      }

      if (!defaults.agentId) return

      let started: DraftAgentSession
      try {
        started = await buildDraftSession({
          agentId: defaults.agentId,
          workspaceSource
        })
      } catch (err) {
        if (!rememberedWorkspaceId || defaults.workspaceId || defaults.workspace?.type === AGENT_WORKSPACE_TYPE.USER) {
          throw err
        }

        logger.warn('Failed to start draft session with remembered workspace', err as Error, {
          workspaceId: rememberedWorkspaceId
        })
        setLastUsedWorkspaceId(null)
        started = await buildDraftSession({
          agentId: defaults.agentId,
          workspaceSource: { type: AGENT_WORKSPACE_TYPE.SYSTEM }
        })
      }
      pendingSelectedSessionRef.current = null
      setDraftSessionState(started)
      setLastUsedAgentId(started.agentId)
      if (started.workspaceSource.type === AGENT_WORKSPACE_TYPE.USER) {
        setLastUsedWorkspaceId(started.workspaceSource.workspaceId)
      }
      setMissingAgentDraft(false)
      setActiveSessionId(null)
    },
    [
      buildDraftSession,
      lastUsedWorkspaceId,
      setActiveSessionId,
      setDraftSessionState,
      setLastUsedAgentId,
      setLastUsedWorkspaceId,
      visibleDraftSession
    ]
  )

  const startMissingAgentDraft = useCallback(() => {
    setPendingLocateMessageId(undefined)
    pendingSelectedSessionRef.current = null
    setDraftSessionState(null)
    setActiveSessionId(null)
    setMissingAgentDraft(true)
  }, [setActiveSessionId, setDraftSessionState])

  const startMissingAgentDraftSession = useCallback(
    async (agentId: string | null) => {
      if (!agentId) return
      await startDraftSession({ agentId })
    },
    [startDraftSession]
  )

  const startDefaultDraftSession = useCallback(async () => {
    setPendingLocateMessageId(undefined)
    pendingSelectedSessionRef.current = null

    if (!agents.length) {
      setDraftSessionState(null)
      setActiveSessionId(null)
      setMissingAgentDraft(true)
      return
    }

    const rememberedAgent = lastUsedAgentId ? agents.find((agent) => agent.id === lastUsedAgentId) : undefined
    const defaultAgent = rememberedAgent ?? agents[0]
    await startDraftSession({ agentId: defaultAgent.id })
  }, [agents, lastUsedAgentId, setActiveSessionId, setDraftSessionState, startDraftSession])

  const handleHistorySessionSelect = useCallback(
    (sessionId: string | null, messageId?: string) => {
      if (sessionId && conversationNav.focusExistingTab(sessionId, { excludeTabId: currentTabId ?? undefined })) return
      pendingSelectedSessionRef.current = null
      setResourceListOpen(true)
      setDraftSessionState(null)
      setMissingAgentDraft(false)
      setPendingLocateMessageId(messageId)

      if (!sessionId) {
        void startDefaultDraftSession()
        return
      }

      setActiveSessionId(sessionId)
      sessionRevealRequestIdRef.current += 1
      setSessionRevealRequest({
        clearFilters: true,
        clearQuery: true,
        itemId: sessionId,
        requestId: sessionRevealRequestIdRef.current
      })
    },
    [conversationNav, currentTabId, setDraftSessionState, setResourceListOpen, startDefaultDraftSession]
  )
  const closeHistoryRecords = useCallback(() => {
    setHistoryRecordsOpen(false)
  }, [])
  const openHistoryRecords = useCallback(() => {
    setHistoryRecordsOpen(true)
  }, [])
  const handleHistoryRecordsSessionSelect = useCallback(
    (sessionId: string | null) => {
      closeHistoryRecords()
      handleHistorySessionSelect(sessionId)
    },
    [closeHistoryRecords, handleHistorySessionSelect]
  )
  const handleGlobalSearchSessionSelect = useEffectEvent((sessionId: string, messageId?: string) => {
    handleHistorySessionSelect(sessionId, messageId)
  })

  useEffect(() => {
    const unsubscribeSession = EventEmitter.on(EVENT_NAMES.GLOBAL_SEARCH_SELECT_AGENT_SESSION, (sessionId) => {
      handleGlobalSearchSessionSelect(sessionId as string)
    })
    const unsubscribeMessage = EventEmitter.on(EVENT_NAMES.GLOBAL_SEARCH_SELECT_AGENT_SESSION_MESSAGE, (payload) => {
      const { messageId, sessionId } = payload as { messageId?: string; sessionId?: string }
      if (!sessionId || !messageId) return

      handleGlobalSearchSessionSelect(sessionId, messageId)
    })

    return () => {
      unsubscribeSession()
      unsubscribeMessage()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `useEffectEvent` reads latest tab/session state without resubscribing.
  }, [])

  useEffect(() => {
    if (initialDraftSessionEvaluatedRef.current) {
      return
    }

    if (isMessageOnlyView) {
      initialDraftSessionEvaluatedRef.current = true
      return
    }

    if (isAgentsLoading) return

    if (!agents.length) {
      initialDraftSessionEvaluatedRef.current = true
      if (activeSessionId) {
        setActiveSessionId(null)
      }
      setMissingAgentDraft(true)
      return
    }

    if (missingAgentDraft || activeSessionId || visibleDraftSession) {
      initialDraftSessionEvaluatedRef.current = true
      return
    }

    const rememberedAgent = lastUsedAgentId ? agents?.find((agent) => agent.id === lastUsedAgentId) : undefined
    const defaultAgent = rememberedAgent ?? agents?.[0]

    initialDraftSessionEvaluatedRef.current = true
    void startDraftSession({ agentId: defaultAgent.id })
  }, [
    activeSessionId,
    agents,
    isAgentsLoading,
    isMessageOnlyView,
    lastUsedAgentId,
    missingAgentDraft,
    setActiveSessionId,
    startDraftSession,
    visibleDraftSession
  ])

  const setActiveSessionAndDiscardDraft = useCallback(
    (sessionId: string | null, session?: AgentSessionEntity | null) => {
      pendingSelectedSessionRef.current = session ?? null
      if (sessionId) {
        setDraftSessionState(null)
      }

      setActiveSessionId(sessionId)
    },
    [setDraftSessionState]
  )

  const ensurePersistentSession = useCallback(
    async (initialName?: string) => {
      const current = draftSessionRef.current
      if (!current) {
        throw new Error('Draft session handoff failed: no active draft session')
      }

      const trimmed = initialName?.trim()
      const session = await dataApiService.post('/agent-sessions', {
        body: {
          agentId: current.agentId,
          name: trimmed ? trimmed.slice(0, 30) : t('common.unnamed'),
          workspace: current.workspaceSource
        }
      })
      const persisted: PersistentAgentSessionConversation = {
        agentId: session.agentId ?? current.agentId,
        name: session.name,
        session,
        sessionId: session.id,
        topicId: buildAgentSessionTopicId(session.id)
      }
      pendingSelectedSessionRef.current = session
      setDraftSessionState(null)
      setLastUsedAgentId(persisted.agentId)
      if (isUserWorkspaceSession(session)) {
        setLastUsedWorkspaceId(session.workspaceId)
      }
      setActiveSessionId(session.id)
      void invalidateCache(['/agent-sessions', '/agent-workspaces', `/agent-sessions/${session.id}`]).catch((err) => {
        logger.warn('Failed to refresh session metadata after draft session create', err as Error)
      })
      return persisted
    },
    [invalidateCache, setActiveSessionId, setDraftSessionState, setLastUsedAgentId, setLastUsedWorkspaceId, t]
  )
  const replaceDraftAgent = useCallback(
    async (agentId: string | null) => {
      const current = draftSessionRef.current
      if (!agentId || !current) return
      if (agentId === current.agentId || replacingDraftAgent) return

      setReplacingDraftAgent(true)
      try {
        const next = await buildDraftSession({
          agentId,
          workspaceSource: current.workspaceSource
        })
        pendingSelectedSessionRef.current = null
        setDraftSessionState(next)
        setLastUsedAgentId(agentId)
        setActiveSessionId(null)
      } catch (err) {
        window.toast.error(formatErrorMessageWithPrefix(err, t('agent.session.create.error.failed')))
      } finally {
        setReplacingDraftAgent(false)
      }
    },
    [buildDraftSession, replacingDraftAgent, setActiveSessionId, setDraftSessionState, setLastUsedAgentId, t]
  )
  const replaceDraftWorkspace = useCallback(
    async (workspaceId: string | null) => {
      const current = draftSessionRef.current
      if (!current) return
      const currentIsSystemWorkspace = current.workspaceSource.type === AGENT_WORKSPACE_TYPE.SYSTEM
      if (workspaceId === null && currentIsSystemWorkspace) return
      if (
        workspaceId &&
        current.workspaceSource.type === AGENT_WORKSPACE_TYPE.USER &&
        workspaceId === current.workspaceSource.workspaceId
      ) {
        setLastUsedWorkspaceId(workspaceId)
        return
      }
      if (replacingDraftWorkspace) return

      setReplacingDraftWorkspace(true)
      try {
        const workspaceSource: AgentSessionWorkspaceSource = workspaceId
          ? { type: AGENT_WORKSPACE_TYPE.USER, workspaceId }
          : { type: AGENT_WORKSPACE_TYPE.SYSTEM }
        const next = await buildDraftSession({
          agentId: current.agentId,
          workspaceSource
        })
        if (workspaceId) {
          setLastUsedWorkspaceId(workspaceId)
        }
        pendingSelectedSessionRef.current = null
        setDraftSessionState(next)
        setActiveSessionId(null)
      } catch (err) {
        logger.error('Failed to replace draft workspace', err as Error, { workspaceId })
        window.toast.error(formatErrorMessageWithPrefix(err, t('agent.session.create.error.failed')))
      } finally {
        setReplacingDraftWorkspace(false)
      }
    },
    [buildDraftSession, replacingDraftWorkspace, setActiveSessionId, setDraftSessionState, setLastUsedWorkspaceId, t]
  )
  const handleLocateMessageHandled = useCallback(() => {
    setPendingLocateMessageId(undefined)
  }, [])

  const panePosition = 'left'

  return (
    <Container>
      <div className="flex min-w-0 flex-1 shrink flex-row overflow-hidden">
        <AgentChat
          activeSession={visibleSession}
          activeSessionLoading={isActiveSessionLoading}
          activeSessionSource={activeSessionSource}
          pane={
            <AgentSidePanel
              activeSessionId={activeSessionId}
              revealRequest={sessionRevealRequest}
              onOpenHistoryRecords={openHistoryRecords}
              onStartDraftSession={startDraftSession}
              onStartMissingAgentDraft={isMessageOnlyView ? undefined : startMissingAgentDraft}
              setActiveSessionId={setActiveSessionAndDiscardDraft}
            />
          }
          lockedSession={isMessageOnlyView ? (routeSession ?? null) : undefined}
          lockedSessionLoading={isMessageOnlyView && isRouteSessionLoading}
          paneOpen={effectiveShowSidebar}
          panePosition={panePosition}
          onPaneCollapse={() => setResourceListOpen(false)}
          showResourceListControls={!isMessageOnlyView && !isWindowFrame}
          sidebarOpen={effectiveShowSidebar}
          onSidebarToggle={toggleResourceListOpen}
          draftConversation={isMessageOnlyView ? null : visibleDraftSession}
          missingAgentDraft={!isMessageOnlyView && missingAgentDraft && !visibleSession && !visibleDraftSession}
          onStartDraftSession={isMessageOnlyView ? undefined : startDraftSession}
          onMissingAgentDraftAgentChange={isMessageOnlyView ? undefined : startMissingAgentDraftSession}
          onEnsurePersistentSession={isMessageOnlyView ? undefined : ensurePersistentSession}
          onDraftAgentChange={isMessageOnlyView ? undefined : replaceDraftAgent}
          onDraftWorkspaceChange={isMessageOnlyView ? undefined : replaceDraftWorkspace}
          onVisibleAgentChange={isMessageOnlyView ? undefined : setLastUsedAgentId}
          onVisibleWorkspaceChange={isMessageOnlyView ? undefined : setLastUsedWorkspaceId}
          locateMessageId={pendingLocateMessageId}
          onLocateMessageHandled={handleLocateMessageHandled}
          replacingDraftAgent={replacingDraftAgent}
          replacingDraftWorkspace={replacingDraftWorkspace}
        />
      </div>
      <HistoryRecordsPage
        mode="agent"
        open={historyRecordsOpen && !isMessageOnlyView && !isWindowFrame}
        activeRecordId={activeSessionId}
        onClose={closeHistoryRecords}
        onRecordSelect={handleHistoryRecordsSessionSelect}
      />
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
