import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useCommandHandler } from '@renderer/commands'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resources'
import type { ResourceListRevealPayload } from '@renderer/components/chat/resources/resourceListRevealEvents'
import {
  createRecentSessionEntryFromSession,
  upsertGlobalSearchRecentEntry
} from '@renderer/components/GlobalSearch/globalSearchGroups'
import { getTabInstanceKey } from '@renderer/config/tabInstanceMetadata'
import { useCurrentTab, useCurrentTabId, useIsActiveTab, useTabSelfMetadata } from '@renderer/context/TabIdContext'
import { useWindowFrame } from '@renderer/context/WindowFrameContext'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import { useAgent, useAgents } from '@renderer/hooks/agents/useAgent'
import { useActiveSession, useSession } from '@renderer/hooks/agents/useSession'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { type TemporaryConversationDefaults, useTemporaryConversation } from '@renderer/hooks/useTemporaryConversation'
import HistoryRecordsPage from '@renderer/pages/history/HistoryRecordsPage'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { cn } from '@renderer/utils'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { MIN_WINDOW_HEIGHT, SECOND_MIN_WINDOW_WIDTH } from '@shared/config/constant'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import { useSearch } from '@tanstack/react-router'
import type { PropsWithChildren } from 'react'
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AgentChat from './AgentChat'
import AgentSidePanel from './AgentSidePanel'
import { parseAgentRouteSearch } from './routeSearch'

const logger = loggerService.withContext('AgentPage')

function getSessionWorkspaceDefaults(
  session: AgentSessionEntity | null | undefined
): Pick<TemporaryConversationDefaults, 'workspaceId' | 'workspaceMode'> {
  if (session?.workspace?.type === 'system') {
    return { workspaceMode: 'system' }
  }
  return session?.workspaceId ? { workspaceId: session.workspaceId } : {}
}

function isUserWorkspaceSession(session: AgentSessionEntity | null | undefined): boolean {
  return !!session?.workspaceId && session.workspace?.type !== 'system'
}

