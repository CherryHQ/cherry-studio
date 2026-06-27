import { dataApiService } from '@data/DataApiService'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import type { ResourcePaneConfig, ResourcePaneCountButtonProps } from '@renderer/components/chat/panes/Shell'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resources'
import type { ResourceListRevealPayload } from '@renderer/components/chat/resources/resourceListRevealEvents'
import { AgentResourceList } from '@renderer/components/chat/resources/variants/AgentResourceList'
import { useWindowFrame } from '@renderer/components/chat/shell/WindowFrameContext'
import {
  createRecentSessionEntryFromSession,
  upsertGlobalSearchRecentEntry
} from '@renderer/components/GlobalSearch/globalSearchGroups'
import { getTabInstanceKey } from '@renderer/config/tabInstanceMetadata'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import { useAgent, useAgents } from '@renderer/hooks/agents/useAgent'
import { useActiveSession, useSession } from '@renderer/hooks/agents/useSession'
import { useCommandHandler } from '@renderer/hooks/command'
import { useAgentSessionsSource } from '@renderer/hooks/resourceViewSources'
import { useCurrentTab, useCurrentTabId, useIsActiveTab, useTabSelfMetadata } from '@renderer/hooks/tab'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { cn } from '@renderer/utils/style'
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
import { AgentConversationPickerDialog } from './components/AgentConversationPickerDialog'
import Sessions from './components/Sessions'
import { parseAgentRouteSearch } from './routeSearch'
import type { DraftAgentSession, DraftAgentSessionDefaults, PersistentAgentSessionConversation } from './types'

const logger = loggerService.withContext('AgentPage')

function isUserWorkspaceSession(session: AgentSessionEntity | null | undefined): boolean {
  return !!session?.workspaceId && session.workspace?.type !== 'system'
}

function findLatestUpdatedSession<T extends { updatedAt?: string }>(sessions: readonly T[]): T | undefined {
  let latestSession: T | undefined
  let latestUpdatedAtMs = Number.NEGATIVE_INFINITY

  for (const session of sessions) {
    const parsedUpdatedAtMs = session.updatedAt ? Date.parse(session.updatedAt) : Number.NEGATIVE_INFINITY
    const updatedAtMs = Number.isFinite(parsedUpdatedAtMs) ? parsedUpdatedAtMs : Number.NEGATIVE_INFINITY
    if (!latestSession || updatedAtMs > latestUpdatedAtMs) {
      latestSession = session
      latestUpdatedAtMs = updatedAtMs
    }
  }

  return latestSession
}

