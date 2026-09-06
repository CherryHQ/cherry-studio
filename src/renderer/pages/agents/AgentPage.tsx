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
import { useActiveSession, useSession, useUpdateSession } from '@renderer/hooks/agent/useSession'
import { useAgentSessionsSource } from '@renderer/hooks/resourceViewSources'
import { useCloseConversationTabs, useCurrentTabId } from '@renderer/hooks/tab'
import { useClassicLayoutRightPaneOpen } from '@renderer/hooks/useClassicLayoutRightPaneOpen'
import { useComposerFocusRequest } from '@renderer/hooks/useComposerFocusRequest'
import { useConversationCenterSurface } from '@renderer/hooks/useConversationCenterSurface'
import { useConversationLocateRequest } from '@renderer/hooks/useConversationLocateRequest'
import { useConversationShellPaneState } from '@renderer/hooks/useConversationShellPaneState'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { ResourceListRevealPayload } from '@renderer/services/resourceListRevealEvents'
import { toast } from '@renderer/services/toast'
import { buildAgentFileWorkspaceKey, buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { cn } from '@renderer/utils/style'
import { isDataApiNotFoundError } from '@shared/data/api/errors'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE, type AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import type { TopicTabPosition } from '@shared/data/preference/preferenceTypes'
import { useNavigate, useSearch } from '@tanstack/react-router'
import type { PropsWithChildren } from 'react'
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AgentChat from './AgentChat'
import AgentSidePanel from './AgentSidePanel'
import { AgentCreateDialog } from './components/AgentCreateDialog'
import type { AgentFileNavigationRequest } from './components/AgentRightPane'
import { AgentTabRuntime } from './components/AgentTabRuntime'
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
  const isClassicSessionLayout = sessionDisplayMode === 'agent'
  const routeSearch = parseAgentRouteSearch(useSearch({ strict: false }) as Record<string, unknown>)
  const navigate = useNavigate()
  const { t } = useTranslation()
  const isFeedbackIntent = routeSearch.intent === 'feedback'
  const currentTabId = useCurrentTabId()
  const routeSessionId = routeSearch.sessionId
  const routeAgentId = routeSearch.agentId
  const isMessageOnlyView = routeSearch.view === 'message' && !!routeSessionId
  const routeActiveSessionId = isMessageOnlyView ? null : (routeSessionId ?? null)
  // Shared full-list source for session UI plus exact latest/reusable lookups.
  const agentSessionsSource = useAgentSessionsSource()
  const { sessions: agentSessions, loadLatestSession, reuseOrCreateSession } = agentSessionsSource
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
    !isWindowFrame && isClassicSessionLayout && panePosition === 'right' ? 'right' : 'left'
  const { session: routeSession, isLoading: isRouteSessionLoading } = useSession(
    isMessageOnlyView ? routeSessionId : null
  )
  const { agents, isLoading: isAgentsLoading } = useAgents()
  const routeAgentExists = !!routeAgentId && agents.some((agent) => agent.id === routeAgentId)
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(() => routeActiveSessionId)
  const requestComposerFocus = useComposerFocusRequest(
    activeSessionId ? buildAgentSessionTopicId(activeSessionId) : null
  )
  const syncedRouteActiveSessionIdRef = useRef(routeActiveSessionId)
  const ownerFallbackRequestIdRef = useRef(0)
  // Page-initiated selection writes the tab URL — the conversation's sole identity channel —
  // and mirrors into state immediately so the UI doesn't wait a router round trip. Route-driven
  // changes (entry interceptor, recovery) flow back through the sync effect below. Clearing
  // (`null`) never navigates: the next selection or the recovery path owns the URL then.
  const setActiveSessionId = useCallback(
    (id: string | null) => {
      ownerFallbackRequestIdRef.current += 1
      setActiveSessionIdState(id)
      if (id && !isMessageOnlyView) {
        void navigate({ to: '/app/agents', search: { sessionId: id }, replace: true })
      }
    },
    [isMessageOnlyView, navigate]
  )
  const [sessionPaneOpen, setSessionPaneOpen] = useClassicLayoutRightPaneOpen('agent', {
    enabled: isClassicSessionLayout,
    defaultOpen: !isWindowFrame && panePosition === 'right'
  })
  const isCreatingEmptySessionRef = useRef(false)
  const routeAgentActivationGenerationRef = useRef(0)
  const routeAgentSessionRequestRef = useRef<{
    agentId: string
    promise: Promise<AgentSessionEntity>
  } | null>(null)

  useLayoutEffect(() => {
    ownerFallbackRequestIdRef.current += 1
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
    return () => {
      ownerFallbackRequestIdRef.current += 1
    }
  }, [routeActiveSessionId])
  const [lastUsedAgentId, setLastUsedAgentId] = usePersistCache('ui.agent.last_used_agent_id')
  const [lastUsedWorkspaceId, setLastUsedWorkspaceId] = usePersistCache('ui.agent.last_used_workspace_id')
  const lastRecordedRecentSessionRef = useRef<string | undefined>(undefined)
  const [sessionRevealRequest, setSessionRevealRequest] = useState<ResourceListRevealRequest>()
  const sessionRevealRequestIdRef = useRef(0)
  const routeFeedbackComposerLaunch = useMemo<FeedbackComposerLaunch | null>(
    () =>
      isFeedbackIntent && routeSessionId
        ? createFeedbackComposerLaunch(routeSessionId, t('settings.about.feedback.agent.description'))
        : null,
    [isFeedbackIntent, routeSessionId, t]
  )
  const [feedbackComposerLaunch, setFeedbackComposerLaunch] = useState<FeedbackComposerLaunch | null>(
    routeFeedbackComposerLaunch
  )
  const [selectingMissingAgent, setSelectingMissingAgent] = useState(false)
  const [replacingSessionWorkspace, setReplacingSessionWorkspace] = useState(false)
  const [missingAgentSelection, setMissingAgentSelection] = useState(false)
  const [pendingSessionDefaults, setPendingSessionDefaults] = useState<CreateAgentSessionDefaults | null>(null)
  const [agentCreateOpen, setAgentCreateOpen] = useState(false)
  const invalidateCache = useInvalidateCache()
  const closeConversationTabs = useCloseConversationTabs()
  const { setSessionWorkspace } = useUpdateSession()
  useEffect(() => {
    if (
      activeSessionId ||
      agents.length > 0 ||
      isAgentsLoading ||
      isFeedbackIntent ||
      isMessageOnlyView ||
      missingAgentSelection
    ) {
      return
    }

    setMissingAgentSelection(true)
  }, [activeSessionId, agents.length, isAgentsLoading, isFeedbackIntent, isMessageOnlyView, missingAgentSelection])
  const initialActiveSession = useMemo(
    () => (activeSessionId ? agentSessions.find((session) => session.id === activeSessionId) : undefined),
    [activeSessionId, agentSessions]
  )
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
    setActiveSessionId,
    initialSession: initialActiveSession
  })
  const reenterAgentRoute = useCallback(() => {
    // The bound session is gone. Drop the remembered id too: `ui.agent.last_used_session_id`
    // is never cleared on delete, so without this the bare re-entry re-reads the stale id in
    // `resolveAgentEntrySessionId`, 404s, and the NOT_FOUND recovery fires again — a navigate
    // loop React aborts as a maximum-update-depth render error that tears down the window.
    cacheService.setPersist('ui.agent.last_used_session_id', null)
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
    : (activeSession ??
      (isActiveSessionLoading && lastVisibleSessionRef.current?.id === activeSessionId
        ? lastVisibleSessionRef.current
        : null))
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
  // own AgentPage.
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
  // While the bound session is still loading, keep the tab's stored title/icon instead of stamping
  // a generic one.
  const targetSessionId = isMessageOnlyView ? routeSessionId : (activeSessionId ?? undefined)
  const { locateMessageId, requestLocate, clearLocate } = useConversationLocateRequest({
    activeConversationId: targetSessionId,
    visibleConversationId: visibleSession?.id
  })
  const preserveTabVisuals = !!targetSessionId && visibleSession?.id !== targetSessionId

  const [sessionPaneUserOpenIntentSeq, setSessionPaneUserOpenIntentSeq] = useState(0)

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

      const targetAgentId = defaults.agentId ?? fallbackSession?.agentId
      const defaultWorkspaceId = targetAgentId
        ? agents.find((agent) => agent.id === targetAgentId)?.configuration?.default_workspace_id
        : undefined
      if (defaultWorkspaceId) {
        try {
          await dataApiService.get(`/agent-workspaces/${defaultWorkspaceId}`)
          return { type: AGENT_WORKSPACE_TYPE.USER, workspaceId: defaultWorkspaceId }
        } catch (err) {
          logger.warn('Configured default workspace is unavailable for new agent session', err as Error, {
            agentId: targetAgentId,
            workspaceId: defaultWorkspaceId
          })
          throw new Error(t('agent.session.workspace_selector.select_failed'))
        }
      }

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
    [agents, lastUsedWorkspaceId, setLastUsedWorkspaceId, t]
  )

  const activateSession = useCallback(
    (session: AgentSessionEntity, fallbackAgentId?: string | null) => {
      clearLocate()
      setMissingAgentSelection(false)
      setPendingSessionDefaults(null)
      const agentId = session.agentId ?? fallbackAgentId
      if (agentId) {
        rememberLastUsedSession(agentId, isUserWorkspaceSession(session) ? session.workspaceId : undefined)
      }
      setActiveSession(session)
      closeSurface()
      requestComposerFocus(buildAgentSessionTopicId(session.id))
    },
    [clearLocate, closeSurface, rememberLastUsedSession, requestComposerFocus, setActiveSession]
  )

  const resolveEmptySession = useCallback(
    async (agentId: string, defaults: CreateAgentSessionDefaults = {}): Promise<AgentSessionEntity> => {
      const workspaceSource = await resolveCreateWorkspaceSource(defaults, visibleSession)
      const result = await reuseOrCreateSession(agentId, workspaceSource)

      closeConversationTabs('agents', result.deletedDuplicateSessionIds)
      if (result.created || result.deletedDuplicateSessionIds.length > 0) {
        void invalidateCache([
          '/agent-sessions',
          '/agent-workspaces',
          `/agent-sessions/${result.session.id}`,
          ...result.deletedDuplicateSessionIds.map((sessionId) => `/agent-sessions/${sessionId}`)
        ]).catch((err) => {
          logger.warn('Failed to refresh session metadata after placeholder resolution', err as Error)
        })
      }

      return result.session
    },
    [closeConversationTabs, invalidateCache, resolveCreateWorkspaceSource, reuseOrCreateSession, visibleSession]
  )

  const createAndActivateEmptySession = useCallback(
    async (defaults: CreateAgentSessionDefaults = {}): Promise<AgentSessionEntity | null> => {
      if (isCreatingEmptySessionRef.current) return null
      isCreatingEmptySessionRef.current = true
      // A sidebar `?agentId=` entry whose agent has no sessions yet falls through to the page;
      // create for that exact agent rather than whatever session happens to be visible.
      const agentId =
        defaults.agentId === undefined ? (visibleSession?.agentId ?? routeAgentId ?? null) : defaults.agentId
      try {
        closeSurface()

        if (!agentId) {
          clearLocate()
          setPendingSessionDefaults(defaults)
          clearActiveSession()
          setMissingAgentSelection(true)
          return null
        }

        const session = await resolveEmptySession(agentId, defaults)
        activateSession(session, agentId)
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
      clearLocate,
      closeSurface,
      resolveEmptySession,
      routeAgentId,
      t,
      visibleSession?.agentId
    ]
  )

  useEffect(() => {
    const generation = ++routeAgentActivationGenerationRef.current
    if (!routeAgentId || routeSessionId || activeSessionId || isAgentsLoading || !routeAgentExists) return

    closeSurface()
    const pendingRequest = routeAgentSessionRequestRef.current
    const routeAgentDefaults = agents.find((agent) => agent.id === routeAgentId)?.configuration?.default_workspace_id
      ? { agentId: routeAgentId }
      : { agentId: routeAgentId, workspaceMode: 'system' as const }
    const sessionPromise =
      pendingRequest?.agentId === routeAgentId
        ? pendingRequest.promise
        : resolveEmptySession(routeAgentId, routeAgentDefaults)
    routeAgentSessionRequestRef.current = { agentId: routeAgentId, promise: sessionPromise }

    void sessionPromise
      .then((session) => {
        if (generation !== routeAgentActivationGenerationRef.current) return
        activateSession(session, routeAgentId)
      })
      .catch((err) => {
        if (generation !== routeAgentActivationGenerationRef.current) return
        logger.error('Failed to create empty agent session', err as Error, { agentId: routeAgentId })
        toast.error(formatErrorMessageWithPrefix(err, t('agent.session.create.error.failed')))
      })
      .finally(() => {
        if (routeAgentSessionRequestRef.current?.promise === sessionPromise) {
          routeAgentSessionRequestRef.current = null
        }
      })

    return () => {
      if (generation === routeAgentActivationGenerationRef.current) {
        routeAgentActivationGenerationRef.current += 1
      }
    }
  }, [
    activeSessionId,
    agents,
    activateSession,
    closeSurface,
    isAgentsLoading,
    resolveEmptySession,
    routeAgentExists,
    routeAgentId,
    routeSessionId,
    t
  ])

  const showMissingAgentSelection = useCallback(() => {
    closeSurface()
    clearLocate()
    setPendingSessionDefaults(null)
    clearActiveSession()
    setMissingAgentSelection(true)
  }, [clearActiveSession, clearLocate, closeSurface])

  const createDefaultEmptySession = useCallback(
    async ({ excludedAgentIds = [] }: { excludedAgentIds?: Iterable<string> } = {}) => {
      closeSurface()
      clearLocate()
      // Drop any stale optimistic session while we resolve which agent to create for; the create
      // path below sets the new pending, or we fall through to the missing-agent screen.
      setPendingSession(null)

      const excluded = new Set(excludedAgentIds)
      // A sidebar `?agentId=` entry with no sessions yet starts a fresh session for that
      // exact agent, not whatever was last focused.
      const routeAgent =
        routeAgentId && !excluded.has(routeAgentId) ? agents.find((agent) => agent.id === routeAgentId) : undefined
      const rememberedAgent =
        lastUsedAgentId && !excluded.has(lastUsedAgentId)
          ? agents.find((agent) => agent.id === lastUsedAgentId)
          : undefined
      const defaultAgent = routeAgent ?? rememberedAgent ?? agents.find((agent) => !excluded.has(agent.id))
      if (!defaultAgent) {
        setActiveSessionId(null)
        setPendingSessionDefaults(null)
        setMissingAgentSelection(true)
        return null
      }

      return createAndActivateEmptySession({ agentId: defaultAgent.id })
    },
    [
      agents,
      clearLocate,
      closeSurface,
      createAndActivateEmptySession,
      lastUsedAgentId,
      routeAgentId,
      setActiveSessionId,
      setPendingSession
    ]
  )

  // Stable wrapper for the classic-layout rail's per-agent "new session" action. Adapting the
  // `(agentId) => ...` signature inline at the JSX call site would hand `AgentResourceList` a fresh
  // function every render, defeating its `entities` memo (mirrors the assistant rail's stable ref).
  const handleCreateSessionForAgent = useCallback(
    (agentId: string) => resolveEmptySession(agentId, { agentId }),
    [resolveEmptySession]
  )

  const handleMissingAgentSelectionAgentChange = useCallback(
    async (agentId: string | null) => {
      if (!agentId) return
      setSelectingMissingAgent(true)
      try {
        await createAndActivateEmptySession({ ...pendingSessionDefaults, agentId })
      } finally {
        setSelectingMissingAgent(false)
      }
    },
    [createAndActivateEmptySession, pendingSessionDefaults]
  )

  const handleAgentConversationSelect = useCallback(
    async (agentId: string, createdDefaultWorkspaceId?: string | null) => {
      if (isCreatingEmptySessionRef.current) return
      isCreatingEmptySessionRef.current = true
      // Close the dialog first so the session/state churn below doesn't refresh it while it's
      // still visible (which reads as a black/white flash + the dialog reopening).
      setAgentCreateOpen(false)
      try {
        const persistedDefaultWorkspaceId = agents.find((agent) => agent.id === agentId)?.configuration
          ?.default_workspace_id
        const effectiveDefaultWorkspaceId = createdDefaultWorkspaceId ?? persistedDefaultWorkspaceId
        const createdAgentDefaults = effectiveDefaultWorkspaceId
          ? { agentId, workspaceId: effectiveDefaultWorkspaceId }
          : { agentId, workspaceMode: 'system' as const }
        const session = await resolveEmptySession(
          agentId,
          pendingSessionDefaults ? { ...pendingSessionDefaults, agentId } : createdAgentDefaults
        )
        activateSession(session, agentId)
      } catch (err) {
        logger.error('Failed to create agent session after agent creation', err as Error, { agentId })
        toast.error(formatErrorMessageWithPrefix(err, t('agent.session.create.error.failed')))
      } finally {
        isCreatingEmptySessionRef.current = false
      }
    },
    [activateSession, agents, pendingSessionDefaults, resolveEmptySession, t]
  )

  const handleHistorySessionSelect = useCallback(
    (sessionId: string | null, messageId?: string) => {
      const transition = () => {
        closeSurface()
        setShellPaneOpen(true)
        // Locate (history / global search) should reveal the target in the right session pane. In modern layout
        // this setter is a no-op; classic layout feeds the explicit open intent into the stable AgentChat shell.
        setSessionPaneOpen(true)
        setMissingAgentSelection(false)
        setPendingSessionDefaults(null)
        if (sessionId && messageId) {
          requestLocate(sessionId, messageId)
        } else {
          clearLocate()
        }

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
      const targetSession = sessionId ? agentSessions.find((session) => session.id === sessionId) : undefined
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
      agentSessions,
      clearLocate,
      closeSurface,
      createDefaultEmptySession,
      requestFileNavigation,
      requestLocate,
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
      handleHistorySessionSelect(sessionId)
    },
    [handleHistorySessionSelect]
  )
  const handleGlobalSearchSessionSelect = useEffectEvent((sessionId: string, messageId?: string) => {
    handleHistorySessionSelect(sessionId, messageId)
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
    closeSurface()
    clearLocate()
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
      logger.error('Failed to prepare Cherry Support feedback session', err as Error)
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

  const visibleSessionId = visibleSession?.id
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
      closeSurface()
      clearLocate()
      if (!sessionId) {
        reenterAgentRoute()
        return
      }
      setMissingAgentSelection(false)
      setPendingSessionDefaults(null)
      selectSession(sessionId, session)
    },
    [clearLocate, closeSurface, reenterAgentRoute, selectSession]
  )
  const handleResourceSessionSelect = useCallback(
    (sessionId: string, session: AgentSessionEntity) => {
      closeSurface()
      setActiveSessionAndClearTransient(sessionId, session)
    },
    [closeSurface, setActiveSessionAndClearTransient]
  )
  // After deleting the active agent, settle on the latest remaining session or the empty route.
  const handleActiveAgentDeleted = useCallback(
    async (deletedAgentId: string) => {
      const requestId = ++ownerFallbackRequestIdRef.current
      try {
        const nextSession = await loadLatestSession()
        if (requestId !== ownerFallbackRequestIdRef.current) return
        if (nextSession) {
          setActiveSessionAndClearTransient(nextSession.id, nextSession)
          return
        }
        reenterAgentRoute()
      } catch (err) {
        if (requestId !== ownerFallbackRequestIdRef.current) return
        logger.error('Failed to settle agent page after deleting active agent', err as Error, { deletedAgentId })
        toast.error(formatErrorMessageWithPrefix(err, t('agent.session.create.error.failed')))
        reenterAgentRoute()
      }
    },
    [loadLatestSession, reenterAgentRoute, setActiveSessionAndClearTransient, t]
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
  const handleLocateMessageHandled = clearLocate

  // Classic layout = entity rail + right session panel; modern layout = one left navigation panel (AgentSidePanel).
  const activeResourceAgentId = visibleSession?.agentId ?? null
  const sessionResourcePaneCount: ResourcePaneCountButtonProps | undefined =
    isClassicSessionLayout && sessionListPosition === 'right' && activeResourceAgentId
      ? {
          label: t('agent.session.list.title'),
          count: agentSessions.filter((session) => session.agentId === activeResourceAgentId).length
        }
      : undefined
  const setSessionListPosition = useCallback(
    async (position: TopicTabPosition) => {
      await setSessionDisplayMode('agent')
      if (position === 'left') {
        const activeAgentId = visibleSession?.agentId
        const collapsedAgentGroupIds = Array.from(
          new Set(
            agentSessions
              .map((session) => session.agentId)
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
      agentSessions,
      setPanePosition,
      setShellPaneOpen,
      setSessionDisplayMode,
      setSessionPaneOpen,
      visibleSession?.agentId
    ]
  )
  const pane =
    isClassicSessionLayout && sessionListPosition === 'right' ? (
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
    isClassicSessionLayout && sessionListPosition === 'right'
      ? {
          label: t('agent.session.list.title'),
          node: (
            <Sessions
              agentSessionsSource={agentSessionsSource}
              dataEnabled={sessionPaneOpen}
              presentation="right-panel"
              activeSessionId={activeSessionId}
              agentIdFilter={activeResourceAgentId}
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
    <>
      <AgentTabRuntime
        title={visibleSession?.name?.trim() || visibleAgent?.name?.trim() || getDefaultRouteTitle('/app/agents')}
        emoji={visibleAgent?.configuration?.avatar}
        preserveVisuals={preserveTabVisuals}
        activeSessionId={activeSession?.id}
        activeSessionSource={activeSessionSource}
        onToggleSidebar={toggleShellPane}
      />
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
            locateMessageId={locateMessageId}
            onLocateMessageHandled={handleLocateMessageHandled}
            selectingMissingAgent={selectingMissingAgent}
            replacingSessionWorkspace={replacingSessionWorkspace}
            resourcePane={resourcePane}
            resourcePaneCount={sessionResourcePaneCount}
            resourcePaneRevealRequest={sessionRevealRequest}
            sessionPaneOpen={isClassicSessionLayout ? sessionPaneOpen : undefined}
            onSessionPaneOpenChange={isClassicSessionLayout ? setSessionPaneOpen : undefined}
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
    </>
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
