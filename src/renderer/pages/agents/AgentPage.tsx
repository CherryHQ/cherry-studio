import { cacheService } from '@data/CacheService'
import { dataApiService } from '@data/DataApiService'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import type { ResourcePaneConfig, ResourcePaneCountButtonProps } from '@renderer/components/chat/panes/Shell'
import { AgentResourceList } from '@renderer/components/chat/resourceList/AgentResourceList'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resourceList/base'
import { ConversationSidebarToggleButton } from '@renderer/components/chat/shell/ConversationSidebarToggleButton'
import {
  createRecentSessionEntryFromSession,
  upsertGlobalSearchRecentEntry
} from '@renderer/components/GlobalSearch/globalSearchGroups'
import {
  type GlobalSearchAgentSessionMessageSelectionPayload,
  type GlobalSearchAgentSessionSelectionPayload,
  isGlobalSearchSelectionForTab
} from '@renderer/components/GlobalSearch/globalSearchSelectionEvents'
import HistoryRecordsView from '@renderer/components/history/HistoryRecordsView'
import { ConversationResourceView } from '@renderer/components/resourceCatalog/conversation'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useAgent, useAgents } from '@renderer/hooks/agent/useAgent'
import {
  useActiveSession,
  useLatestSession,
  useSession,
  useSessionMutations,
  useUpdateSession
} from '@renderer/hooks/agent/useSession'
import { useCommandHandler } from '@renderer/hooks/command'
import { useAgentSessionsSource } from '@renderer/hooks/resourceViewSources'
import { useCurrentTab, useCurrentTabId, useIsActiveTab, useTabSelfMetadata } from '@renderer/hooks/tab'
import {
  type ConversationCenterResourceDefinition,
  useConversationCenterSurface
} from '@renderer/hooks/useConversationCenterSurface'
import { useResourcePaneOpen } from '@renderer/hooks/useResourcePaneOpen'
import { useWindowFrame } from '@renderer/hooks/useWindowFrame'
import { ipcApi } from '@renderer/ipc'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { ResourceListRevealPayload } from '@renderer/services/resourceListRevealEvents'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { cn } from '@renderer/utils/style'
import { getTabInstanceKey } from '@renderer/utils/tabInstanceMetadata'
import type { AgentSessionEntity, AgentSessionOwnerScope } from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE, type AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import type { TopicTabPosition } from '@shared/data/preference/preferenceTypes'
import { MIN_WINDOW_HEIGHT, SECOND_MIN_WINDOW_WIDTH } from '@shared/utils/window'
import { useSearch } from '@tanstack/react-router'
import { Bot, ToolCase } from 'lucide-react'
import type { PropsWithChildren } from 'react'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AgentChat from './AgentChat'
import AgentSidePanel from './AgentSidePanel'
import { AgentCreateDialog } from './components/AgentCreateDialog'
import Sessions from './components/Sessions'
import { parseAgentRouteSearch } from './routeSearch'
import type { CreateAgentSessionDefaults } from './types'