const AgentPage = () => {
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const [workView] = usePreference('chat.work_view')
  const isOldView = workView === 'old'
  // Old view shares this full-sessions source with the rail; new view leaves it disabled (no fetch).
  // The picker uses it to reuse an empty placeholder session instead of stacking new ones.
  const {
    sessions: oldViewSessions,
    isLoadingAll: isOldViewSessionsLoading = false,
    isFullyLoaded: isOldViewSessionsFullyLoaded = true
  } = useAgentSessionsSource({ enabled: isOldView })
  const isOldViewSessionHistoryReady = !isOldView || (!isOldViewSessionsLoading && isOldViewSessionsFullyLoaded)
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
  // Old-view (rail) work-pane open state, owned here so it survives the AgentChat draft→persistent
  // remount (each branch mounts its own Shell). Mirrors Home, which keeps one page-level pane open
  // across the handoff. Scoped to old view below so new (sidebar) view behavior is unchanged.
  const [workPaneOpen, setWorkPaneOpen] = useState(false)

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
  const [recentItems, setRecentItems] = usePersistCache('ui.global_search.recent_items')
  const lastRecordedRecentSessionRef = useRef<string | undefined>(undefined)
  const [sessionRevealRequest, setSessionRevealRequest] = useState<ResourceListRevealRequest>()
  const [pendingLocateMessageId, setPendingLocateMessageId] = useState<string | undefined>()
  const sessionRevealRequestIdRef = useRef(0)
  const initialDraftSessionEvaluatedRef = useRef(false)
  const [replacingDraftAgent, setReplacingDraftAgent] = useState(false)
  const [replacingDraftWorkspace, setReplacingDraftWorkspace] = useState(false)
  const [missingAgentDraft, setMissingAgentDraft] = useState(false)
  const [agentPickerOpen, setAgentPickerOpen] = useState(false)
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
    if (isMessageOnlyView) return
    if (!activeSession) return

    const signature = `${activeSession.id}:${activeSession.name}`
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

  const resolveDraftWorkspaceSource = useCallback(
    (defaults: DraftAgentSessionDefaults) => {
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

      return { rememberedWorkspaceId, workspaceSource }
    },
    [lastUsedWorkspaceId]
  )

  const buildDraftSessionWithFallback = useCallback(
    async (
      defaults: DraftAgentSessionDefaults,
      workspaceSource: AgentSessionWorkspaceSource,
      rememberedWorkspaceId?: string
    ) => {
      if (!defaults.agentId) return null

      try {
        return await buildDraftSession({
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
        return buildDraftSession({
          agentId: defaults.agentId,
          workspaceSource: { type: AGENT_WORKSPACE_TYPE.SYSTEM }
        })
      }
    },
    [buildDraftSession, setLastUsedWorkspaceId]
  )

  const rememberLastUsedSession = useCallback(
    (agentId: string, userWorkspaceId?: string) => {
      setLastUsedAgentId(agentId)
      if (userWorkspaceId) setLastUsedWorkspaceId(userWorkspaceId)
    },
    [setLastUsedAgentId, setLastUsedWorkspaceId]
  )

  const startDraftSession = useCallback(
    async (defaults: DraftAgentSessionDefaults) => {
      const { rememberedWorkspaceId, workspaceSource } = resolveDraftWorkspaceSource(defaults)

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

      const started = await buildDraftSessionWithFallback(defaults, workspaceSource, rememberedWorkspaceId)
      if (!started) return

      pendingSelectedSessionRef.current = null
      setDraftSessionState(started)
      rememberLastUsedSession(
        started.agentId,
        started.workspaceSource.type === AGENT_WORKSPACE_TYPE.USER ? started.workspaceSource.workspaceId : undefined
      )
      setMissingAgentDraft(false)
      setActiveSessionId(null)
    },
    [
      buildDraftSessionWithFallback,
      rememberLastUsedSession,
      resolveDraftWorkspaceSource,
      setActiveSessionId,
      setDraftSessionState,
      setLastUsedWorkspaceId,
      visibleDraftSession
    ]
  )

  const handleAgentConversationSelect = useCallback(
    async (agentId: string) => {
      // Close the picker first so the session/state churn below doesn't refresh the dialog while it's
      // still visible (which reads as a black/white flash + the dialog reopening).
      setAgentPickerOpen(false)
      try {
        // The empty session only exists to surface the agent in the old-view rail. To avoid stacking
        // another empty one on repeated adds, reuse the agent's latest session when it is still an
        // unused placeholder.
        //
        // Tradeoff: the list API exposes no message count / "has messages" flag, so "unused" is
        // approximated by the default unnamed name (a session is renamed once it gets content). A
        // still-unnamed session with messages would also be treated as reusable — acceptable, since
        // reuse just reopens it (no data loss, no duplicate). A precise check would need a backend
        // `messageCount` on the session list; swap the name test for it if that lands.
        let latestSession: (typeof oldViewSessions)[number] | undefined
        for (const candidate of oldViewSessions) {
          if (candidate.agentId !== agentId) continue
          if (!latestSession || Date.parse(candidate.updatedAt) > Date.parse(latestSession.updatedAt)) {
            latestSession = candidate
          }
        }
        const reusableSession =
          latestSession && latestSession.name.trim() === t('common.unnamed') ? latestSession : undefined

        let session = reusableSession
        if (!session) {
          const defaults = { agentId }
          const { rememberedWorkspaceId, workspaceSource } = resolveDraftWorkspaceSource(defaults)
          const started = await buildDraftSessionWithFallback(defaults, workspaceSource, rememberedWorkspaceId)
          if (!started) return

          session = await dataApiService.post('/agent-sessions', {
            body: {
              agentId: started.agentId,
              name: t('common.unnamed'),
              workspace: started.workspaceSource
            }
          })
        }

        setPendingLocateMessageId(undefined)
        pendingSelectedSessionRef.current = session
        setDraftSessionState(null)
        setMissingAgentDraft(false)
        rememberLastUsedSession(
          session.agentId ?? agentId,
          isUserWorkspaceSession(session) ? session.workspaceId : undefined
        )
        setActiveSessionId(session.id)
        if (!reusableSession) {
          void invalidateCache(['/agent-sessions', '/agent-workspaces', `/agent-sessions/${session.id}`]).catch(
            (err) => {
              logger.warn('Failed to refresh session metadata after agent picker session create', err as Error)
            }
          )
        }
      } catch (err) {
        logger.error('Failed to create agent session from old-view picker', err as Error, { agentId })
        window.toast.error(formatErrorMessageWithPrefix(err, t('agent.session.create.error.failed')))
      }
    },
    [
      buildDraftSessionWithFallback,
      invalidateCache,
      oldViewSessions,
      rememberLastUsedSession,
      resolveDraftWorkspaceSource,
      setActiveSessionId,
      setDraftSessionState,
      t
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
      // Locate (history / global search) should reveal the target in the right work pane. The per-branch
      // Shell re-seeds its open state from `workPaneOpen` on the next session remount; in new view this
      // flag is ignored and reset by the isOldView effect, so setting it unconditionally is safe.
      setWorkPaneOpen(true)
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

    if (missingAgentDraft || activeSessionId || visibleDraftSession) {
      initialDraftSessionEvaluatedRef.current = true
      return
    }

    if (isOldView) {
      if (!isOldViewSessionHistoryReady) return

      const latestSession = findLatestUpdatedSession(oldViewSessions)
      if (latestSession) {
        initialDraftSessionEvaluatedRef.current = true
        setPendingLocateMessageId(undefined)
        pendingSelectedSessionRef.current = latestSession
        setDraftSessionState(null)
        setMissingAgentDraft(false)
        setActiveSessionId(latestSession.id)
        return
      }
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

    const rememberedAgent = lastUsedAgentId ? agents?.find((agent) => agent.id === lastUsedAgentId) : undefined
    const defaultAgent = rememberedAgent ?? agents?.[0]

    initialDraftSessionEvaluatedRef.current = true
    void startDraftSession({ agentId: defaultAgent.id })
  }, [
    activeSessionId,
    agents,
    isAgentsLoading,
    isMessageOnlyView,
    isOldView,
    isOldViewSessionHistoryReady,
    lastUsedAgentId,
    missingAgentDraft,
    oldViewSessions,
    setActiveSessionId,
    setDraftSessionState,
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
  const handleResourceSessionSelect = useCallback(
    (sessionId: string, session: AgentSessionEntity) => {
      if (conversationNav.focusExistingTab(sessionId, { excludeTabId: currentTabId ?? undefined })) return
      setActiveSessionAndDiscardDraft(sessionId, session)
    },
    [conversationNav, currentTabId, setActiveSessionAndDiscardDraft]
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
  // Old view = entity rail + right session panel; new view = the classic sidebar (AgentSidePanel).
  useEffect(() => {
    if (!isOldView && workPaneOpen) {
      setWorkPaneOpen(false)
    }
  }, [isOldView, workPaneOpen])

  const activeResourceAgentId = visibleSession?.agentId ?? visibleDraftSession?.agentId ?? null
  const sessionResourcePaneCount: ResourcePaneCountButtonProps | undefined =
    isOldView && activeResourceAgentId
      ? {
          label: t('agent.session.list.title'),
          count: oldViewSessions.filter((session) => session.agentId === activeResourceAgentId).length
        }
      : undefined
  const createAndActivateEmptySession = useCallback(async () => {
    const agentId = activeResourceAgentId
    if (!agentId) return

    const workspaceSource: AgentSessionWorkspaceSource = visibleDraftSession
      ? visibleDraftSession.workspaceSource
      : visibleSession?.workspace?.type === AGENT_WORKSPACE_TYPE.SYSTEM
        ? { type: AGENT_WORKSPACE_TYPE.SYSTEM }
        : visibleSession?.workspaceId
          ? { type: AGENT_WORKSPACE_TYPE.USER, workspaceId: visibleSession.workspaceId }
          : { type: AGENT_WORKSPACE_TYPE.SYSTEM }

    try {
      const reusableSession = findLatestUpdatedSession(
        oldViewSessions.filter(
          (candidate) => candidate.agentId === agentId && candidate.name.trim() === t('common.unnamed')
        )
      )
      const session =
        reusableSession ??
        (await dataApiService.post('/agent-sessions', {
          body: {
            agentId,
            name: t('common.unnamed'),
            workspace: workspaceSource
          }
        }))

      setPendingLocateMessageId(undefined)
      pendingSelectedSessionRef.current = session
      setDraftSessionState(null)
      setMissingAgentDraft(false)
      rememberLastUsedSession(agentId, isUserWorkspaceSession(session) ? session.workspaceId : undefined)
      setActiveSessionId(session.id)
      if (!reusableSession) {
        void invalidateCache(['/agent-sessions', '/agent-workspaces', `/agent-sessions/${session.id}`]).catch((err) => {
          logger.warn('Failed to refresh session metadata after composer session create', err as Error)
        })
      }
    } catch (err) {
      logger.error('Failed to create empty agent session from old-view composer', err as Error, { agentId })
      window.toast.error(formatErrorMessageWithPrefix(err, t('agent.session.create.error.failed')))
    }
  }, [
    activeResourceAgentId,
    invalidateCache,
    oldViewSessions,
    rememberLastUsedSession,
    setActiveSessionId,
    setDraftSessionState,
    t,
    visibleDraftSession,
    visibleSession?.workspace?.type,
    visibleSession?.workspaceId
  ])
  const pane = isOldView ? (
    <AgentResourceList
      activeAgentId={activeResourceAgentId}
      onAddAgent={() => setAgentPickerOpen(true)}
      onOpenHistoryRecords={openHistoryRecords}
      onSelectSession={handleResourceSessionSelect}
      onStartDraftAgent={(agentId) => startDraftSession({ agentId })}
      onStartMissingAgentDraft={startMissingAgentDraft}
    />
  ) : (
    <AgentSidePanel
      activeSessionId={activeSessionId}
      revealRequest={sessionRevealRequest}
      onOpenHistoryRecords={openHistoryRecords}
      onStartDraftSession={startDraftSession}
      onStartMissingAgentDraft={isMessageOnlyView ? undefined : startMissingAgentDraft}
      setActiveSessionId={setActiveSessionAndDiscardDraft}
    />
  )
  // In old view the session list moves into the chat's right pane as a tab; AgentChat keeps the
  // pane provider per-branch (its Shell meta is bound to per-session runtime, unlike Home), so the
  // config is threaded into each branch rather than lifted to this page.
  const resourcePane: ResourcePaneConfig | null = isOldView
    ? {
        label: t('title.work'),
        node: (
          <Sessions
            presentation="right-panel"
            activeSessionId={activeSessionId}
            agentIdFilter={activeResourceAgentId}
            revealRequest={sessionRevealRequest}
            onSelectItem={undefined}
            onStartDraftSession={startDraftSession}
            onStartMissingAgentDraft={isMessageOnlyView ? undefined : startMissingAgentDraft}
            setActiveSessionId={setActiveSessionAndDiscardDraft}
          />
        )
      }
    : null

  return (
    <Container>
      <div className="flex min-w-0 flex-1 shrink flex-row overflow-hidden">
        <AgentChat
          activeSession={visibleSession}
          activeSessionLoading={isActiveSessionLoading}
          activeSessionSource={activeSessionSource}
          pane={pane}
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
          onCreateEmptySession={isOldView && !isMessageOnlyView ? createAndActivateEmptySession : undefined}
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
          resourcePane={resourcePane}
          resourcePaneCount={sessionResourcePaneCount}
          resourcePaneRevealRequest={sessionRevealRequest}
          workPaneOpen={isOldView ? workPaneOpen : undefined}
          onWorkPaneOpenChange={isOldView ? setWorkPaneOpen : undefined}
        />
      </div>
      <HistoryRecordsPage
        mode="agent"
        open={historyRecordsOpen && !isMessageOnlyView && !isWindowFrame}
        activeRecordId={activeSessionId}
        onClose={closeHistoryRecords}
        onRecordSelect={handleHistoryRecordsSessionSelect}
      />
      {isOldView && (
        <AgentConversationPickerDialog
          open={agentPickerOpen}
          onOpenChange={setAgentPickerOpen}
          agents={agents}
          agentsLoading={isAgentsLoading}
          onSelect={handleAgentConversationSelect}
        />
      )}
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