const AgentPage = () => {
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyOrigin, setHistoryOrigin] = useState<DOMRectReadOnly>()
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const routeSearch = parseAgentRouteSearch(useSearch({ strict: false }) as Record<string, unknown>)
  const currentTab = useCurrentTab()
  const routeSessionId = routeSearch.sessionId
  const tabMetadataSessionId = currentTab ? getTabInstanceKey(currentTab, 'agents') : undefined
  const isMessageOnlyView = routeSearch.view === 'message' && !!routeSessionId
  const isWindowFrame = useWindowFrame().mode === 'window'
  const [windowSidebarOpen, setWindowSidebarOpen] = useState(false)
  const effectiveShowSidebar = !isMessageOnlyView && (isWindowFrame ? windowSidebarOpen : showSidebar)
  const { session: routeSession, isLoading: isRouteSessionLoading } = useSession(
    isMessageOnlyView ? routeSessionId : null
  )
  const { agents, isLoading: isAgentsLoading } = useAgents()
  const routeActiveSessionId = isMessageOnlyView ? null : (routeSessionId ?? tabMetadataSessionId ?? null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => routeActiveSessionId)
  const pendingSelectedSessionRef = useRef<AgentSessionEntity | null>(null)
  const [ignoredTemporarySessionId, setIgnoredTemporarySessionId] = useState<string | null>(null)

  useEffect(() => {
    pendingSelectedSessionRef.current = null
    setIgnoredTemporarySessionId(null)
    setActiveSessionId(routeActiveSessionId)
  }, [routeActiveSessionId])
  const [, setLastUsedSessionId] = usePersistCache('ui.agent.last_used_session_id')
  const [lastUsedAgentId, setLastUsedAgentId] = usePersistCache('ui.agent.last_used_agent_id')
  const [lastUsedWorkspaceId, setLastUsedWorkspaceId] = usePersistCache('ui.agent.last_used_workspace_id')
  const [recentItems, setRecentItems] = usePersistCache('ui.global_search.recent_items')
  const lastRecordedRecentSessionRef = useRef<string | undefined>(undefined)
  const [sessionRevealRequest, setSessionRevealRequest] = useState<ResourceListRevealRequest>()
  const [pendingLocateMessageId, setPendingLocateMessageId] = useState<string | undefined>()
  const sessionRevealRequestIdRef = useRef(0)
  const initialTemporarySessionEvaluatedRef = useRef(false)
  const [replacingTemporaryAgent, setReplacingTemporaryAgent] = useState(false)
  const [replacingTemporaryWorkspace, setReplacingTemporaryWorkspace] = useState(false)
  const [missingAgentDraft, setMissingAgentDraft] = useState(false)
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
  const pendingPersistedSession =
    persistedConversation?.type === 'agent' && activeSessionId === persistedConversation.sessionId
      ? persistedConversation.session
      : null
  const pendingSelectedSession =
    pendingSelectedSessionRef.current?.id === activeSessionId ? pendingSelectedSessionRef.current : null
  const pendingSession = pendingPersistedSession ?? pendingSelectedSession
  const {
    session: activeSession,
    isLoading: isActiveSessionLoading,
    sessionSource: activeSessionSource
  } = useActiveSession({
    activeSessionId,
    setActiveSessionId,
    pendingSession
  })
  const lastVisibleSessionRef = useRef<AgentSessionEntity | null>(null)
  const visibleSession = isMessageOnlyView
    ? routeSession
    : (activeSession ?? (isActiveSessionLoading ? lastVisibleSessionRef.current : null))
  const visibleTemporaryAgentConversation =
    temporaryAgentConversation?.type === 'agent' && temporaryAgentConversation.sessionId !== ignoredTemporarySessionId
      ? temporaryAgentConversation
      : null

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
  // Unpersisted temp sessions do not have a stable instance key.
  const isTemporaryView = !isMessageOnlyView && !activeSessionId && visibleTemporaryAgentConversation?.type === 'agent'
  const tabInstanceSessionId =
    !isMessageOnlyView && !isTemporaryView ? (visibleSession?.id ?? routeActiveSessionId ?? undefined) : undefined
  useTabSelfMetadata({
    title: visibleSession?.name?.trim() || visibleAgent?.name?.trim() || getDefaultRouteTitle('/app/agents'),
    emoji: visibleAgent?.configuration?.avatar,
    instanceAppId: 'agents',
    instanceKey: tabInstanceSessionId ?? null
  })

  const setResourceListOpen = useCallback(
    (open: boolean) => {
      if (isWindowFrame) {
        setWindowSidebarOpen(open)
        return
      }

      void setShowSidebar(open)
    },
    [isWindowFrame, setShowSidebar]
  )
  const toggleResourceListOpen = useCallback(() => {
    setResourceListOpen(!effectiveShowSidebar)
  }, [effectiveShowSidebar, setResourceListOpen])
  useCommandHandler(
    'app.sidebar.toggle',
    () => {
      if (isMessageOnlyView) return

      toggleResourceListOpen()
    },
    { enabled: isActiveTab }
  )

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
    if (activeSession) lastVisibleSessionRef.current = activeSession
  }, [activeSession])

  useEffect(() => {
    if (activeSessionSource === 'query' && pendingSelectedSessionRef.current?.id === activeSession?.id) {
      pendingSelectedSessionRef.current = null
    }
  }, [activeSession?.id, activeSessionSource])

  useEffect(() => {
    // Track "last focused session" only for persisted sessions — temp ids are
    // ephemeral and would point to nothing on the next sidebar click. Gated on
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

  const openHistory = useCallback((origin?: DOMRectReadOnly) => {
    setHistoryOrigin(origin)
    setHistoryOpen(true)
  }, [])
  const closeHistory = useCallback(() => setHistoryOpen(false), [])
  const handleHistorySessionSelect = useCallback(
    (sessionId: string | null, messageId?: string) => {
      if (sessionId && conversationNav.focusExistingTab(sessionId, { excludeTabId: currentTabId ?? undefined })) return
      pendingSelectedSessionRef.current = null
      setResourceListOpen(true)
      void discardTemporaryConversation()
      setMissingAgentDraft(false)
      setPendingLocateMessageId(messageId)
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
    [conversationNav, currentTabId, discardTemporaryConversation, setResourceListOpen]
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

  const startTemporarySession = useCallback(
    async (defaults: TemporaryConversationDefaults) => {
      const isSystemWorkspaceMode = defaults.workspaceMode === 'system'
      const rememberedWorkspaceId = isSystemWorkspaceMode
        ? undefined
        : (defaults.workspaceId ?? lastUsedWorkspaceId ?? undefined)
      if (
        !isSystemWorkspaceMode &&
        visibleTemporaryAgentConversation?.type === 'agent' &&
        defaults.agentId === visibleTemporaryAgentConversation.agentId &&
        (rememberedWorkspaceId ?? null) === (visibleTemporaryAgentConversation.session.workspaceId ?? null)
      ) {
        if (isUserWorkspaceSession(visibleTemporaryAgentConversation.session)) {
          setLastUsedWorkspaceId(visibleTemporaryAgentConversation.session.workspaceId)
        }
        pendingSelectedSessionRef.current = null
        setIgnoredTemporarySessionId(null)
        setActiveSessionId(null)
        return
      }

      const startDefaults = {
        agentId: defaults.agentId,
        ...(isSystemWorkspaceMode ? { workspaceMode: 'system' as const } : {}),
        ...(!isSystemWorkspaceMode && rememberedWorkspaceId ? { workspaceId: rememberedWorkspaceId } : {}),
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
        pendingSelectedSessionRef.current = null
        setIgnoredTemporarySessionId(null)
        setLastUsedAgentId(started.agentId)
        if (isUserWorkspaceSession(started.session)) {
          setLastUsedWorkspaceId(started.session.workspaceId)
        }
      }
      setMissingAgentDraft(false)
      setActiveSessionId(null)
    },
    [
      lastUsedWorkspaceId,
      setActiveSessionId,
      setLastUsedAgentId,
      setLastUsedWorkspaceId,
      startTemporaryConversation,
      t,
      visibleTemporaryAgentConversation
    ]
  )

  const startMissingAgentDraft = useCallback(() => {
    setPendingLocateMessageId(undefined)
    pendingSelectedSessionRef.current = null
    setIgnoredTemporarySessionId(null)
    void discardTemporaryConversation()
    setActiveSessionId(null)
    setMissingAgentDraft(true)
  }, [discardTemporaryConversation, setActiveSessionId])

  const startMissingAgentDraftSession = useCallback(
    async (agentId: string | null) => {
      if (!agentId) return
      await startTemporarySession({ agentId })
    },
    [startTemporarySession]
  )

  useEffect(() => {
    if (initialTemporarySessionEvaluatedRef.current) {
      return
    }

    if (isMessageOnlyView) {
      initialTemporarySessionEvaluatedRef.current = true
      return
    }

    if (isAgentsLoading) return

    if (!agents.length) {
      initialTemporarySessionEvaluatedRef.current = true
      if (activeSessionId) {
        setActiveSessionId(null)
      }
      setMissingAgentDraft(true)
      return
    }

    if (missingAgentDraft || activeSessionId || visibleTemporaryAgentConversation) {
      initialTemporarySessionEvaluatedRef.current = true
      return
    }

    const rememberedAgent = lastUsedAgentId ? agents?.find((agent) => agent.id === lastUsedAgentId) : undefined
    const defaultAgent = rememberedAgent ?? agents?.[0]

    initialTemporarySessionEvaluatedRef.current = true
    void startTemporarySession({ agentId: defaultAgent.id })
  }, [
    activeSessionId,
    agents,
    isAgentsLoading,
    isMessageOnlyView,
    lastUsedAgentId,
    missingAgentDraft,
    setActiveSessionId,
    startTemporarySession,
    visibleTemporaryAgentConversation
  ])

  const setActiveSessionAndDiscardTemporary = useCallback(
    (sessionId: string | null, session?: AgentSessionEntity | null) => {
      pendingSelectedSessionRef.current = session ?? null

      const currentTemporarySessionId = visibleTemporaryAgentConversation?.sessionId
      if (currentTemporarySessionId && sessionId && currentTemporarySessionId !== sessionId) {
        setIgnoredTemporarySessionId(currentTemporarySessionId)
        void discardTemporaryConversation()
      }

      setActiveSessionId(sessionId)
    },
    [discardTemporaryConversation, visibleTemporaryAgentConversation]
  )

  const persistTemporarySession = useCallback(
    async (initialName?: string) => {
      const persisted = await persistTemporaryConversation(initialName)
      if (persisted?.type === 'agent') {
        pendingSelectedSessionRef.current = null
        setIgnoredTemporarySessionId(null)
        setLastUsedAgentId(persisted.agentId)
        if (isUserWorkspaceSession(persisted.session)) {
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

      setReplacingTemporaryAgent(true)
      try {
        await replaceTemporaryConversation({
          agentId,
          ...getSessionWorkspaceDefaults(temporaryAgentConversation.session),
          name: temporaryAgentConversation.name ?? t('common.unnamed')
        })
        pendingSelectedSessionRef.current = null
        setIgnoredTemporarySessionId(null)
        setLastUsedAgentId(agentId)
        setActiveSessionId(null)
      } catch (err) {
        window.toast.error(formatErrorMessageWithPrefix(err, t('agent.session.create.error.failed')))
      } finally {
        setReplacingTemporaryAgent(false)
      }
    },
    [
      replaceTemporaryConversation,
      replacingTemporaryAgent,
      setActiveSessionId,
      setLastUsedAgentId,
      t,
      temporaryAgentConversation
    ]
  )
  const replaceTemporaryWorkspace = useCallback(
    async (workspaceId: string | null) => {
      if (temporaryAgentConversation?.type !== 'agent') return
      const currentIsSystemWorkspace = temporaryAgentConversation.session.workspace?.type === 'system'
      if (workspaceId === null && currentIsSystemWorkspace) return
      if (workspaceId && workspaceId === temporaryAgentConversation.session.workspaceId) {
        setLastUsedWorkspaceId(workspaceId)
        return
      }
      if (replacingTemporaryWorkspace) return

      setReplacingTemporaryWorkspace(true)
      try {
        await replaceTemporaryConversation({
          agentId: temporaryAgentConversation.agentId,
          ...(workspaceId ? { workspaceId } : { workspaceMode: 'system' as const }),
          name: temporaryAgentConversation.name ?? t('common.unnamed')
        })
        if (workspaceId) {
          setLastUsedWorkspaceId(workspaceId)
        }
        pendingSelectedSessionRef.current = null
        setIgnoredTemporarySessionId(null)
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
              onOpenHistory={openHistory}
              revealRequest={sessionRevealRequest}
              onStartTemporarySession={startTemporarySession}
              onStartMissingAgentDraft={isMessageOnlyView ? undefined : startMissingAgentDraft}
              setActiveSessionId={setActiveSessionAndDiscardTemporary}
            />
          }
          lockedSession={isMessageOnlyView ? (routeSession ?? null) : undefined}
          lockedSessionLoading={isMessageOnlyView && isRouteSessionLoading}
          paneOpen={effectiveShowSidebar}
          panePosition={panePosition}
          onPaneCollapse={() => setResourceListOpen(false)}
          showResourceListControls={!isMessageOnlyView}
          sidebarOpen={effectiveShowSidebar}
          onSidebarToggle={toggleResourceListOpen}
          temporaryConversation={isMessageOnlyView ? null : visibleTemporaryAgentConversation}
          missingAgentDraft={
            !isMessageOnlyView &&
            missingAgentDraft &&
            !visibleSession &&
            visibleTemporaryAgentConversation?.type !== 'agent'
          }
          onStartTemporarySession={isMessageOnlyView ? undefined : startTemporarySession}
          onMissingAgentDraftAgentChange={isMessageOnlyView ? undefined : startMissingAgentDraftSession}
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
