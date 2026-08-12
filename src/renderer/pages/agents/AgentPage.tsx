import { cacheService } from '@data/CacheService'
import { dataApiService } from '@data/DataApiService'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import type { ResourcePaneConfig, ResourcePaneCountButtonProps } from '@renderer/components/chat/panes/Shell'
import { AgentResourceList } from '@renderer/components/chat/resourceList/AgentResourceList'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resourceList/base'
import { ConversationSidebarToggleButton } from '@renderer/components/chat/shell/ConversationSidebarToggleButton'
import type { AgentComposerLaunchOptions } from '@renderer/components/composer/variants/AgentComposer'
import {
  createRecentSessionEntryFromSession,
  recordGlobalSearchRecentEntry
} from '@renderer/components/GlobalSearch/globalSearchGroups'
import {
  type GlobalSearchAgentSessionMessageSelectionPayload,
  type GlobalSearchAgentSessionSelectionPayload,
  isGlobalSearchSelectionForTab
} from '@renderer/components/GlobalSearch/globalSearchSelectionEvents'
import HistoryRecordsView from '@renderer/components/history/HistoryRecordsView'
import { ConversationResourceView } from '@renderer/components/resourceCatalog/conversation'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import { useAgents } from '@renderer/hooks/agent/useAgent'
import { useActiveSession, useSession, useSessionMutations, useUpdateSession } from '@renderer/hooks/agent/useSession'
import { useCommandHandler } from '@renderer/hooks/command'
import { useAgentSessionsSource } from '@renderer/hooks/resourceViewSources'
import { useCurrentTabId, useIsActiveTab, useTabSelfVisuals } from '@renderer/hooks/tab'
import { useClassicLayoutRightPaneOpen } from '@renderer/hooks/useClassicLayoutRightPaneOpen'
import { useConversationCenterSurface } from '@renderer/hooks/useConversationCenterSurface'
import { useConversationShellPaneState } from '@renderer/hooks/useConversationShellPaneState'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { ResourceListRevealPayload } from '@renderer/services/resourceListRevealEvents'
import { toast } from '@renderer/services/toast'
import { buildAgentFileWorkspaceKey } from '@renderer/utils/agentSession'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { cn } from '@renderer/utils/style'
import { isDataApiNotFoundError } from '@shared/data/api/errors'
import type { AgentSessionEntity, AgentSessionOwnerScope } from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE, type AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import type { TopicTabPosition } from '@shared/data/preference/preferenceTypes'
import { useNavigate, useSearch } from '@tanstack/react-router'
import type { PropsWithChildren } from 'react'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AgentChat from './AgentChat'
import AgentSidePanel from './AgentSidePanel'
import { AgentCreateDialog } from './components/AgentCreateDialog'
import type { AgentFileNavigationRequest } from './components/AgentRightPane'
import Sessions from './components/Sessions'
import {
  createFeedbackComposerLaunch,
  FEEDBACK_INTENT_GUARD_TTL_MS,
  type FeedbackComposerLaunch,
  getFeedbackIntentGuardCacheKey
} from './feedbackComposerLaunch'
import { parseAgentRouteSearch } from './routeSearch'
import type { CreateAgentSessionDefaults } from './types'
import { useAgentConversationBootstrap } from './useAgentConversationBootstrap'

const logger = loggerService.withContext('AgentPage')
type AgentConversationResourceKind = 'agent'
const AGENT_CONVERSATION_RESOURCE_KINDS = ['agent'] as const satisfies readonly AgentConversationResourceKind[]

function isUserWorkspaceSession(session: AgentSessionEntity | null | undefined): boolean {
  return !!session?.workspaceId && session.workspace?.type !== 'system'
}

function isSystemWorkspaceSession(session: AgentSessionEntity | null | undefined): boolean {
  return (
    !!session &&
    (session.workspace?.type === AGENT_WORKSPACE_TYPE.SYSTEM ||
      (!session.workspaceId && session.workspace?.type !== AGENT_WORKSPACE_TYPE.USER))
  )
}

function getWorkspaceSourceFromSession(session: AgentSessionEntity): AgentSessionWorkspaceSource {
  if (session.workspace?.type === AGENT_WORKSPACE_TYPE.SYSTEM) {
    return { type: AGENT_WORKSPACE_TYPE.SYSTEM }
  }

  return session.workspaceId
    ? { type: AGENT_WORKSPACE_TYPE.USER, workspaceId: session.workspaceId }
    : { type: AGENT_WORKSPACE_TYPE.SYSTEM }
}

