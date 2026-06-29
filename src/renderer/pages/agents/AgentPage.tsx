import { dataApiService } from '@data/DataApiService'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resources'
import type { ResourceListRevealPayload } from '@renderer/components/chat/resources/resourceListRevealEvents'
import { useWindowFrame } from '@renderer/components/chat/shell/WindowFrameContext'
import {
  createRecentSessionEntryFromSession,
  upsertGlobalSearchRecentEntry
} from '@renderer/components/GlobalSearch/globalSearchGroups'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import { useAgent, useAgents } from '@renderer/hooks/agent/useAgent'
import { useActiveSession, useSession } from '@renderer/hooks/agent/useSession'
import { useCommandHandler } from '@renderer/hooks/command'
import { useCurrentTab, useCurrentTabId, useIsActiveTab, useTabSelfMetadata } from '@renderer/hooks/tab'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { ipcApi } from '@renderer/ipc'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { cn } from '@renderer/utils/style'
import { getTabInstanceKey } from '@renderer/utils/tabInstanceMetadata'
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

/**
 * A real session created + prewarmed eagerly when the user starts typing a new-chat draft, so the
 * first send hits a warm Claude Code subprocess instead of a cold start. `forDraft` is the draft
 * object identity it was reserved for; once the draft changes it is discarded (deleted + warm closed).
 */
type ReservedSession = {
  forDraft: DraftAgentSession
  promise: Promise<PersistentAgentSessionConversation | null>
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
  const reservedSessionRef = useRef<ReservedSession | null>(null)

  // Drop an eagerly-reserved+prewarmed session that the user abandoned without sending: close its warm
  // query and delete the (still message-less) row. Best-effort; the boot sweep nets force-quit leftovers.
  const discardReservedSession = useCallback(() => {
    const reserved = reservedSessionRef.current
    if (!reserved) return
    reservedSessionRef.current = null
    void reserved.promise.then((persisted) => {
      if (!persisted) return
      void ipcApi.request('ai.close_agent_session_warm', { sessionId: persisted.sessionId }).catch(() => {})
      void dataApiService.delete(`/agent-sessions/${persisted.sessionId}`).catch((error) => {
        logger.warn('Failed to delete abandoned reserved session', error as Error)
      })
    })
  }, [])

  useEffect(() => {
    pendingSelectedSessionRef.current = null
    if (routeActiveSessionId === null && draftSessionRef.current) {
      setActiveSessionId(null)
      return
    }

    discardReservedSession()
    draftSessionRef.current = null
    setDraftSession(null)
    setActiveSessionId(routeActiveSessionId)
  }, [discardReservedSession, routeActiveSessionId])

  // Tab/window close (AgentPage unmount) with a typed-but-unsent draft → drop its reservation. Keep-
  // alive means switching tabs does NOT unmount, so this fires only on a genuine close.
  useEffect(() => () => discardReservedSession(), [discardReservedSession])
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
  const setDraftSessionState = useCallback(
    (nextDraft: DraftAgentSession | null) => {
      // Any draft change/clear abandons a reservation made for the previous draft (the adopt path
      // clears the ref first, so a successful handoff never deletes the session it just adopted).
      if (reservedSessionRef.current && reservedSessionRef.current.forDraft !== nextDraft) {
        discardReservedSession()
      }
      draftSessionRef.current = nextDraft
      setDraftSession(nextDraft)
    },
    [discardReservedSession]
  )

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

  // Shared draft→persistent handoff bookkeeping (used by both the eager-adopt and create paths).
  const finalizeHandoff = useCallback(
    (persisted: PersistentAgentSessionConversation) => {
      pendingSelectedSessionRef.current = persisted.session
      setDraftSessionState(null)
      setLastUsedAgentId(persisted.agentId)
      if (isUserWorkspaceSession(persisted.session)) {
        setLastUsedWorkspaceId(persisted.session.workspaceId)
      }
      setActiveSessionId(persisted.sessionId)
      void invalidateCache(['/agent-sessions', '/agent-workspaces', `/agent-sessions/${persisted.sessionId}`]).catch(
        (err) => {
          logger.warn('Failed to refresh session metadata after draft session handoff', err as Error)
        }
      )
    },
    [invalidateCache, setActiveSessionId, setDraftSessionState, setLastUsedAgentId, setLastUsedWorkspaceId]
  )

  // Eagerly create + prewarm the real session for the current draft when the user starts typing, so
  // the first send reuses a warm Claude Code subprocess. Idempotent per draft; the row stays out of
  // the session list (no cache invalidation) until the send actually adopts it.
  const reserveDraftSession = useCallback(() => {
    if (reservedSessionRef.current) return
    const current = draftSessionRef.current
    if (!current) return

    const promise = (async (): Promise<PersistentAgentSessionConversation | null> => {
      try {
        const session = await dataApiService.post('/agent-sessions', {
          body: { agentId: current.agentId, name: t('common.unnamed'), workspace: current.workspaceSource }
        })
        void ipcApi.request('ai.prewarm_agent_session', { sessionId: session.id }).catch((error) => {
          logger.warn('Failed to prewarm reserved agent session', error as Error)
        })
        return {
          agentId: session.agentId ?? current.agentId,
          name: session.name,
          session,
          sessionId: session.id,
          topicId: buildAgentSessionTopicId(session.id)
        } satisfies PersistentAgentSessionConversation
      } catch (error) {
        logger.warn('Failed to reserve draft session for prewarm', error as Error)
        return null
      }
    })()

    const entry: ReservedSession = { forDraft: current, promise }
    reservedSessionRef.current = entry
    // If the create failed, clear the ref (only if it's still this entry) so a later keystroke retries.
    void promise.then((persisted) => {
      if (persisted === null && reservedSessionRef.current === entry) reservedSessionRef.current = null
    })
  }, [t])

  const ensurePersistentSession = useCallback(
    async (initialName?: string) => {
      const current = draftSessionRef.current
      if (!current) {
        throw new Error('Draft session handoff failed: no active draft session')
      }
      const trimmed = initialName?.trim()

      // Adopt the eagerly-reserved + prewarmed session for this draft, if any. Rename it from the
      // sent text to preserve the "session named after first message" behavior of the create path.
      const reserved = reservedSessionRef.current
      if (reserved?.forDraft === current) {
        reservedSessionRef.current = null
        const reservedPersisted = await reserved.promise
        if (reservedPersisted) {
          const name = trimmed ? trimmed.slice(0, 30) : reservedPersisted.name
          const persisted =
            name === reservedPersisted.name
              ? reservedPersisted
              : { ...reservedPersisted, name, session: { ...reservedPersisted.session, name } }
          if (name !== reservedPersisted.name) {
            void dataApiService.patch(`/agent-sessions/${persisted.sessionId}`, { body: { name } }).catch((error) => {
              logger.warn('Failed to name adopted session', error as Error)
            })
          }
          finalizeHandoff(persisted)
          return persisted
        }
        // Reserve failed earlier — fall through to a fresh create below.
      }

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
      finalizeHandoff(persisted)
      return persisted
    },
    [finalizeHandoff, t]
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
          onDraftComposeIntent={isMessageOnlyView ? undefined : reserveDraftSession}
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
