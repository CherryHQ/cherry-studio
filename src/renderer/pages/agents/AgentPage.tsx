import { dataApiService } from '@data/DataApiService'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import type { ResourcePaneConfig, ResourcePaneCountButtonProps } from '@renderer/components/chat/panes/Shell'
import { AgentResourceList } from '@renderer/components/chat/resourceList/AgentResourceList'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resourceList/base'
import ConversationPageShell from '@renderer/components/chat/shell/ConversationPageShell'
import { ConversationSidebarToggleButton } from '@renderer/components/chat/shell/ConversationSidebarToggleButton'
import type { ChatPanePosition } from '@renderer/components/chat/shell/paneLayout'
import {
  createRecentSessionEntryFromSession,
  upsertGlobalSearchRecentEntry
} from '@renderer/components/GlobalSearch/globalSearchGroups'
import {
  ConversationResourceView,
  type ConversationResourceViewDefinition,
  useConversationResourceView
} from '@renderer/components/resourceCatalog/conversation'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import { useAgent, useAgents } from '@renderer/hooks/agent/useAgent'
import { useActiveSession, useSession, useUpdateSession } from '@renderer/hooks/agent/useSession'
import { useCommandHandler } from '@renderer/hooks/command'
import { useAgentSessionsSource } from '@renderer/hooks/resourceViewSources'
import { useCurrentTab, useCurrentTabId, useIsActiveTab, useTabSelfMetadata } from '@renderer/hooks/tab'
import { useClassicLayoutRightPaneOpen } from '@renderer/hooks/useClassicLayoutRightPaneOpen'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { useWindowFrame } from '@renderer/hooks/useWindowFrame'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { ResourceListRevealPayload } from '@renderer/services/resourceListRevealEvents'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { findLatestUpdated, isUntouchedSinceCreation } from '@renderer/utils/resourceEntity'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { cn } from '@renderer/utils/style'
import { getTabInstanceKey } from '@renderer/utils/tabInstanceMetadata'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE, type AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import { buildFirstUserMessageTitle } from '@shared/utils/conversationTitle'
import { MIN_WINDOW_HEIGHT, SECOND_MIN_WINDOW_WIDTH } from '@shared/utils/window'
import { useSearch } from '@tanstack/react-router'
import { Bot, Zap } from 'lucide-react'
import type { PropsWithChildren } from 'react'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import HistoryRecordsPage from '../history/HistoryRecordsPage'
import AgentChat from './AgentChat'
import AgentSidePanel from './AgentSidePanel'
import { AgentConversationPickerDialog } from './components/AgentConversationPickerDialog'
import Sessions from './components/Sessions'
import { parseAgentRouteSearch } from './routeSearch'
import type { DraftAgentSession, DraftAgentSessionDefaults, PersistentAgentSessionConversation } from './types'

const logger = loggerService.withContext('AgentPage')
type AgentConversationResourceKind = 'agent' | 'skill'

function isUserWorkspaceSession(session: AgentSessionEntity | null | undefined): boolean {
  return !!session?.workspaceId && session.workspace?.type !== 'system'
}

function sessionMatchesWorkspaceSource(
  session: AgentSessionEntity,
  workspaceSource: AgentSessionWorkspaceSource
): boolean {
  if (workspaceSource.type === AGENT_WORKSPACE_TYPE.USER) {
    return isUserWorkspaceSession(session) && session.workspaceId === workspaceSource.workspaceId
  }

  return session.workspace?.type === AGENT_WORKSPACE_TYPE.SYSTEM
}

// Reuse the agent's latest *empty* placeholder session (matched by `isMatch`) instead of stacking a
// new one. The empty session only exists to surface the agent in the classic-layout rail, so on repeated
// adds we reopen the existing placeholder rather than pile up blanks.
//
// Emptiness is detected via `isUntouchedSinceCreation` (updatedAt === createdAt), not a blank name:
// with auto-naming off a chatted-in session keeps a blank name forever, so a name test would reopen it
// instead of starting a new conversation. See isUntouchedSinceCreation for the full rationale.
function findReusableEmptySession<T extends { createdAt?: string; updatedAt?: string }>(
  sessions: readonly T[],
  isMatch: (session: T) => boolean
): T | undefined {
  return findLatestUpdated(sessions.filter((session) => isUntouchedSinceCreation(session) && isMatch(session)))
}