const logger = loggerService.withContext('AgentPage')
type AgentConversationResourceKind = 'agent' | 'skill'

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
  const [detachedSidebarOpen, setDetachedSidebarOpen] = useState(false)
  const [sessionDisplayMode, setSessionDisplayMode] = usePreference('agent.session.display_mode')
  const [panePosition, setPanePosition] = usePreference('agent.session.position')
  const [autoCollapsedResourceList, setAutoCollapsedResourceList] = useState(false)
  const isAgentResourceLayout = sessionDisplayMode === 'agent'
  const routeSearch = parseAgentRouteSearch(useSearch({ strict: false }) as Record<string, unknown>)
  const currentTab = useCurrentTab()
  const routeSessionId = routeSearch.sessionId
  const tabMetadataSessionId = currentTab ? getTabInstanceKey(currentTab, 'agents') : undefined
  const isMessageOnlyView = routeSearch.view === 'message' && !!routeSessionId
  // Shared session facts plus exact derived lookups for rails, restore, and placeholder reuse.
  const agentSessionsSource = useAgentSessionsSource({ enabled: !isMessageOnlyView })

  const { stats: sessionStats, loadLatestSession, loadReusableSessions } = agentSessionsSource
  // First-entry selection resumes the most-recently-active session. A dedicated `lastActivityAt DESC LIMIT 1`
  // query proves the global latest, so it neither waits for the full session history to paginate in nor
  // depends on either independently paged `/agent-sessions` stream or its visible ordering.
  const { latestSession, isLoading: isLatestSessionLoading } = useLatestSession({ enabled: !isMessageOnlyView })
  const isLatestSessionReady = isMessageOnlyView || !isLatestSessionLoading
  const isWindowFrame = useWindowFrame().mode === 'window'
  const requestedSidebarOpen = isWindowFrame ? detachedSidebarOpen : showSidebar
  const effectiveShowSidebar = !isMessageOnlyView && requestedSidebarOpen && !autoCollapsedResourceList
  const { session: routeSession, isLoading: isRouteSessionLoading } = useSession(
    isMessageOnlyView ? routeSessionId : null
  )
  const { agents, isLoading: isAgentsLoading } = useAgents()
  const agentIdSet = useMemo(() => new Set(agents.map((agent) => agent.id)), [agents])
  const routeActiveSessionId = isMessageOnlyView ? null : (routeSessionId ?? tabMetadataSessionId ?? null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => routeActiveSessionId)
  const [isSelectedAgentScopeEmpty, setIsSelectedAgentScopeEmpty] = useState(false)
  const syncedRouteActiveSessionIdRef = useRef(routeActiveSessionId)
  // Classic-layout (rail) session-pane open state, cached on the agent surface's own key so it
  // survives app/page re-entry without bleeding into the assistant surface.
  const [sessionPaneOpen, setSessionPaneOpen] = useResourcePaneOpen('agent', {
    enabled: isAgentResourceLayout,
    defaultOpen: !isWindowFrame && panePosition === 'right'
  })
  const isCreatingEmptySessionRef = useRef(false)

  useEffect(() => {
    const previousRouteActiveSessionId = syncedRouteActiveSessionIdRef.current
    syncedRouteActiveSessionIdRef.current = routeActiveSessionId
    if (routeActiveSessionId) setIsSelectedAgentScopeEmpty(false)

    // A pending session left over from the previous route no longer matches the new active id, so
    // `useActiveSession` ignores it — no need to null it here.
    setActiveSessionId((currentActiveSessionId) => {
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
  const [sessionExpansionAgent, setSessionExpansionAgent] = usePersistCache('ui.agent.session.expansion.agent')
  const lastRecordedRecentSessionRef = useRef<string | undefined>(undefined)
  const [sessionRevealRequest, setSessionRevealRequest] = useState<ResourceListRevealRequest>()
  const [pendingLocateMessageId, setPendingLocateMessageId] = useState<string | undefined>()
  const sessionRevealRequestIdRef = useRef(0)
  const ownerFallbackRequestIdRef = useRef(0)
  const initialEmptySessionEvaluatedRef = useRef(false)
  const [selectingMissingAgent, setSelectingMissingAgent] = useState(false)
  const [replacingSessionWorkspace, setReplacingSessionWorkspace] = useState(false)
  const [missingAgentSelection, setMissingAgentSelection] = useState(false)
  const [agentCreateOpen, setAgentCreateOpen] = useState(false)
  const { t } = useTranslation()
  const { createSession, deleteSessions } = useSessionMutations()
  const { setSessionWorkspace } = useUpdateSession()
  const {
    session: activeSession,
    isLoading: isActiveSessionLoading,
    sessionSource: activeSessionSource,
    setActiveSession,
    selectSession,
    clearActiveSession,
    setPendingSession
  } = useActiveSession({
    activeSessionId,
    setActiveSessionId
  })
  const lastVisibleSessionRef = useRef<AgentSessionEntity | null>(null)
  const visibleSession = isMessageOnlyView
    ? routeSession
    : isSelectedAgentScopeEmpty
      ? null
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
    setIsSelectedAgentScopeEmpty(false)
  }, [visibleSessionId, visibleSessionOwnerScope])
  const selectedAgentScope =
    isAgentResourceLayout && panePosition === 'right' && rightPaneAgentScopeId !== undefined
      ? rightPaneAgentScopeId
      : visibleSessionOwnerScope
  const activeResourceAgentId = selectedAgentScope && selectedAgentScope !== 'unlinked' ? selectedAgentScope : null
  const resourceConversationKey = useMemo(() => {
    if (visibleSession?.id) return `session:${visibleSession.id}`
    if (missingAgentSelection) return 'missing-agent-selection'
    return 'empty'
  }, [missingAgentSelection, visibleSession?.id])
  const resourceViewDefinitions = useMemo<
    readonly ConversationCenterResourceDefinition<AgentConversationResourceKind>[]
  >(
    () => [
      {
        icon: <Bot />,
        id: 'agent-resource-view',
        kind: 'agent',
        label: t('chat.resource_view.menu.agent')
      },
      {
        icon: <ToolCase />,
        id: 'skill-resource-view',
        kind: 'skill',
        label: t('chat.resource_view.menu.skill')
      }
    ],
    [t]
  )
  const {
    activeResourceKind,
    closeSurface,
    historyActive: historyRecordsActive,
    resourceMenuItems,
    toggleHistory: toggleHistoryRecords
  } = useConversationCenterSurface<AgentConversationResourceKind>({
    conversationKey: resourceConversationKey,
    resourceDefinitions: resourceViewDefinitions,
    disabled: isMessageOnlyView || isWindowFrame
  })
  // All non-dormant tabs mount at once (Activity keep-alive), so each agent tab runs its
  // own AgentPage. `useIsActiveTab` answers "am I the globally-focused tab" (gates last_used).
  const isActiveTab = useIsActiveTab()
  const currentTabId = useCurrentTabId()

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
  const { agent: visibleAgent } = useAgent(activeResourceAgentId)
  const tabInstanceSessionId = !isMessageOnlyView
    ? (visibleSession?.id ?? (!isSelectedAgentScopeEmpty ? (routeActiveSessionId ?? undefined) : undefined))
    : undefined
  useTabSelfMetadata({
    title: visibleSession?.name?.trim() || visibleAgent?.name?.trim() || getDefaultRouteTitle('/app/agents'),
    emoji: visibleAgent?.configuration?.avatar,
    instanceAppId: 'agents',
    instanceKey: tabInstanceSessionId ?? null
  })

  const setResourceListOpen = useCallback(
    (open: boolean) => {
      setAutoCollapsedResourceList(false)
      if (isWindowFrame) {
        setDetachedSidebarOpen(open)
        return
      }
      void setShowSidebar(open)
    },
    [isWindowFrame, setShowSidebar]
  )
  const handleResourceListAutoCollapseChange = useCallback((collapsed: boolean) => {
    setAutoCollapsedResourceList(collapsed)
  }, [])
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

    const signature = `${activeSession.id}:${activeSession.name}`
    if (lastRecordedRecentSessionRef.current === signature) return

    lastRecordedRecentSessionRef.current = signature
    const recentItems = cacheService.getPersist('ui.global_search.recent_items')
    cacheService.setPersist(
      'ui.global_search.recent_items',
      upsertGlobalSearchRecentEntry(recentItems ?? [], createRecentSessionEntryFromSession(activeSession))
    )
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

  useEffect(() => {
    void ipcApi.request('window.main.set_minimum_size', { width: SECOND_MIN_WINDOW_WIDTH, height: MIN_WINDOW_HEIGHT })
    return () => {
      void ipcApi.request('window.main.reset_minimum_size')
    }
  }, [])

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
        setIsSelectedAgentScopeEmpty(false)
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
        const reusableSessions = await loadReusableSessions(
          agentId,
          workspaceSource.type === AGENT_WORKSPACE_TYPE.SYSTEM ? 'system' : workspaceSource.workspaceId
        )
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
    setIsSelectedAgentScopeEmpty(false)
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
        // Reuse the agent's latest empty placeholder regardless of workspace — the picker resolves a
        // fresh workspace below only when it has to create one.
        const reusableSessions = await loadReusableSessions(agentId)
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
          const workspaceSource = await resolveCreateWorkspaceSource({ agentId })
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
    (sessionId: string | null, messageId?: string) => {
      closeSurface()
      setResourceListOpen(true)
      // Locate (history / global search) should reveal the target in the right session pane. In modern layout
      // this setter is a no-op; classic layout feeds the explicit open intent into the stable AgentChat shell.
      setSessionPaneOpen(true)
      setMissingAgentSelection(false)
      setPendingLocateMessageId(messageId)

      if (!sessionId) {
        activeSessionSelectionRef.current = null
        setIsSelectedAgentScopeEmpty(true)
        selectSession(null, null)
        return
      }

      setIsSelectedAgentScopeEmpty(false)
      selectSession(sessionId)
      sessionRevealRequestIdRef.current += 1
      setSessionRevealRequest({
        clearFilters: true,
        clearQuery: true,
        itemId: sessionId,
        requestId: sessionRevealRequestIdRef.current
      })
    },
    [closeSurface, selectSession, setResourceListOpen, setSessionPaneOpen]
  )
  const closeHistoryRecords = useCallback(() => {
    closeSurface()
  }, [closeSurface])
  const openHistoryRecords = useCallback(() => {
    toggleHistoryRecords()
  }, [toggleHistoryRecords])
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

  useEffect(() => {
    if (initialEmptySessionEvaluatedRef.current) {
      return
    }

    if (isMessageOnlyView) {
      initialEmptySessionEvaluatedRef.current = true
      return
    }

    if (missingAgentSelection || activeSessionId) {
      initialEmptySessionEvaluatedRef.current = true
      return
    }

    // Resume the globally most-recently-active session — both layouts, so switching layout never
    // changes what you land on. Only a genuinely empty list falls through.
    if (!isLatestSessionReady) return

    if (latestSession) {
      initialEmptySessionEvaluatedRef.current = true
      setPendingLocateMessageId(undefined)
      setMissingAgentSelection(false)
      setActiveSession(latestSession)
      return
    }

    // No sessions yet: the agent list must be resolved before deciding create-vs-missing.
    if (isAgentsLoading) return

    if (!agents.length) {
      initialEmptySessionEvaluatedRef.current = true
      if (activeSessionId) {
        setActiveSessionId(null)
      }
      setMissingAgentSelection(true)
      return
    }

    initialEmptySessionEvaluatedRef.current = true
    void createDefaultEmptySession()
  }, [
    activeSessionId,
    agents,
    createDefaultEmptySession,
    isAgentsLoading,
    isLatestSessionReady,
    isMessageOnlyView,
    latestSession,
    missingAgentSelection,
    setActiveSession,
    setActiveSessionId
  ])

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
        setIsSelectedAgentScopeEmpty(false)
        setMissingAgentSelection(false)
      } else if (rightPaneAgentScopeId !== undefined) {
        setIsSelectedAgentScopeEmpty(true)
      }
      selectSession(sessionId, session)
    },
    [agentIdSet, isAgentsLoading, rightPaneAgentScopeId, closeSurface, selectSession]
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
  const handleEmptyAgentSelect = useCallback(
    (agentId: string) => {
      closeSurface()
      setRightPaneAgentScopeId(agentId)
      setIsSelectedAgentScopeEmpty(true)
      setMissingAgentSelection(false)
      setPendingLocateMessageId(undefined)
      setSessionRevealRequest(undefined)
      selectSession(null, null)
    },
    [closeSurface, selectSession]
  )
  // Preserve the deleting surface's owner order and verify each fallback owner
  // through scoped `/latest`; a superseded lookup cannot replace a newer pick.
  const handleActiveAgentDeleted = useCallback(
    async (deletedAgentId: string, candidateAgentIds: readonly string[]) => {
      const requestId = ++ownerFallbackRequestIdRef.current
      const isCurrent = () =>
        ownerFallbackRequestIdRef.current === requestId && activeSessionSelectionRef.current?.agentId === deletedAgentId

      setRightPaneAgentScopeId(undefined)
      setIsSelectedAgentScopeEmpty(false)

      for (const agentId of candidateAgentIds) {
        const nextSession = await loadLatestSession(agentId)
        if (!isCurrent()) return
        if (nextSession) {
          setActiveSessionAndClearTransient(nextSession.id, nextSession)
          return
        }
      }

      if (!isCurrent()) return
      activeSessionSelectionRef.current = null
      setIsSelectedAgentScopeEmpty(true)
      setActiveSessionId(null)
    },
    [loadLatestSession, setActiveSessionAndClearTransient, setActiveSessionId]
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
  const sessionListPosition: TopicTabPosition =
    !isWindowFrame && isAgentResourceLayout && panePosition === 'right' ? 'right' : 'left'
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
      if (position === 'left' && sessionExpansionAgent == null) {
        const activeAgentId = visibleSession?.agentId
        const collapsedAgentGroupIds = Array.from(
          new Set(
            (sessionStats?.byAgent ?? [])
              .map(({ agentId }) => agentId)
              .filter((agentId): agentId is string => !!agentId && agentId !== activeAgentId)
              .map((agentId) => `session:agent:${agentId}`)
          )
        )
        setSessionExpansionAgent(collapsedAgentGroupIds)
      }
      await setPanePosition(position)
      setSessionPaneOpen(position === 'right', { force: true })
      setResourceListOpen(true)
    },
    [
      setPanePosition,
      setResourceListOpen,
      setSessionDisplayMode,
      setSessionExpansionAgent,
      setSessionPaneOpen,
      sessionExpansionAgent,
      sessionStats?.byAgent,
      visibleSession?.agentId
    ]
  )
  const shellPanePosition: TopicTabPosition = 'left'
  const pane =
    isAgentResourceLayout && sessionListPosition === 'right' ? (
      <AgentResourceList
        activeAgentId={activeResourceAgentId}
        agentSessionsSource={agentSessionsSource}
        onAddAgent={() => {
          setAgentCreateOpen(true)
        }}
        historyRecordsActive={historyRecordsActive}
        onOpenHistoryRecords={isWindowFrame ? undefined : openHistoryRecords}
        onSelectSession={handleResourceSessionSelect}
        onSelectEmptyAgent={handleEmptyAgentSelect}
        onSelectedAgentClick={() => {
          closeSurface()
          setSessionPaneOpen(!sessionPaneOpen)
        }}
        onCreateSession={handleCreateSessionForAgent}
        onShowMissingAgentSelection={showMissingAgentSelection}
        resourceMenuItems={resourceMenuItems}
        onActiveAgentDeleted={handleActiveAgentDeleted}
      />
    ) : (
      <AgentSidePanel
        activeSession={visibleSession}
        activeSessionId={activeSessionId}
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
        resourceMenuItems={resourceMenuItems}
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
                skillAgentId={activeResourceAgentId ?? undefined}
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
    [
      activeResourceAgentId,
      activeResourceKind,
      effectiveShowSidebar,
      isMessageOnlyView,
      isWindowFrame,
      toggleResourceListOpen
    ]
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
                  sidebarOpen={effectiveShowSidebar}
                  onSidebarToggle={toggleResourceListOpen}
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
          activeSession={visibleSession}
          activeSessionLoading={isActiveSessionLoading}
          activeSessionSource={activeSessionSource}
          pane={pane}
          lockedSession={isMessageOnlyView ? (routeSession ?? null) : undefined}
          lockedSessionLoading={isMessageOnlyView && isRouteSessionLoading}
          paneOpen={effectiveShowSidebar}
          panePosition={shellPanePosition}
          centerSurface={centerSurface}
          onPaneCollapse={() => setResourceListOpen(false)}
          onPaneAutoCollapseChange={handleResourceListAutoCollapseChange}
          showResourceListControls={!isMessageOnlyView}
          sidebarOpen={effectiveShowSidebar}
          onSidebarToggle={toggleResourceListOpen}
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
    <div id="agent-page" className={cn('relative flex flex-1 flex-col overflow-hidden', className)}>
      {children}
    </div>
  )
}

export default AgentPage