const AgentPage = () => {
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const [sessionDisplayMode, setSessionDisplayMode] = usePreference('agent.session.display_mode')
  const [panePosition, setPanePosition] = usePreference('agent.session.position')
  const isAgentResourceLayout = sessionDisplayMode === 'agent'
  const routeSearch = parseAgentRouteSearch(useSearch({ strict: false }) as Record<string, unknown>)
  const navigate = useNavigate()
  const isFeedbackIntent = routeSearch.intent === 'feedback'
  const isActiveTab = useIsActiveTab()
  const currentTabId = useCurrentTabId()
  const routeSessionId = routeSearch.sessionId
  const isMessageOnlyView = routeSearch.view === 'message' && !!routeSessionId
  const routeActiveSessionId = isMessageOnlyView ? null : (routeSessionId ?? null)
  // Shared session facts plus exact derived lookups for rails, restore, and placeholder reuse.
  const agentSessionsSource = useAgentSessionsSource()

  const { stats: sessionStats, loadSession, loadLatestSession, loadReusableSessions } = agentSessionsSource
  const {
    isWindowFrame,
    shellPaneOpen,
    paneManualToggle,
    setShellPaneOpen,
    setShellPaneOpenManually,
    toggleShellPane,
    handlePaneAutoCollapseChange
  } = useConversationShellPaneState({
    isMessageOnlyView,
    persistedPaneOpen: showSidebar,
    setPersistedPaneOpen: setShowSidebar
  })
  const sessionListPosition: TopicTabPosition =
    !isWindowFrame && isAgentResourceLayout && panePosition === 'right' ? 'right' : 'left'
  const { session: routeSession, isLoading: isRouteSessionLoading } = useSession(
    isMessageOnlyView ? routeSessionId : null
  )
  const { agents, isLoading: isAgentsLoading } = useAgents()
  const agentIdSet = useMemo(() => new Set(agents.map((agent) => agent.id)), [agents])
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(() => routeActiveSessionId)
  const syncedRouteActiveSessionIdRef = useRef(routeActiveSessionId)
  // Page-initiated selection writes the tab URL — the conversation's sole identity channel —
  // and mirrors into state immediately so the UI doesn't wait a router round trip. Route-driven
  // changes (entry interceptor, recovery) flow back through the sync effect below. Clearing
  // (`null`) never navigates: the next selection or the recovery path owns the URL then.
  const setActiveSessionId = useCallback(
    (id: string | null) => {
      setActiveSessionIdState(id)
      if (id && !isMessageOnlyView) {
        void navigate({ to: '/app/agents', search: { sessionId: id }, replace: true })
      }
    },
    [isMessageOnlyView, navigate]
  )
  // Classic-layout (rail) session-pane open state, cached on the agent surface's own key so it
  // survives app/page re-entry without bleeding into the assistant surface.
  const [sessionPaneOpen, setSessionPaneOpen] = useClassicLayoutRightPaneOpen('agent', {
    enabled: isAgentResourceLayout,
    defaultOpen: !isWindowFrame && panePosition === 'right'
  })
  const isCreatingEmptySessionRef = useRef(false)

  useEffect(() => {
    const previousRouteActiveSessionId = syncedRouteActiveSessionIdRef.current
    syncedRouteActiveSessionIdRef.current = routeActiveSessionId

    // A pending session left over from the previous route no longer matches the new active id, so
    // `useActiveSession` ignores it — no need to null it here.
    setActiveSessionIdState((currentActiveSessionId) => {
      if (routeActiveSessionId) {
        return routeActiveSessionId
      }

      if (previousRouteActiveSessionId && currentActiveSessionId === previousRouteActiveSessionId) {
        return null
      }

      return currentActiveSessionId
    })
  }, [routeActiveSessionId])
  const [lastUsedAgentId, setLastUsedAgentId] = usePersistCache('ui.agent.last_used_agent_id')
  const [lastUsedWorkspaceId, setLastUsedWorkspaceId] = usePersistCache('ui.agent.last_used_workspace_id')
  const lastRecordedRecentSessionRef = useRef<string | undefined>(undefined)
  const [sessionRevealRequest, setSessionRevealRequest] = useState<ResourceListRevealRequest>()
  const [pendingLocateMessageId, setPendingLocateMessageId] = useState<string | undefined>()
  const sessionRevealRequestIdRef = useRef(0)
  const ownerFallbackRequestIdRef = useRef(0)
  const initialEmptySessionEvaluatedRef = useRef(false)
  const routeFeedbackComposerLaunch = useMemo<FeedbackComposerLaunch | null>(
    () => (isFeedbackIntent && routeSessionId ? createFeedbackComposerLaunch(routeSessionId) : null),
    [isFeedbackIntent, routeSessionId]
  )
  const [feedbackComposerLaunch, setFeedbackComposerLaunch] = useState<FeedbackComposerLaunch | null>(
    routeFeedbackComposerLaunch
  )
  const [selectingMissingAgent, setSelectingMissingAgent] = useState(false)
  const [replacingSessionWorkspace, setReplacingSessionWorkspace] = useState(false)
  const [missingAgentSelection, setMissingAgentSelection] = useState(false)
  const [agentCreateOpen, setAgentCreateOpen] = useState(false)
  const { t } = useTranslation()
  const invalidateCache = useInvalidateCache()
  const { createSession, deleteSessions } = useSessionMutations()
  const { setSessionWorkspace } = useUpdateSession()
  const {
    session: activeSession,
    isLoading: isActiveSessionLoading,
    error: activeSessionError,
    sessionSource: activeSessionSource,
    setActiveSession,
    selectSession,
    clearActiveSession,
    setPendingSession
  } = useActiveSession({
    activeSessionId,
    setActiveSessionId
  })
  const reenterAgentRoute = useCallback(() => {
    initialEmptySessionEvaluatedRef.current = false
    clearActiveSession()
    void navigate({ to: '/app/agents', search: {}, replace: true })
  }, [clearActiveSession, navigate])
  // The URL-bound session no longer exists: its by-id query settled with NOT_FOUND (deleted while
  // this tab was dormant, or a rotted deep link). Recovery is a plain replace-navigation back
  // through the entry interceptor, which resolves the next target — no in-page state surgery.
  useEffect(() => {
    if (isMessageOnlyView || isFeedbackIntent) return
    if (!routeSessionId || activeSessionId !== routeSessionId) return
    if (activeSession || isActiveSessionLoading) return
    if (!isDataApiNotFoundError(activeSessionError)) return
    reenterAgentRoute()
  }, [
    activeSession,
    activeSessionError,
    activeSessionId,
    isActiveSessionLoading,
    isFeedbackIntent,
    isMessageOnlyView,
    reenterAgentRoute,
    routeSessionId
  ])
  const lastVisibleSessionRef = useRef<AgentSessionEntity | null>(null)
  const visibleSession = isMessageOnlyView
    ? routeSession
    : (activeSession ?? (isActiveSessionLoading ? lastVisibleSessionRef.current : null))
  const visibleSessionId = visibleSession?.id
  const visibleSessionAgentId = visibleSession?.agentId
  const visibleSessionOwnerScope: AgentSessionOwnerScope | undefined = visibleSessionId
    ? visibleSessionAgentId && (isAgentsLoading || agentIdSet.has(visibleSessionAgentId))
      ? visibleSessionAgentId
      : 'unlinked'
    : undefined
  const [rightPaneAgentScopeId, setRightPaneAgentScopeId] = useState<AgentSessionOwnerScope | undefined>(
    () => visibleSessionOwnerScope
  )
  const activeSessionSelectionRef = useRef<AgentSessionEntity | null>(visibleSession)
  useEffect(() => {
    activeSessionSelectionRef.current = visibleSession
  }, [visibleSession])
  useEffect(() => {
    if (!visibleSessionId || !visibleSessionOwnerScope) return
    setRightPaneAgentScopeId(visibleSessionOwnerScope)
  }, [visibleSessionId, visibleSessionOwnerScope])
  const selectedAgentScope =
    isAgentResourceLayout && panePosition === 'right' && rightPaneAgentScopeId !== undefined
      ? rightPaneAgentScopeId
      : visibleSessionOwnerScope
  const activeResourceAgentId = selectedAgentScope && selectedAgentScope !== 'unlinked' ? selectedAgentScope : null
  const visibleAgentFromList = agents.find((agent) => agent.id === visibleSession?.agentId)
  const conversationBootstrap = useAgentConversationBootstrap({
    session: visibleSession ?? null,
    sessionLoading: isMessageOnlyView ? isRouteSessionLoading : isActiveSessionLoading,
    sessionSource: isMessageOnlyView && routeSession ? 'query' : isMessageOnlyView ? 'none' : activeSessionSource,
    agentHint: visibleAgentFromList
  })
  const visibleAgent = conversationBootstrap.resources.agent
  const fileNavigationRequestRef = useRef<AgentFileNavigationRequest | null>(null)
  const handleFileNavigationRequestChange = useCallback((request: AgentFileNavigationRequest | null) => {
    fileNavigationRequestRef.current = request
  }, [])
  const requestFileNavigation = useCallback((transition: () => void) => {
    const request = fileNavigationRequestRef.current
    if (request) {
      request(transition)
      return
    }
    transition()
  }, [])
  const resourceConversationKey = useMemo(() => {
    if (visibleSession?.id) return `session:${visibleSession.id}`
    if (missingAgentSelection) return 'missing-agent-selection'
    return 'empty'
  }, [missingAgentSelection, visibleSession?.id])
  const conversationResourcesEnabled = !isMessageOnlyView && !isWindowFrame
  const {
    activeResourceKind,
    closeSurface,
    historyActive: historyRecordsActive,
    toggleHistory: toggleHistoryRecords,
    toggleResource
  } = useConversationCenterSurface<AgentConversationResourceKind>({
    conversationKey: resourceConversationKey,
    disabled: !conversationResourcesEnabled,
    resourceKinds: AGENT_CONVERSATION_RESOURCE_KINDS
  })
  const toggleAgentResourceView = useCallback(() => toggleResource('agent'), [toggleResource])
  const manageAgentsActive = activeResourceKind === 'agent'
  const onManageAgents = conversationResourcesEnabled ? toggleAgentResourceView : undefined
  // All non-dormant tabs mount at once (Activity keep-alive), so each agent tab runs its
  // own AgentPage. `useIsActiveTab` answers "am I the globally-focused tab" (gates last_used).
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
  // While the bound session is still loading (or the visible entity intentionally lags behind a
  // selection), keep the tab's stored title/icon instead of stamping a stale or generic one.
  const targetSessionId = isMessageOnlyView ? routeSessionId : (activeSessionId ?? undefined)
  const preserveTabVisuals = !!targetSessionId && visibleSession?.id !== targetSessionId
  useTabSelfVisuals({
    title: visibleSession?.name?.trim() || visibleAgent?.name?.trim() || getDefaultRouteTitle('/app/agents'),
    emoji: visibleAgent?.configuration?.avatar,
    appId: 'agents',
    preserveVisuals: preserveTabVisuals
  })

  const [sessionPaneUserOpenIntentSeq, setSessionPaneUserOpenIntentSeq] = useState(0)
  useCommandHandler('app.sidebar.toggle', toggleShellPane, { enabled: isActiveTab })

  useEffect(() => {
    if (isMessageOnlyView) return
    if (!activeSession) return

    const signature = `${activeSession.id}:${activeSession.name}`
    if (lastRecordedRecentSessionRef.current === signature) return

    lastRecordedRecentSessionRef.current = signature
    recordGlobalSearchRecentEntry(createRecentSessionEntryFromSession(activeSession))
  }, [activeSession, isMessageOnlyView])

  useEffect(() => {
    if (activeSession) lastVisibleSessionRef.current = activeSession
  }, [activeSession])

  useEffect(() => {
    // Track "last focused session" only for persisted sessions. Gated on
    // the active tab: `last_used` is a single global "what I'm looking at now",
    // so background tabs must not clobber it and switching tabs must update it.
    if (!isActiveTab) return
    if (activeSession?.id && activeSessionSource === 'query') {
      cacheService.setPersist('ui.agent.last_used_session_id', activeSession.id)
    }
  }, [isActiveTab, activeSession, activeSessionSource])

  const rememberLastUsedSession = useCallback(
    (agentId: string, userWorkspaceId?: string) => {
      setLastUsedAgentId(agentId)
      if (userWorkspaceId) setLastUsedWorkspaceId(userWorkspaceId)
    },
    [setLastUsedAgentId, setLastUsedWorkspaceId]
  )

  const resolveCreateWorkspaceSource = useCallback(
    async (
      defaults: CreateAgentSessionDefaults,
      fallbackSession?: AgentSessionEntity | null
    ): Promise<AgentSessionWorkspaceSource> => {
      if (defaults.workspace) return defaults.workspace
      if (defaults.workspaceMode === 'system') return { type: AGENT_WORKSPACE_TYPE.SYSTEM }
      if (defaults.workspaceId) return { type: AGENT_WORKSPACE_TYPE.USER, workspaceId: defaults.workspaceId }
      if (fallbackSession && (!defaults.agentId || defaults.agentId === fallbackSession.agentId)) {
        return getWorkspaceSourceFromSession(fallbackSession)
      }

      if (!lastUsedWorkspaceId) return { type: AGENT_WORKSPACE_TYPE.SYSTEM }

      try {
        await dataApiService.get(`/agent-workspaces/${lastUsedWorkspaceId}`)
        return { type: AGENT_WORKSPACE_TYPE.USER, workspaceId: lastUsedWorkspaceId }
      } catch (err) {
        logger.warn('Failed to reuse remembered workspace for new agent session', err as Error, {
          workspaceId: lastUsedWorkspaceId
        })
        setLastUsedWorkspaceId(null)
        return { type: AGENT_WORKSPACE_TYPE.SYSTEM }
      }
    },
    [lastUsedWorkspaceId, setLastUsedWorkspaceId]
  )

  const activateSession = useCallback(
    (session: AgentSessionEntity, fallbackAgentId?: string | null) => {
      setPendingLocateMessageId(undefined)
      setMissingAgentSelection(false)
      const agentId = session.agentId ?? fallbackAgentId
      if (agentId) {
        setRightPaneAgentScopeId(agentId)
        rememberLastUsedSession(agentId, isUserWorkspaceSession(session) ? session.workspaceId : undefined)
      }
      setActiveSession(session)
      closeSurface()
    },
    [closeSurface, rememberLastUsedSession, setActiveSession]
  )

  const deleteDuplicateEmptySystemSessions = useCallback(
    async (sessionIds: string[]) => {
      if (sessionIds.length === 0) return

      try {
        await deleteSessions(sessionIds)
      } catch (err) {
        logger.warn('Failed to delete duplicate empty system agent sessions', err as Error, { sessionIds })
      }
    },
    [deleteSessions]
  )

  const createAndActivateEmptySession = useCallback(
    async (defaults: CreateAgentSessionDefaults = {}): Promise<AgentSessionEntity | null> => {
      if (isCreatingEmptySessionRef.current) return null
      isCreatingEmptySessionRef.current = true

      const agentId = defaults.agentId ?? visibleSession?.agentId ?? null
      try {
        closeSurface()

        if (!agentId) {
          setPendingLocateMessageId(undefined)
          clearActiveSession()
          setMissingAgentSelection(true)
          return null
        }

        const workspaceSource = await resolveCreateWorkspaceSource(defaults, visibleSession)
        const reusableSessions = (
          await loadReusableSessions(
            agentId,
            workspaceSource.type === AGENT_WORKSPACE_TYPE.SYSTEM ? 'system' : workspaceSource.workspaceId
          )
        ).filter((session) => session.id !== defaults.excludeReuseSessionId)
        const reusableSession = reusableSessions[0]
        const duplicateEmptySystemSessionIds =
          workspaceSource.type === AGENT_WORKSPACE_TYPE.SYSTEM
            ? reusableSessions.slice(1).map((session) => session.id)
            : []
        const session =
          reusableSession ??
          (await createSession({
            agentId,
            name: '',
            workspace: workspaceSource
          }))

        activateSession(session, agentId)
        await deleteDuplicateEmptySystemSessions(duplicateEmptySystemSessionIds)

        return session
      } catch (err) {
        logger.error('Failed to create empty agent session', err as Error, { agentId })
        toast.error(formatErrorMessageWithPrefix(err, t('agent.session.create.error.failed')))
        return null
      } finally {
        isCreatingEmptySessionRef.current = false
      }
    },
    [
      activateSession,
      clearActiveSession,
      closeSurface,
      createSession,
      deleteDuplicateEmptySystemSessions,
      loadReusableSessions,
      resolveCreateWorkspaceSource,
      t,
      visibleSession
    ]
  )

  const showMissingAgentSelection = useCallback(() => {
    closeSurface()
    setPendingLocateMessageId(undefined)
    setRightPaneAgentScopeId(undefined)
    clearActiveSession()
    setMissingAgentSelection(true)
  }, [clearActiveSession, closeSurface])

  const createDefaultEmptySession = useCallback(
    async ({ excludedAgentIds = [] }: { excludedAgentIds?: Iterable<string> } = {}) => {
      closeSurface()
      setPendingLocateMessageId(undefined)
      // Drop any stale optimistic session while we resolve which agent to create for; the create
      // path below sets the new pending, or we fall through to the missing-agent screen.
      setPendingSession(null)

      const excluded = new Set(excludedAgentIds)
      const rememberedAgent =
        lastUsedAgentId && !excluded.has(lastUsedAgentId)
          ? agents.find((agent) => agent.id === lastUsedAgentId)
          : undefined
      const defaultAgent = rememberedAgent ?? agents.find((agent) => !excluded.has(agent.id))
      if (!defaultAgent) {
        setActiveSessionId(null)
        setMissingAgentSelection(true)
        return null
      }

      return createAndActivateEmptySession({ agentId: defaultAgent.id })
    },
    [agents, closeSurface, createAndActivateEmptySession, lastUsedAgentId, setActiveSessionId, setPendingSession]
  )

  // Stable wrapper for the classic-layout rail's per-agent "new session" action. Adapting the
  // `(agentId) => ...` signature inline at the JSX call site would hand `AgentResourceList` a fresh
  // function every render, defeating its `entities` memo (mirrors the assistant rail's stable ref).
  const handleCreateSessionForAgent = useCallback(
    (agentId: string) => createAndActivateEmptySession({ agentId }),
    [createAndActivateEmptySession]
  )

  const handleMissingAgentSelectionAgentChange = useCallback(
    async (agentId: string | null) => {
      if (!agentId) return
      setSelectingMissingAgent(true)
      try {
        await createAndActivateEmptySession({ agentId })
      } finally {
        setSelectingMissingAgent(false)
      }
    },
    [createAndActivateEmptySession]
  )

  const handleAgentConversationSelect = useCallback(
    async (agentId: string) => {
      if (isCreatingEmptySessionRef.current) return
      isCreatingEmptySessionRef.current = true
      // Close the dialog first so the session/state churn below doesn't refresh it while it's
      // still visible (which reads as a black/white flash + the dialog reopening).
      setAgentCreateOpen(false)
      try {
        // A newly created agent starts without a user workspace. Reuse only a matching system
        // placeholder through the exact derived read; otherwise create a fresh system-backed session.
        const reusableSessions = await loadReusableSessions(agentId, 'system')
        const reusableSession = reusableSessions[0]
        const duplicateEmptySystemSessionIds =
          reusableSession && isSystemWorkspaceSession(reusableSession)
            ? reusableSessions
                .slice(1)
                .filter((session) => isSystemWorkspaceSession(session))
                .map((session) => session.id)
            : []

        let session = reusableSession
        if (!session) {
          const workspaceSource = await resolveCreateWorkspaceSource({ agentId, workspaceMode: 'system' })
          session = await createSession({
            agentId,
            name: '',
            workspace: workspaceSource
          })
        }

        activateSession(session, agentId)
        await deleteDuplicateEmptySystemSessions(duplicateEmptySystemSessionIds)
      } catch (err) {
        logger.error('Failed to create agent session after agent creation', err as Error, { agentId })
        toast.error(formatErrorMessageWithPrefix(err, t('agent.session.create.error.failed')))
      } finally {
        isCreatingEmptySessionRef.current = false
      }
    },
    [
      activateSession,
      createSession,
      deleteDuplicateEmptySystemSessions,
      loadReusableSessions,
      resolveCreateWorkspaceSource,
      t
    ]
  )

  const handleHistorySessionSelect = useCallback(
    async (sessionId: string | null, messageId?: string) => {
      const transition = () => {
        closeSurface()
        setShellPaneOpen(true)
        // Locate (history / global search) should reveal the target in the right session pane. In modern layout
        // this setter is a no-op; classic layout feeds the explicit open intent into the stable AgentChat shell.
        setSessionPaneOpen(true)
        setMissingAgentSelection(false)
        setPendingLocateMessageId(messageId)

        if (!sessionId) {
          void createDefaultEmptySession()
          return
        }

        selectSession(sessionId)
        sessionRevealRequestIdRef.current += 1
        setSessionRevealRequest({
          clearFilters: true,
          clearQuery: true,
          itemId: sessionId,
          requestId: sessionRevealRequestIdRef.current
        })
      }
      let targetSession = sessionId === visibleSession?.id ? visibleSession : undefined
      if (sessionId && !targetSession) {
        try {
          targetSession = await loadSession(sessionId)
        } catch (err) {
          logger.warn('Failed to inspect target session before file navigation', err as Error, { sessionId })
        }
      }
      const preservesFileWorkspace =
        sessionId === visibleSession?.id ||
        (targetSession !== undefined &&
          visibleSession !== null &&
          visibleSession !== undefined &&
          buildAgentFileWorkspaceKey(targetSession.workspaceId, targetSession.workspace?.path) ===
            buildAgentFileWorkspaceKey(visibleSession.workspaceId, visibleSession.workspace?.path))

      if (preservesFileWorkspace) {
        transition()
        return
      }
      requestFileNavigation(transition)
    },
    [
      closeSurface,
      createDefaultEmptySession,
      loadSession,
      requestFileNavigation,
      selectSession,
      setShellPaneOpen,
      setSessionPaneOpen,
      visibleSession
    ]
  )
  const closeHistoryRecords = useCallback(() => {
    closeSurface()
  }, [closeSurface])
  const openHistoryRecords = useCallback(() => {
    toggleHistoryRecords()
  }, [toggleHistoryRecords])
  const handleHistoryRecordsSessionSelect = useCallback(
    (sessionId: string | null) => {
      void handleHistorySessionSelect(sessionId)
    },
    [handleHistorySessionSelect]
  )
  const handleGlobalSearchSessionSelect = useEffectEvent((sessionId: string, messageId?: string) => {
    void handleHistorySessionSelect(sessionId, messageId)
  })

  useEffect(() => {
    const unsubscribeSession = EventEmitter.on(EVENT_NAMES.GLOBAL_SEARCH_SELECT_AGENT_SESSION, (payload) => {
      const selection = payload as GlobalSearchAgentSessionSelectionPayload
      if (!selection.sessionId || !isGlobalSearchSelectionForTab(selection, currentTabId)) return

      handleGlobalSearchSessionSelect(selection.sessionId)
    })
    const unsubscribeMessage = EventEmitter.on(EVENT_NAMES.GLOBAL_SEARCH_SELECT_AGENT_SESSION_MESSAGE, (payload) => {
      const selection = payload as GlobalSearchAgentSessionMessageSelectionPayload
      if (!selection.sessionId || !selection.messageId || !isGlobalSearchSelectionForTab(selection, currentTabId))
        return

      handleGlobalSearchSessionSelect(selection.sessionId, selection.messageId)
    })

    return () => {
      unsubscribeSession()
      unsubscribeMessage()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `useEffectEvent` reads latest tab/session state without resubscribing.
  }, [currentTabId])

  const runFeedbackIntent = useEffectEvent(async (intentGuardCacheKey: string) => {
    initialEmptySessionEvaluatedRef.current = true
    closeSurface()
    setPendingLocateMessageId(undefined)
    setMissingAgentSelection(false)
    try {
      if (!routeSessionId || !routeFeedbackComposerLaunch) {
        throw new Error('Feedback intent is missing its prepared session')
      }
      try {
        await invalidateCache(['/agents', '/agent-sessions', `/agent-sessions/${routeSessionId}`])
      } catch (err) {
        logger.warn('Failed to refresh Agent cache for prepared feedback session', err as Error, {
          sessionId: routeSessionId
        })
      }
      setFeedbackComposerLaunch(routeFeedbackComposerLaunch)
    } catch (err) {
      setFeedbackComposerLaunch(null)
      logger.error('Failed to prepare Cherry Assistant feedback session', err as Error)
      toast.error(t('settings.about.feedback.agent_error'))
      showMissingAgentSelection()
    } finally {
      try {
        await navigate({
          to: '/app/agents',
          search: routeSessionId ? { sessionId: routeSessionId } : {},
          replace: true
        })
      } finally {
        cacheService.deleteCasual(intentGuardCacheKey)
      }
    }
  })

  useEffect(() => {
    if (!isFeedbackIntent || !currentTabId) return
    const intentGuardCacheKey = getFeedbackIntentGuardCacheKey(currentTabId)
    if (cacheService.hasCasual(intentGuardCacheKey)) return
    cacheService.setCasual(intentGuardCacheKey, true, FEEDBACK_INTENT_GUARD_TTL_MS)
    void runFeedbackIntent(intentGuardCacheKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `useEffectEvent` reads the latest feedback orchestration without resubscribing.
  }, [currentTabId, isFeedbackIntent, routeSessionId])

  // First-entry create. Resume/latest entry lives in the route interceptor now: this page only
  // reaches here bare when nothing was resolvable (empty session list), which creates a default
  // session once the agent list can pick a target (or surfaces agent selection when none exist).
  // Unlike HomePage — which dropped its equivalent effect — this is the main path, not a fallback:
  // nothing seeds a session into a fresh database, so every first agent entry lands here.
  useEffect(() => {
    if (initialEmptySessionEvaluatedRef.current) return

    if (isFeedbackIntent) return

    if (isMessageOnlyView) {
      initialEmptySessionEvaluatedRef.current = true
      return
    }

    if (missingAgentSelection) {
      initialEmptySessionEvaluatedRef.current = true
      return
    }

    if (activeSessionId) {
      // A URL-bound entry: keep waiting while it loads (or retries after a non-NOT_FOUND
      // error — the recovery effect above owns the missing case). Mark the entry complete
      // only once it resolves.
      if (!activeSession) return
      initialEmptySessionEvaluatedRef.current = true
      return
    }

    // No sessions yet: the agent list must be resolved before deciding create-vs-missing.
    if (isAgentsLoading) return

    if (!agents.length) {
      initialEmptySessionEvaluatedRef.current = true
      setMissingAgentSelection(true)
      return
    }

    initialEmptySessionEvaluatedRef.current = true
    void createDefaultEmptySession()
  }, [
    activeSession,
    activeSessionId,
    agents,
    createDefaultEmptySession,
    isAgentsLoading,
    isFeedbackIntent,
    isMessageOnlyView,
    missingAgentSelection
  ])

  const feedbackLaunch = feedbackComposerLaunch ?? routeFeedbackComposerLaunch
  const visibleFeedbackComposerLaunch = feedbackLaunch?.sessionId === visibleSessionId ? feedbackLaunch : null
  const composerLaunchOptions = useMemo<AgentComposerLaunchOptions | undefined>(() => {
    if (!visibleFeedbackComposerLaunch) return undefined
    const launch = visibleFeedbackComposerLaunch
    return {
      initialDraft: launch.initialDraft,
      onSent: () => {
        setFeedbackComposerLaunch((current) => (current?.sessionId === launch.sessionId ? null : current))
      }
    }
  }, [visibleFeedbackComposerLaunch])

  const setActiveSessionAndClearTransient = useCallback(
    (sessionId: string | null, session?: AgentSessionEntity | null) => {
      activeSessionSelectionRef.current = session ?? null
      closeSurface()
      if (sessionId) {
        if (session) {
          setRightPaneAgentScopeId(
            session.agentId && (isAgentsLoading || agentIdSet.has(session.agentId)) ? session.agentId : 'unlinked'
          )
        }
        setMissingAgentSelection(false)
        selectSession(sessionId, session)
        return
      }
      reenterAgentRoute()
    },
    [agentIdSet, closeSurface, isAgentsLoading, reenterAgentRoute, selectSession]
  )
  const handleResourceSessionSelect = useCallback(
    (sessionId: string, session: AgentSessionEntity) => {
      setActiveSessionAndClearTransient(sessionId, session)
      sessionRevealRequestIdRef.current += 1
      setSessionRevealRequest({
        clearFilters: true,
        clearQuery: true,
        itemId: sessionId,
        requestId: sessionRevealRequestIdRef.current
      })
    },
    [setActiveSessionAndClearTransient]
  )
  // Preserve main's global-latest fallback after deleting the active agent,
  // proving it through the exact derived query instead of a fully-loaded list.
  const handleActiveAgentDeleted = useCallback(
    async (deletedAgentId: string) => {
      const requestId = ++ownerFallbackRequestIdRef.current
      const isCurrent = () =>
        ownerFallbackRequestIdRef.current === requestId && activeSessionSelectionRef.current?.agentId === deletedAgentId

      setRightPaneAgentScopeId(undefined)

      const nextSession = await loadLatestSession()
      if (!isCurrent()) return
      if (nextSession) {
        setActiveSessionAndClearTransient(nextSession.id, nextSession)
        return
      }

      const created = await createDefaultEmptySession({ excludedAgentIds: [deletedAgentId] })
      if (!created && isCurrent()) reenterAgentRoute()
    },
    [createDefaultEmptySession, loadLatestSession, reenterAgentRoute, setActiveSessionAndClearTransient]
  )
  const replaceSessionWorkspace = useCallback(
    async (workspaceId: string | null) => {
      const current = visibleSession
      if (!current) return

      if (workspaceId === null && isSystemWorkspaceSession(current)) return
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

        if (workspaceId) {
          setLastUsedWorkspaceId(workspaceId)
        }
        setActiveSession(updated)
      } finally {
        setReplacingSessionWorkspace(false)
      }
    },
    [replacingSessionWorkspace, setActiveSession, setLastUsedWorkspaceId, setSessionWorkspace, visibleSession]
  )
  const handleLocateMessageHandled = useCallback(() => {
    setPendingLocateMessageId(undefined)
  }, [])

  // Classic layout = entity rail + right session panel; modern layout = the single sidebar (AgentSidePanel).
  const sessionCountByAgentId = useMemo(
    () =>
      new Map(
        (sessionStats?.byAgent ?? []).map(
          ({ agentId, count }) => [agentId ?? 'unlinked', count] as [AgentSessionOwnerScope, number]
        )
      ),
    [sessionStats?.byAgent]
  )
  const sessionResourcePaneCount: ResourcePaneCountButtonProps | undefined =
    isAgentResourceLayout && sessionListPosition === 'right' && selectedAgentScope
      ? {
          label: t('agent.session.list.title'),
          count: sessionCountByAgentId.get(selectedAgentScope) ?? 0
        }
      : undefined
  const setSessionListPosition = useCallback(
    async (position: TopicTabPosition) => {
      await setSessionDisplayMode('agent')
      if (position === 'left') {
        const activeAgentId = visibleSession?.agentId
        const collapsedAgentGroupIds = Array.from(
          new Set(
            (sessionStats?.byAgent ?? [])
              .map(({ agentId }) => agentId)
              .filter((agentId): agentId is string => !!agentId && agentId !== activeAgentId)
              .map((agentId) => `session:agent:${agentId}`)
          )
        )
        cacheService.setPersist('ui.agent.session.expansion.agent', collapsedAgentGroupIds)
      }
      await setPanePosition(position)
      setSessionPaneOpen(position === 'right', { force: true })
      setShellPaneOpen(true)
    },
    [
      setPanePosition,
      setShellPaneOpen,
      setSessionDisplayMode,
      setSessionPaneOpen,
      sessionStats?.byAgent,
      visibleSession?.agentId
    ]
  )
  const pane =
    isAgentResourceLayout && sessionListPosition === 'right' ? (
      <AgentResourceList
        activeAgentId={activeResourceAgentId}
        dataEnabled={shellPaneOpen}
        agentSessionsSource={agentSessionsSource}
        onAddAgent={() => {
          setAgentCreateOpen(true)
        }}
        historyRecordsActive={historyRecordsActive}
        onOpenHistoryRecords={isWindowFrame ? undefined : openHistoryRecords}
        onSelectSession={handleResourceSessionSelect}
        onSelectedAgentClick={() => {
          closeSurface()
          if (!sessionPaneOpen) setSessionPaneUserOpenIntentSeq((seq) => seq + 1)
          setSessionPaneOpen(!sessionPaneOpen)
        }}
        onCreateSession={handleCreateSessionForAgent}
        onShowMissingAgentSelection={showMissingAgentSelection}
        manageAgentsActive={manageAgentsActive}
        onManageAgents={onManageAgents}
        onActiveAgentDeleted={handleActiveAgentDeleted}
      />
    ) : (
      <AgentSidePanel
        activeSession={visibleSession}
        activeSessionId={activeSessionId}
        dataEnabled={shellPaneOpen}
        agentSessionsSource={agentSessionsSource}
        onActiveAgentDeleted={handleActiveAgentDeleted}
        onAddAgent={() => {
          setAgentCreateOpen(true)
        }}
        historyRecordsActive={historyRecordsActive}
        revealRequest={sessionRevealRequest}
        onOpenHistoryRecords={isWindowFrame ? undefined : openHistoryRecords}
        onCreateSession={createAndActivateEmptySession}
        onShowMissingAgentSelection={isMessageOnlyView ? undefined : showMissingAgentSelection}
        onSetPanePosition={isWindowFrame ? undefined : setSessionListPosition}
        panePosition="left"
        manageAgentsActive={manageAgentsActive}
        onManageAgents={onManageAgents}
        setActiveSessionId={setActiveSessionAndClearTransient}
      />
    )
  // In classic layout the session list moves into AgentChat's stable right-pane capability catalog.
  // The config stays mounted while AgentChat swaps its conversation and center-surface content.
  const resourcePane: ResourcePaneConfig | null =
    isAgentResourceLayout && sessionListPosition === 'right'
      ? {
          label: t('agent.session.list.title'),
          node: (
            <Sessions
              activeSession={visibleSession}
              agentSessionsSource={agentSessionsSource}
              dataEnabled={sessionPaneOpen}
              presentation="right-panel"
              activeSessionId={activeSessionId}
              agentIdFilter={selectedAgentScope}
              onActiveAgentDeleted={handleActiveAgentDeleted}
              revealRequest={sessionRevealRequest}
              onCreateSession={createAndActivateEmptySession}
              onShowMissingAgentSelection={isMessageOnlyView ? undefined : showMissingAgentSelection}
              onSetPanePosition={setSessionListPosition}
              panePosition="right"
              setActiveSessionId={setActiveSessionAndClearTransient}
            />
          )
        }
      : null
  const resourceCenter = useMemo(
    () =>
      activeResourceKind
        ? {
            className: 'relative',
            content: (
              <ConversationResourceView
                kind={activeResourceKind}
                toolbarLeading={
                  !isMessageOnlyView && !isWindowFrame ? (
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
    [activeResourceKind, isMessageOnlyView, isWindowFrame, shellPaneOpen, toggleShellPane]
  )
  const historyRecordsCenter = historyRecordsActive
    ? {
        className: 'relative',
        content: (
          <HistoryRecordsView
            mode="agent"
            open={historyRecordsActive && !isMessageOnlyView && !isWindowFrame}
            activeRecordId={activeSessionId}
            onClose={closeHistoryRecords}
            onRecordSelect={handleHistoryRecordsSessionSelect}
            toolbarLeading={
              !isMessageOnlyView && !isWindowFrame ? (
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
  const centerSurface = historyRecordsCenter ?? resourceCenter

  return (
    <Container>
      <div className="flex min-w-0 flex-1 shrink flex-row overflow-hidden">
        <AgentChat
          centerSurface={centerSurface}
          conversationBootstrap={conversationBootstrap}
          pane={pane}
          paneOpen={shellPaneOpen}
          panePosition="left"
          onPaneCollapse={() => setShellPaneOpenManually(false)}
          onPaneAutoCollapseChange={handlePaneAutoCollapseChange}
          onFileNavigationRequestChange={handleFileNavigationRequestChange}
          requestFileNavigation={requestFileNavigation}
          paneManualToggle={paneManualToggle}
          showResourceListControls={!isMessageOnlyView}
          sidebarOpen={shellPaneOpen}
          onSidebarToggle={toggleShellPane}
          missingAgentSelection={!isMessageOnlyView && missingAgentSelection && !visibleSession}
          onCreateEmptySession={isMessageOnlyView ? undefined : createAndActivateEmptySession}
          onMissingAgentSelectionAgentChange={isMessageOnlyView ? undefined : handleMissingAgentSelectionAgentChange}
          onSessionWorkspaceChange={isMessageOnlyView ? undefined : replaceSessionWorkspace}
          onVisibleAgentChange={isMessageOnlyView ? undefined : setLastUsedAgentId}
          onVisibleWorkspaceChange={isMessageOnlyView ? undefined : setLastUsedWorkspaceId}
          locateMessageId={pendingLocateMessageId}
          onLocateMessageHandled={handleLocateMessageHandled}
          selectingMissingAgent={selectingMissingAgent}
          replacingSessionWorkspace={replacingSessionWorkspace}
          resourcePane={resourcePane}
          resourcePaneCount={sessionResourcePaneCount}
          resourcePaneRevealRequest={sessionRevealRequest}
          sessionPaneOpen={isAgentResourceLayout ? sessionPaneOpen : undefined}
          onSessionPaneOpenChange={isAgentResourceLayout ? setSessionPaneOpen : undefined}
          sessionPaneUserOpenIntentSeq={sessionPaneUserOpenIntentSeq}
          composerLaunchOptions={composerLaunchOptions}
        />
      </div>
      <AgentCreateDialog
        open={agentCreateOpen}
        onOpenChange={setAgentCreateOpen}
        onCreated={handleAgentConversationSelect}
      />
    </Container>
  )
}

const Container = ({ children, className }: PropsWithChildren<{ className?: string }>) => {
  return (
    <div
      data-ui="agent.view"
      id="agent-page"
      className={cn('relative flex flex-1 flex-col overflow-hidden', className)}>
      {children}
    </div>
  )
}

export default AgentPage