const AgentPage = () => {
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const [sessionLayout] = usePreference('agent.layout')
  const isClassicSessionLayout = sessionLayout === 'classic'
  // Classic layout shares this full-sessions source with the rail; modern layout leaves it disabled (no fetch).
  // The picker uses it to reuse an empty placeholder session instead of stacking new ones.
  const {
    sessions: classicLayoutSessions,
    isLoadingAll: isClassicSessionLayoutLoading = false,
    isFullyLoaded: isClassicSessionLayoutFullyLoaded = true
  } = useAgentSessionsSource({ enabled: isClassicSessionLayout })
  const isClassicSessionLayoutHistoryReady =
    !isClassicSessionLayout || (!isClassicSessionLayoutLoading && isClassicSessionLayoutFullyLoaded)
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
  // Classic-layout (rail) session-pane open state, cached on the agent surface's own key so it
  // survives AgentChat draft→persistent remounts (each branch mounts its own Shell) and app/page
  // re-entry, without bleeding into the assistant surface.
  const [sessionPaneOpen, setSessionPaneOpen] = useClassicLayoutRightPaneOpen('agent', isClassicSessionLayout)

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
  const [, setRecentItems] = usePersistCache('ui.global_search.recent_items')
  const lastRecordedRecentSessionRef = useRef<string | undefined>(undefined)
  const [sessionRevealRequest, setSessionRevealRequest] = useState<ResourceListRevealRequest>()
  const [pendingLocateMessageId, setPendingLocateMessageId] = useState<string | undefined>()
  const sessionRevealRequestIdRef = useRef(0)
  const initialDraftSessionEvaluatedRef = useRef(false)
  const [replacingDraftAgent, setReplacingDraftAgent] = useState(false)
  const [replacingDraftWorkspace, setReplacingDraftWorkspace] = useState(false)
  const [replacingSessionWorkspace, setReplacingSessionWorkspace] = useState(false)
  const [missingAgentDraft, setMissingAgentDraft] = useState(false)
  const [agentPickerOpen, setAgentPickerOpen] = useState(false)
  const { t } = useTranslation()
  const invalidateCache = useInvalidateCache()
  const { setSessionWorkspace } = useUpdateSession()
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
  const resourceConversationKey = useMemo(() => {
    if (visibleSession?.id) return `session:${visibleSession.id}`
    if (visibleDraftSession) {
      const workspaceKey =
        visibleDraftSession.workspaceSource.type === AGENT_WORKSPACE_TYPE.USER
          ? `workspace:${visibleDraftSession.workspaceSource.workspaceId}`
          : 'system'

      return `draft:${visibleDraftSession.agentId}:${workspaceKey}`
    }
    if (missingAgentDraft) return 'missing-agent-draft'
    return 'empty'
  }, [missingAgentDraft, visibleDraftSession, visibleSession?.id])
  const resourceViewDefinitions = useMemo<readonly ConversationResourceViewDefinition<AgentConversationResourceKind>[]>(
    () => [
      {
        icon: <Bot />,
        id: 'agent-resource-view',
        kind: 'agent',
        label: t('chat.resource_view.menu.agent')
      },
      {
        icon: <Zap />,
        id: 'skill-resource-view',
        kind: 'skill',
        label: t('chat.resource_view.menu.skill')
      }
    ],
    [t]
  )
  const {
    activeKind: activeResourceViewKind,
    close: closeResourceView,
    menuItems: resourceMenuItems
  } = useConversationResourceView<AgentConversationResourceKind>({
    conversationKey: resourceConversationKey,
    definitions: resourceViewDefinitions,
    disabled: isMessageOnlyView || isWindowFrame
  })
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

    lastRecordedRecentSessionRef.current = signature
    setRecentItems((prev) =>
      upsertGlobalSearchRecentEntry(prev ?? [], createRecentSessionEntryFromSession(activeSession))
    )
  }, [activeSession, isMessageOnlyView, setRecentItems])

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
      closeResourceView()
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
      closeResourceView,
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
        // Reuse the agent's latest empty placeholder regardless of workspace — the picker resolves a
        // fresh workspace below only when it has to create one. See findReusableEmptySession.
        const reusableSession = findReusableEmptySession(
          classicLayoutSessions,
          (candidate) => candidate.agentId === agentId
        )

        let session = reusableSession
        if (!session) {
          const defaults = { agentId }
          const { rememberedWorkspaceId, workspaceSource } = resolveDraftWorkspaceSource(defaults)
          const started = await buildDraftSessionWithFallback(defaults, workspaceSource, rememberedWorkspaceId)
          if (!started) return

          session = await dataApiService.post('/agent-sessions', {
            body: {
              agentId: started.agentId,
              name: '',
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
        closeResourceView()
        if (!reusableSession) {
          void invalidateCache(['/agent-sessions', '/agent-workspaces', `/agent-sessions/${session.id}`]).catch(
            (err) => {
              logger.warn('Failed to refresh session metadata after agent picker session create', err as Error)
            }
          )
        }
      } catch (err) {
        logger.error('Failed to create agent session from classic-layout picker', err as Error, { agentId })
        window.toast.error(formatErrorMessageWithPrefix(err, t('agent.session.create.error.failed')))
      }
    },
    [
      buildDraftSessionWithFallback,
      closeResourceView,
      invalidateCache,
      classicLayoutSessions,
      rememberLastUsedSession,
      resolveDraftWorkspaceSource,
      setActiveSessionId,
      setDraftSessionState,
      t
    ]
  )

  const startMissingAgentDraft = useCallback(() => {
    closeResourceView()
    setPendingLocateMessageId(undefined)
    pendingSelectedSessionRef.current = null
    setDraftSessionState(null)
    setActiveSessionId(null)
    setMissingAgentDraft(true)
  }, [closeResourceView, setActiveSessionId, setDraftSessionState])

  const startMissingAgentDraftSession = useCallback(
    async (agentId: string | null) => {
      if (!agentId) return
      await startDraftSession({ agentId })
    },
    [startDraftSession]
  )

  const startDefaultDraftSession = useCallback(async () => {
    closeResourceView()
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
  }, [agents, closeResourceView, lastUsedAgentId, setActiveSessionId, setDraftSessionState, startDraftSession])

  const handleHistorySessionSelect = useCallback(
    (sessionId: string | null, messageId?: string) => {
      closeResourceView()
      if (sessionId && conversationNav.focusExistingTab(sessionId, { excludeTabId: currentTabId ?? undefined })) return
      pendingSelectedSessionRef.current = null
      setResourceListOpen(true)
      // Locate (history / global search) should reveal the target in the right session pane. In modern layout
      // this setter is a no-op; classic layout persists it for the next AgentChat remount.
      setSessionPaneOpen(true)
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
    [
      closeResourceView,
      conversationNav,
      currentTabId,
      setDraftSessionState,
      setResourceListOpen,
      setSessionPaneOpen,
      startDefaultDraftSession
    ]
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

    if (isClassicSessionLayout) {
      if (!isClassicSessionLayoutHistoryReady) return

      const latestSession = findLatestUpdated(classicLayoutSessions)
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
    isClassicSessionLayout,
    isClassicSessionLayoutHistoryReady,
    lastUsedAgentId,
    missingAgentDraft,
    classicLayoutSessions,
    setActiveSessionId,
    setDraftSessionState,
    startDraftSession,
    visibleDraftSession
  ])

  const setActiveSessionAndDiscardDraft = useCallback(
    (sessionId: string | null, session?: AgentSessionEntity | null) => {
      closeResourceView()
      pendingSelectedSessionRef.current = session ?? null
      if (sessionId) {
        setDraftSessionState(null)
      }

      setActiveSessionId(sessionId)
    },
    [closeResourceView, setDraftSessionState]
  )
  const handleResourceSessionSelect = useCallback(
    (sessionId: string, session: AgentSessionEntity) => {
      closeResourceView()
      if (conversationNav.focusExistingTab(sessionId, { excludeTabId: currentTabId ?? undefined })) return
      setActiveSessionAndDiscardDraft(sessionId, session)
    },
    [closeResourceView, conversationNav, currentTabId, setActiveSessionAndDiscardDraft]
  )
  // Classic-layout reset after deleting the active agent: select the latest remaining
  // session (across other agents), or clear to the empty state. Never open the
  // draft compose — that belongs to the modern layout. Filter by the deleted id so
  // this is correct even before the session cache refetches.
  const handleActiveAgentDeleted = useCallback(
    (deletedAgentId: string) => {
      const nextSession = findLatestUpdated(
        classicLayoutSessions.filter((session) => session.agentId !== deletedAgentId)
      )
      if (nextSession) {
        setActiveSessionAndDiscardDraft(nextSession.id, nextSession)
        return
      }
      setPendingLocateMessageId(undefined)
      setMissingAgentDraft(false)
      setDraftSessionState(null)
      pendingSelectedSessionRef.current = null
      setActiveSessionId(null)
    },
    [classicLayoutSessions, setActiveSessionAndDiscardDraft, setActiveSessionId, setDraftSessionState]
  )

  const ensurePersistentSession = useCallback(
    async (initialName?: string) => {
      const current = draftSessionRef.current
      if (!current) {
        throw new Error('Draft session handoff failed: no active draft session')
      }

      const temporaryTitle = buildFirstUserMessageTitle(initialName ?? '')
      const session = await dataApiService.post('/agent-sessions', {
        body: {
          agentId: current.agentId,
          name: temporaryTitle || '',
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
    [invalidateCache, setActiveSessionId, setDraftSessionState, setLastUsedAgentId, setLastUsedWorkspaceId]
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
  const replaceSessionWorkspace = useCallback(
    async (workspaceId: string | null) => {
      const current = visibleSession
      if (!isClassicSessionLayout || !current) return

      const currentIsSystemWorkspace = current.workspace?.type === AGENT_WORKSPACE_TYPE.SYSTEM
      if (workspaceId === null && currentIsSystemWorkspace) return
      if (workspaceId && isUserWorkspaceSession(current) && workspaceId === current.workspaceId) {
        setLastUsedWorkspaceId(workspaceId)
        return
      }
      if (replacingSessionWorkspace) return

      setReplacingSessionWorkspace(true)
      try {
        const workspaceSource: AgentSessionWorkspaceSource = workspaceId
          ? { type: AGENT_WORKSPACE_TYPE.USER, workspaceId }
          : { type: AGENT_WORKSPACE_TYPE.SYSTEM }
        const updated = await setSessionWorkspace(current.id, workspaceSource)
        if (!updated) return

        pendingSelectedSessionRef.current = updated
        if (workspaceId) {
          setLastUsedWorkspaceId(workspaceId)
        }
        setActiveSessionId(updated.id)
      } finally {
        setReplacingSessionWorkspace(false)
      }
    },
    [
      isClassicSessionLayout,
      replacingSessionWorkspace,
      setActiveSessionId,
      setLastUsedWorkspaceId,
      setSessionWorkspace,
      visibleSession
    ]
  )
  const handleLocateMessageHandled = useCallback(() => {
    setPendingLocateMessageId(undefined)
  }, [])

  const panePosition: ChatPanePosition = 'left'
  // Classic layout = entity rail + right session panel; modern layout = the single sidebar (AgentSidePanel).
  const activeResourceAgentId = visibleSession?.agentId ?? visibleDraftSession?.agentId ?? null
  const sessionResourcePaneCount: ResourcePaneCountButtonProps | undefined =
    isClassicSessionLayout && activeResourceAgentId
      ? {
          label: t('agent.session.list.title'),
          count: classicLayoutSessions.filter((session) => session.agentId === activeResourceAgentId).length
        }
      : undefined
  const createAndActivateEmptySession = useCallback(async () => {
    closeResourceView()
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
      // Composer "new session" stays in the current workspace, so only reuse a placeholder that
      // matches it. See findReusableEmptySession.
      const reusableSession = findReusableEmptySession(
        classicLayoutSessions,
        (candidate) => candidate.agentId === agentId && sessionMatchesWorkspaceSource(candidate, workspaceSource)
      )
      const session =
        reusableSession ??
        (await dataApiService.post('/agent-sessions', {
          body: {
            agentId,
            name: '',
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
      logger.error('Failed to create empty agent session from classic-layout composer', err as Error, { agentId })
      window.toast.error(formatErrorMessageWithPrefix(err, t('agent.session.create.error.failed')))
    }
  }, [
    activeResourceAgentId,
    closeResourceView,
    invalidateCache,
    classicLayoutSessions,
    rememberLastUsedSession,
    setActiveSessionId,
    setDraftSessionState,
    t,
    visibleDraftSession,
    visibleSession?.workspace?.type,
    visibleSession?.workspaceId
  ])
  const pane = isClassicSessionLayout ? (
    <AgentResourceList
      activeAgentId={activeResourceAgentId}
      onAddAgent={() => {
        setAgentPickerOpen(true)
      }}
      onOpenHistoryRecords={openHistoryRecords}
      onSelectSession={handleResourceSessionSelect}
      onStartDraftAgent={(agentId) => startDraftSession({ agentId })}
      onStartMissingAgentDraft={startMissingAgentDraft}
      resourceMenuItems={resourceMenuItems}
      onActiveAgentDeleted={handleActiveAgentDeleted}
    />
  ) : (
    <AgentSidePanel
      activeSessionId={activeSessionId}
      revealRequest={sessionRevealRequest}
      onOpenHistoryRecords={openHistoryRecords}
      onStartDraftSession={startDraftSession}
      onStartMissingAgentDraft={isMessageOnlyView ? undefined : startMissingAgentDraft}
      resourceMenuItems={resourceMenuItems}
      setActiveSessionId={setActiveSessionAndDiscardDraft}
    />
  )
  // In classic layout the session list moves into the chat's right pane as a tab; AgentChat keeps the
  // pane provider per-branch (its Shell meta is bound to per-session runtime, unlike Home), so the
  // config is threaded into each branch rather than lifted to this page.
  const resourcePane: ResourcePaneConfig | null = isClassicSessionLayout
    ? {
        label: t('agent.session.list.title'),
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
  const resourceCenter = useMemo(
    () =>
      activeResourceViewKind
        ? {
            className: 'relative',
            content: (
              <ConversationResourceView
                kind={activeResourceViewKind}
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
    [activeResourceViewKind, effectiveShowSidebar, isMessageOnlyView, isWindowFrame, toggleResourceListOpen]
  )

  return (
    <Container>
      <div className="flex min-w-0 flex-1 shrink flex-row overflow-hidden">
        {resourceCenter ? (
          <ConversationPageShell
            center={resourceCenter}
            pane={pane}
            paneOpen={effectiveShowSidebar}
            panePosition={panePosition}
            onPaneCollapse={() => setResourceListOpen(false)}
          />
        ) : (
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
            onCreateEmptySession={
              isClassicSessionLayout && !isMessageOnlyView ? createAndActivateEmptySession : undefined
            }
            onMissingAgentDraftAgentChange={isMessageOnlyView ? undefined : startMissingAgentDraftSession}
            onEnsurePersistentSession={isMessageOnlyView ? undefined : ensurePersistentSession}
            onDraftAgentChange={isMessageOnlyView ? undefined : replaceDraftAgent}
            onDraftWorkspaceChange={isMessageOnlyView ? undefined : replaceDraftWorkspace}
            onSessionWorkspaceChange={
              isClassicSessionLayout && !isMessageOnlyView ? replaceSessionWorkspace : undefined
            }
            onVisibleAgentChange={isMessageOnlyView ? undefined : setLastUsedAgentId}
            onVisibleWorkspaceChange={isMessageOnlyView ? undefined : setLastUsedWorkspaceId}
            locateMessageId={pendingLocateMessageId}
            onLocateMessageHandled={handleLocateMessageHandled}
            replacingDraftAgent={replacingDraftAgent}
            replacingDraftWorkspace={replacingDraftWorkspace}
            replacingSessionWorkspace={replacingSessionWorkspace}
            resourcePane={resourcePane}
            resourcePaneCount={sessionResourcePaneCount}
            resourcePaneRevealRequest={sessionRevealRequest}
            sessionPaneOpen={isClassicSessionLayout ? sessionPaneOpen : undefined}
            onSessionPaneOpenChange={isClassicSessionLayout ? setSessionPaneOpen : undefined}
          />
        )}
      </div>
      <HistoryRecordsPage
        mode="agent"
        open={historyRecordsOpen && !isMessageOnlyView && !isWindowFrame}
        activeRecordId={activeSessionId}
        onClose={closeHistoryRecords}
        onRecordSelect={handleHistoryRecordsSessionSelect}
      />
      {isClassicSessionLayout && (
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
