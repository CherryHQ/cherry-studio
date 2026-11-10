import { Folder, FolderOpen, Monitor, Plus } from 'lucide-react'
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Tooltip } from '@cherrystudio/ui'
import { cacheService } from '@data/CacheService'
import { loggerService } from '@logger'
import { actionsToCommandMenuExtraItems } from '@renderer/components/chat/actions/actionMenuItems'
import { archiveAgentSessionsPopup } from '@renderer/components/chat/archiveAgentSessionsPopup'
import {
  deleteConversationOwnerPopup,
  permanentDeletePopup
} from '@renderer/components/chat/DeleteConversationOwnerConfirmDialog'
import {
  renderAgentEntityIcon,
  ResourceList,
  type ResourceListGroup,
  type ResourceListGroupHeaderKind,
  type ResourceListItemReorderPayload,
  type ResourceListPresentation,
  type ResourceListReorderPayload,
  type ResourceListRevealRequest,
  type ResourceListSection,
  SessionListOptionsMenu
} from '@renderer/components/chat/resourceList/base'
import { ResourceRefreshErrorBanner } from '@renderer/components/chat/resourceList/ResourceRefreshErrorBanner'
import { SessionHoverPreviewGroup } from '@renderer/components/chat/resourceList/SessionHoverPreview'
import { SessionResourceList } from '@renderer/components/chat/resourceList/SessionResourceList'
import EditNameDialog from '@renderer/components/EditNameDialog'
import NewConversationIcon from '@renderer/components/icons/NewConversationIcon'
import {
  ResourceEditDialogHost,
  type ResourceEditDialogTarget
} from '@renderer/components/resourceCatalog/dialogs/edit'
import { dataApiService } from '@renderer/data/DataApiService'
import { useDataChange, useInvalidateCache, useMutation, useQuery } from '@renderer/data/hooks/useDataApi'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useAgents } from '@renderer/hooks/agent/useAgent'
import { useUpdateSession } from '@renderer/hooks/agent/useSession'
import { useResolvedCommand } from '@renderer/hooks/command'
import type { AgentSessionsSource } from '@renderer/hooks/resourceViewSources'
import { useCloseConversationTabs } from '@renderer/hooks/tab'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { useCurrentDayStart } from '@renderer/hooks/useCurrentDayStart'
import { useImageCaptureTargets } from '@renderer/hooks/useImageCaptureTargets'
import { useOptimisticResourceName } from '@renderer/hooks/useOptimisticResourceName'
import { usePins } from '@renderer/hooks/usePins'
import { useSidebarShortcuts } from '@renderer/hooks/useSidebarShortcuts'
import { useWindowFrame } from '@renderer/hooks/useWindowFrame'
import { ipcApi } from '@renderer/ipc'
import type { AgentSessionExportOptions } from '@renderer/services/agentSessionExport'
import {
  restoreRecycleBinItem,
  restoreRecycleBinItems,
  restoreRecycleBinUndoGroup,
  showRecycleBinBatchUndo,
  showRecycleBinUndo
} from '@renderer/services/recycleBinFeedback'
import { toast } from '@renderer/services/toast'
import { getAgentModelFallbackSnapshot } from '@renderer/utils/agent'
import { buildAgentFileWorkspaceKey, buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { withSoleGroupLabelHidden } from '@renderer/utils/chat/resourceListBase'
import {
  type AgentSessionDisplayMode,
  buildSessionAgentGroupDropAnchor,
  buildSessionDropAnchor,
  buildSessionWorkdirGroupDropAnchor,
  canDropSessionItemInDisplayGroup,
  deriveSessionListView,
  getAgentIdFromSessionGroupId,
  getWorkdirPathFromSessionGroupId,
  moveSessionAgentGroupAfterDrop,
  moveSessionWorkdirGroupAfterDrop,
  normalizeSessionDropPayload,
  SESSION_AGENT_SECTION_ID,
  SESSION_NO_PROJECT_GROUP_ID,
  SESSION_NO_PROJECT_SECTION_ID,
  SESSION_NO_WORKDIR_GROUP_ID,
  SESSION_PINNED_GROUP_ID,
  SESSION_UNKNOWN_AGENT_GROUP_ID,
  SESSION_WORKDIR_SECTION_ID,
  type SessionListItem,
  type SessionListViewOptions
} from '@renderer/utils/chat/sessionListHelpers'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { applyOptimisticOrder, findLatestActive, pickNeighbourAfterRemoval } from '@renderer/utils/resourceEntity'
import {
  createSidebarShortcutTarget,
  getSidebarShortcutResourceIds,
  SIDEBAR_SHORTCUT_PROVIDER_IDS
} from '@renderer/utils/sidebar'
import { isProtectedBuiltinAgentRole } from '@shared/ai/builtinAgent'
import { classifyTurn } from '@shared/ai/transport'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE, type AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'
import type { TopicTabPosition } from '@shared/data/preference/preferenceTypes'
import {
  isAgentNotFoundError,
  isAgentSessionArchiveBusyError,
  isAgentSessionNotFoundError
} from '@shared/ipc/errors/ai'

import { rejectPendingAgentSessionImageActions } from '../../messages/agentSessionImageActionBus'
import { useOptionalAgentFileNavigation } from '../AgentRightPane'
import { type AgentGroupActionContext, executeAgentGroupAction, resolveAgentGroupActions } from './agentGroupActions'
import { buildCreateSessionSeedIndex } from './createSessionSeed'
import { AgentGroupMoreMenu, WorkdirGroupMoreMenu } from './groupMoreMenus'
import { SessionListBody } from './SessionListBody'
import { useSessionCreation } from './useSessionCreation'
import { useSessionExpansion } from './useSessionExpansion'
import { useSessionGroupStructure } from './useSessionGroupStructure'
import { useSessionItemMenuActions } from './useSessionItemMenuActions'
import { useSessionRename } from './useSessionRename'
import { useWorkdirGroupHandlers } from './useWorkdirGroupHandlers'
import {
  executeWorkdirGroupAction,
  resolveWorkdirGroupActions,
  type WorkdirGroupActionContext
} from './workdirGroupActions'
const AgentSessionImageCaptureHost = lazy(() => import('../../messages/AgentSessionImageCaptureHost'))
import type { CreateAgentSessionDefaults } from '../../types'
import { EMPTY_SESSION_LIST_ITEM_RECONCILIATION, reconcileSessionListItems } from './sessionListItemSharing'

type SessionsBaseProps = {
  agentSessionsSource: AgentSessionsSource
  agentIdFilter?: string | null
  dataEnabled?: boolean
  historyRecordsActive?: boolean
  manageAgentsActive?: boolean
  onActiveAgentDeleted?: (agentId: string) => void | Promise<void>
  onAddAgent?: () => void | Promise<void>
  onOpenHistoryRecords?: () => void
  onManageAgents?: () => void | Promise<void>
  onSetPanePosition?: (position: TopicTabPosition) => void | Promise<void>
  onCreateSession?: (
    defaults: CreateAgentSessionDefaults
  ) => AgentSessionEntity | null | void | Promise<AgentSessionEntity | null | void>
  onShowMissingAgentSelection?: () => void | Promise<void>
  /** Active while this list is permanently deleting `id`; `null` when that attempt settles. */
  onLocalPermanentDeletePendingChange?: (id: string | null) => void
  panePosition?: TopicTabPosition
  presentation?: ResourceListPresentation
  revealRequest?: ResourceListRevealRequest
}

type ControlledSessionsProps = SessionsBaseProps & {
  activeSessionId: string | null
  setActiveSessionId: (id: string | null, session?: AgentSessionEntity | null) => void
}

type SessionsProps = ControlledSessionsProps

const logger = loggerService.withContext('AgentSessions')

function isAgentSessionBusy(sessionId: string): boolean {
  const entry = cacheService.getShared(`topic.stream.statuses.${buildAgentSessionTopicId(sessionId)}` as const)
  const flags = classifyTurn(entry?.status)
  return flags.isStreamLive || flags.isAwaitingApproval || (entry?.awaitingApprovalAnchors?.length ?? 0) > 0
}

function permanentAgentDeleteError(err: unknown, message: (key: string) => string): Error {
  if (isAgentNotFoundError(err)) return new Error(message('recycle_bin.delete.stale'))
  if (isAgentSessionArchiveBusyError(err)) return new Error(message('recycle_bin.delete.busy'))
  if (err instanceof Error) return err
  return new Error(message('agent.delete.error.failed'))
}

const EMPTY_WORKSPACE_ROWS: AgentWorkspaceEntity[] = []
// Let the context menu close before mounting the heavier offscreen message list.
const IMAGE_CAPTURE_START_DELAY_MS = 160
const DEFAULT_SESSION_GROUP_VISIBLE_COUNT = 5
const LEFT_PANEL_TIME_SESSION_GROUP_VISIBLE_COUNT = 50

const Sessions = ({
  agentSessionsSource,
  activeSessionId,
  agentIdFilter,
  dataEnabled = true,
  historyRecordsActive,
  manageAgentsActive = false,
  onActiveAgentDeleted,
  onAddAgent,
  onOpenHistoryRecords,
  onManageAgents,
  onSetPanePosition,
  onCreateSession,
  onShowMissingAgentSelection,
  onLocalPermanentDeletePendingChange,
  panePosition,
  presentation = 'left-panel',
  revealRequest,
  setActiveSessionId: setControlledActiveSessionId
}: SessionsProps) => {
  const { t } = useTranslation()
  const isRightPanel = presentation === 'right-panel'
  const conversationNav = useConversationNavigation('agents')
  const isWindowFrame = useWindowFrame().mode === 'window'
  const groupNow = useCurrentDayStart()

  const [sessionDisplayMode, setSessionDisplayMode] = usePreference('agent.session.display_mode')
  const [storedPanePosition, setStoredPanePosition] = usePreference('agent.session.position')
  // Agent session icon style is stored under its own key so it no longer mutates the assistant's.
  const [assistantIconType, setAssistantIconType] = usePreference('agent.icon_type')
  const resolvedPanePosition = panePosition ?? storedPanePosition
  const setResolvedPanePosition =
    panePosition === undefined ? (onSetPanePosition ?? setStoredPanePosition) : onSetPanePosition
  const {
    sessions,
    pinIdBySessionId,
    isLoading,
    isLoadingAll,
    isFullyLoaded,
    isPinsLoading: isSessionPinsLoading,
    error,
    refreshError,
    deleteSession,
    deleteSessionWithOutcome,
    readSessionListItems,
    hasMore,
    isLoadingMore,
    isValidating,
    reload,
    reorderSession,
    restoreSession,
    togglePin
  } = agentSessionsSource
  const { agents, error: agentsError, isLoading: isAgentsLoading, refetch: refetchAgents } = useAgents()
  const listRef = useRef<HTMLDivElement>(null)
  const [optimisticMove, setOptimisticMove] = useState<ResourceListItemReorderPayload | null>(null)
  const [optimisticAgentOrderIds, setOptimisticAgentOrderIds] = useState<string[] | null>(null)
  const [optimisticWorkspaceOrderIds, setOptimisticWorkspaceOrderIds] = useState<string[] | null>(null)
  const [editDialogTarget, setEditDialogTarget] = useState<ResourceEditDialogTarget | null>(null)
  const { queueTarget: queueImageCaptureTarget, targets: imageCaptureTargets } =
    useImageCaptureTargets<AgentSessionEntity>({
      cancelMessage: 'Agent session image export was cancelled',
      delayMs: IMAGE_CAPTURE_START_DELAY_MS,
      rejectPendingActions: rejectPendingAgentSessionImageActions
    })

  const { data: channels, refetch: refetchChannels } = useQuery('/agent-channels', { enabled: dataEnabled })
  useDataChange(dataEnabled ? '/agent-channels' : [], () => void refetchChannels())
  const channelTypeMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const ch of channels ?? []) {
      if (ch.sessionId) map[ch.sessionId] = ch.type
    }
    return map
  }, [channels])

  const displayMode: AgentSessionDisplayMode = isRightPanel
    ? 'time'
    : sessionDisplayMode === 'workdir' || sessionDisplayMode === 'agent'
      ? sessionDisplayMode
      : 'time'
  const defaultGroupVisibleCount =
    !isRightPanel && displayMode === 'time'
      ? LEFT_PANEL_TIME_SESSION_GROUP_VISIBLE_COUNT
      : DEFAULT_SESSION_GROUP_VISIBLE_COUNT
  const isDraggableMode = displayMode !== 'time'
  const dragReady = isDraggableMode && isFullyLoaded && !isLoadingAll && !isLoadingMore && !isValidating && !isLoading
  const {
    isLoading: isAgentPinsLoading,
    isRefreshing: isAgentPinsRefreshing,
    isMutating: isAgentPinsMutating,
    pinnedIds: agentPinnedIds,
    togglePin: toggleAgentPin
  } = usePins('agent', { enabled: dataEnabled && displayMode === 'agent' })
  const isAgentPinActionDisabled = isAgentPinsLoading || isAgentPinsRefreshing || isAgentPinsMutating

  const sessionItemsReconciliationRef = useRef(EMPTY_SESSION_LIST_ITEM_RECONCILIATION)
  const apiBackedSessionItems = useMemo(() => {
    const reconciliation = reconcileSessionListItems(sessions, pinIdBySessionId, sessionItemsReconciliationRef.current)
    sessionItemsReconciliationRef.current = reconciliation
    return reconciliation.items
  }, [pinIdBySessionId, sessions])
  const {
    items: sessionItems,
    rename: renameSessionOptimistically,
    withOptimisticNames
  } = useOptimisticResourceName(apiBackedSessionItems)
  const sessionItemsRef = useRef(sessionItems)
  const activeSessionIdRef = useRef(activeSessionId)
  const togglePinRef = useRef(togglePin)
  const requestFileNavigation = useOptionalAgentFileNavigation()
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null)
  const permanentDeleteLockRef = useRef(false)
  const agentPermanentDeleteLockRef = useRef(false)
  const { shortcutLabel: permanentDeleteShortcut } = useResolvedCommand('resource.delete_permanently')

  useEffect(() => {
    sessionItemsRef.current = sessionItems
  }, [sessionItems])

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  useEffect(() => {
    togglePinRef.current = togglePin
  }, [togglePin])

  const handleToggleSessionPin = useCallback((id: string) => togglePinRef.current(id), [])

  const setTrackedActiveSessionId = useCallback(
    (id: string | null, session?: AgentSessionEntity | null) => {
      activeSessionIdRef.current = id
      setControlledActiveSessionId(id, session)
    },
    [setControlledActiveSessionId]
  )

  const setActiveSessionId = useCallback(
    (id: string | null) => {
      const session = id ? (sessionItemsRef.current.find((candidate) => candidate.id === id) ?? null) : null
      const transition = () => setTrackedActiveSessionId(id, session)
      const activeSession = activeSessionIdRef.current
        ? sessionItemsRef.current.find((candidate) => candidate.id === activeSessionIdRef.current)
        : null
      const preservesFileWorkspace =
        activeSession &&
        session &&
        buildAgentFileWorkspaceKey(activeSession.workspaceId, activeSession.workspace?.path) ===
          buildAgentFileWorkspaceKey(session.workspaceId, session.workspace?.path)
      if (id === activeSessionIdRef.current || preservesFileWorkspace) {
        transition()
        return
      }
      if (requestFileNavigation) {
        requestFileNavigation(transition)
        return
      }
      transition()
    },
    [requestFileNavigation, setTrackedActiveSessionId]
  )

  const { updateSession } = useUpdateSession()

  const agentPinnedIdSet = useMemo(() => new Set(agentPinnedIds), [agentPinnedIds])
  const { shortcuts: sidebarShortcuts, setPinned: setSidebarShortcutPinned } = useSidebarShortcuts()
  const sidebarAgentFavoriteIdSet = useMemo(
    () => getSidebarShortcutResourceIds(sidebarShortcuts, SIDEBAR_SHORTCUT_PROVIDER_IDS.AGENT),
    [sidebarShortcuts]
  )
  const sidebarSessionFavoriteIdSet = useMemo(
    () => getSidebarShortcutResourceIds(sidebarShortcuts, SIDEBAR_SHORTCUT_PROVIDER_IDS.AGENT_SESSION),
    [sidebarShortcuts]
  )
  const handleToggleSessionSidebar = useCallback(
    (session: AgentSessionEntity) => {
      const target = createSidebarShortcutTarget(SIDEBAR_SHORTCUT_PROVIDER_IDS.AGENT_SESSION, session.id)
      setSidebarShortcutPinned(
        target,
        !sidebarSessionFavoriteIdSet.has(session.id),
        session.name.trim() || t('agent.session.new')
      )
    },
    [setSidebarShortcutPinned, sidebarSessionFavoriteIdSet, t]
  )
  const agentsForDisplay = useMemo(
    () => (optimisticAgentOrderIds ? applyOptimisticOrder(agents, optimisticAgentOrderIds) : agents),
    [agents, optimisticAgentOrderIds]
  )
  const agentById = useMemo(() => new Map(agentsForDisplay.map((agent) => [agent.id, agent])), [agentsForDisplay])
  const agentByIdRef = useRef(agentById)
  useEffect(() => {
    agentByIdRef.current = agentById
  }, [agentById])
  const getSessionExportOptions = useCallback(
    (session: AgentSessionEntity): AgentSessionExportOptions => ({
      modelFallback: getAgentModelFallbackSnapshot(session.agentId ? agentById.get(session.agentId) : undefined)
    }),
    [agentById]
  )
  const agentRankById = useMemo(
    () => new Map(agentsForDisplay.map((agent, index) => [agent.id, index])),
    [agentsForDisplay]
  )
  const {
    data: workspaces,
    error: workspacesError,
    isLoading: isWorkspacesLoading,
    isRefreshing: isWorkspacesRefreshing,
    refetch: refetchWorkspaces
  } = useQuery('/agent-workspaces', { enabled: displayMode === 'workdir' })
  useDataChange(displayMode === 'workdir' ? '/agent-workspaces' : [], () => void refetchWorkspaces())
  const workspaceRows = workspaces ?? EMPTY_WORKSPACE_ROWS
  const isWorkdirMetadataLoading = displayMode === 'workdir' && isWorkspacesLoading
  const isWorkdirMetadataRefreshing = displayMode === 'workdir' && isWorkspacesRefreshing
  const workdirDragReady =
    displayMode === 'workdir' && dragReady && !isWorkdirMetadataLoading && !isWorkdirMetadataRefreshing
  const agentDragReady = displayMode === 'agent' && dragReady && !isAgentsLoading
  const itemDragReady = displayMode === 'workdir' ? workdirDragReady : agentDragReady
  const workspaceRowsForDisplay = useMemo(
    () =>
      optimisticWorkspaceOrderIds ? applyOptimisticOrder(workspaceRows, optimisticWorkspaceOrderIds) : workspaceRows,
    [optimisticWorkspaceOrderIds, workspaceRows]
  )
  const workspaceOrderSignature = useMemo(
    () => workspaceRows.map((workspace) => `${workspace.id}:${workspace.orderKey}`).join('|'),
    [workspaceRows]
  )
  const agentOrderSignature = useMemo(
    () => agents.map((agent) => `${agent.id}:${agent.orderKey ?? ''}`).join('|'),
    [agents]
  )

  const sessionListViewOptions = useMemo<SessionListViewOptions>(
    () => ({
      agentById,
      agentRankById,
      labels: {
        pinned: t('selector.common.pinned_title'),
        time: {
          today: t('agent.session.group.today'),
          yesterday: t('agent.session.group.yesterday'),
          'this-week': t('agent.session.group.this_week'),
          earlier: t('agent.session.group.earlier')
        },
        agent: {
          unknown: t('agent.session.group.unknown_agent')
        },
        workdir: {
          none: t('agent.session.group.no_workdir')
        }
      },
      mode: displayMode,
      now: groupNow,
      visibleAgentId: isRightPanel ? (agentIdFilter ?? null) : undefined,
      workspaces: workspaceRowsForDisplay
    }),
    [agentById, agentIdFilter, agentRankById, displayMode, groupNow, isRightPanel, t, workspaceRowsForDisplay]
  )

  const {
    groupBy: sessionGroupBy,
    items: filteredGroupedSessions,
    workdirDisplay
  } = useMemo(
    () => deriveSessionListView(sessionItems, sessionListViewOptions, optimisticMove),
    [optimisticMove, sessionItems, sessionListViewOptions]
  )

  const sessionOrderSignature = useMemo(
    () =>
      sessionItems
        .map((session) => `${session.id}:${session.agentId ?? ''}:${session.orderKey}:${session.pinned ? '1' : '0'}`)
        .join('|'),
    [sessionItems]
  )

  useEffect(() => {
    setOptimisticMove(null)
  }, [sessionOrderSignature])

  useEffect(() => {
    setOptimisticWorkspaceOrderIds(null)
  }, [workspaceOrderSignature])

  useEffect(() => {
    setOptimisticAgentOrderIds(null)
  }, [agentOrderSignature])

  // Time mode only: "Earlier" above a list with nothing newer restates the list itself.
  const sessionGroupByForDisplay = useMemo(
    () =>
      displayMode === 'time'
        ? withSoleGroupLabelHidden(sessionGroupBy, filteredGroupedSessions, {
            ignoreGroupIds: [SESSION_PINNED_GROUP_ID]
          })
        : sessionGroupBy,
    [displayMode, filteredGroupedSessions, sessionGroupBy]
  )
  const createSessionSeedIndex = useMemo(
    () => buildCreateSessionSeedIndex(filteredGroupedSessions, (session) => sessionGroupBy(session)?.id),
    [filteredGroupedSessions, sessionGroupBy]
  )
  const headerCreateSessionSeed = useMemo(
    () =>
      isRightPanel
        ? agentIdFilter
          ? { agentId: agentIdFilter, workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM } }
          : null
        : createSessionSeedIndex.latest,
    [agentIdFilter, createSessionSeedIndex.latest, isRightPanel]
  )

  const { sessionGroupSeeds, sessionSectionBy } = useSessionGroupStructure({
    agentsForDisplay,
    displayMode,
    filteredGroupedSessions,
    workdirDisplay,
    workspaceRowsForDisplay
  })
  const { collapsedSessionState, handleSessionCollapsedStateChange } = useSessionExpansion({
    agentIdFilter,
    displayMode,
    filteredGroupedSessions,
    isRightPanel,
    sessionGroupBy,
    workdirDisplay
  })

  const planSessionRemoval = useCallback(
    (id: string) => {
      const allSessions = withOptimisticNames(readSessionListItems())
      const { groupBy, items: listedSessions } = deriveSessionListView(
        allSessions,
        sessionListViewOptions,
        optimisticMove
      )
      const deletedSession = allSessions.find((session) => session.id === id)

      const deletedGroupId = deletedSession ? groupBy(deletedSession)?.id : undefined
      const sameGroupSessions = deletedGroupId
        ? listedSessions.filter((session) => groupBy(session)?.id === deletedGroupId)
        : listedSessions
      const sameGroupNext = pickNeighbourAfterRemoval(sameGroupSessions, id)
      const replacement = sameGroupNext ?? findLatestActive(allSessions.filter((candidate) => candidate.id !== id))
      const wasActive = activeSessionIdRef.current === id
      const activeSession = allSessions.find((session) => session.id === activeSessionIdRef.current)
      const preservesFileWorkspace = Boolean(
        activeSession &&
        replacement &&
        buildAgentFileWorkspaceKey(activeSession.workspaceId, activeSession.workspace?.path) ===
          buildAgentFileWorkspaceKey(replacement.workspaceId, replacement.workspace?.path)
      )
      return { deletedSession, replacement, wasActive, preservesFileWorkspace }
    },
    [optimisticMove, readSessionListItems, sessionListViewOptions, withOptimisticNames]
  )

  const handleDeleteSession = useCallback(
    async (id: string) => {
      const { deletedSession, replacement, wasActive, preservesFileWorkspace } = planSessionRemoval(id)

      const performDelete = async () => {
        const success = await deleteSession(id)
        if (!success) {
          if (replacement && wasActive && activeSessionIdRef.current === replacement.id) setActiveSessionId(id)
          return
        }

        if (wasActive && !replacement) setTrackedActiveSessionId(null, null)

        showRecycleBinUndo({
          itemName: deletedSession?.name || t('common.unnamed'),
          title: t('common.archived', { name: deletedSession?.name || t('common.unnamed') }),
          onUndo: () =>
            restoreRecycleBinItem({
              id,
              restore: restoreSession,
              getActive: (sessionId) => dataApiService.get(`/agent-sessions/${sessionId}`),
              isNotFound: isAgentSessionNotFoundError,
              refresh: reload
            })
        })
      }

      // Switch away from the URL-bound session before deletion so its invalidation cannot trigger
      // missing-route recovery. Cross-workspace switches and deletion stay under the same file guard.
      if (replacement && wasActive) {
        const transition = () => {
          setTrackedActiveSessionId(replacement.id, replacement)
          void performDelete()
        }
        if (!preservesFileWorkspace && requestFileNavigation) {
          requestFileNavigation(transition)
          return
        }
        transition()
        return
      }

      await performDelete()
    },
    [
      deleteSession,
      planSessionRemoval,
      reload,
      requestFileNavigation,
      restoreSession,
      setActiveSessionId,
      setTrackedActiveSessionId,
      t
    ]
  )

  const runPermanentDelete = useCallback(
    async (id: string) => {
      const latest = sessionItemsRef.current.find((session) => session.id === id)
      if (!latest) {
        await reload().catch(() => undefined)
        throw new Error(t('recycle_bin.delete.stale'))
      }
      if (latest.pinned) throw new Error(t('recycle_bin.delete.pinned'))
      if (isAgentSessionBusy(id)) throw new Error(t('recycle_bin.delete.busy'))

      const { replacement, wasActive } = planSessionRemoval(id)
      // Hold missing-session recovery until this attempt settles. The by-id NOT_FOUND
      // notification can arrive before the IPC reply, which is not user navigation.
      onLocalPermanentDeletePendingChange?.(id)
      try {
        const outcome = await deleteSessionWithOutcome(id, { permanent: true, showFeedback: false })
        if (outcome.status === 'failed') {
          await reload().catch(() => undefined)
          throw new Error(outcome.error || t('agent.session.delete.error.failed'))
        }
        if (outcome.status !== 'succeeded') {
          await reload().catch(() => undefined)
          throw new Error(t('recycle_bin.delete.stale'))
        }
        // Tabs close inside deleteSessionWithOutcome only when this id was actually deleted.
        // Invalidation can clear the current id while the user is still on the deleted session.
        const current = activeSessionIdRef.current
        if (current !== id && !(current === null && wasActive)) return
        if (replacement) {
          setTrackedActiveSessionId(replacement.id, replacement)
          return
        }
        setTrackedActiveSessionId(null, null)
      } finally {
        onLocalPermanentDeletePendingChange?.(null)
      }
    },
    [
      deleteSessionWithOutcome,
      onLocalPermanentDeletePendingChange,
      planSessionRemoval,
      reload,
      setTrackedActiveSessionId,
      t
    ]
  )

  const openPermanentDelete = useCallback(
    async (id: string) => {
      if (permanentDeleteLockRef.current) return
      permanentDeleteLockRef.current = true
      setDeletingSessionId(id)
      const current = sessionItemsRef.current.find((session) => session.id === id)
      try {
        await permanentDeletePopup.show({
          kind: 'conversation',
          target: 'session',
          workspace: current?.workspace,
          name: current
            ? !current.isNameManuallyEdited && !current.name.trim()
              ? t('agent.session.new')
              : current.name
            : t('common.unnamed'),
          action: () => runPermanentDelete(id)
        })
      } finally {
        permanentDeleteLockRef.current = false
        setDeletingSessionId((currentId) => (currentId === id ? null : currentId))
      }
    },
    [runPermanentDelete, t]
  )

  const {
    handleOpenRenameSessionDialog,
    handleRenameSession,
    handleRenameSessionFromDialog,
    renamingSession,
    setRenamingSessionId
  } = useSessionRename({ renameSessionOptimistically, sessionItems, sessionItemsRef, updateSession })

  const sessionMenuActions = useSessionItemMenuActions({
    getSessionExportOptions,
    queueImageCaptureTarget,
    updateSession
  })

  const { creatingSession, requestCreateSessionFromSeed } = useSessionCreation({
    activeSessionIdRef,
    agentById,
    agentsForDisplay,
    onCreateSession,
    onShowMissingAgentSelection,
    requestFileNavigation,
    sessionItemsRef
  })
  const {
    deletingWorkspaceGroupId,
    handleDeleteWorkdirGroup,
    handleOpenWorkdirGroup,
    handleRenameWorkdirGroup,
    handleStartRenameWorkdirGroup,
    isUpdatingWorkspace,
    renamingWorkspaceGroup,
    setRenamingWorkspaceGroup
  } = useWorkdirGroupHandlers({
    activeSessionId,
    refetchWorkspaces,
    reload,
    sessionItems,
    setActiveSessionId,
    workdirDisplay
  })
  const closeConversationTabs = useCloseConversationTabs()
  const invalidate = useInvalidateCache()
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null)
  const handleToggleAgentSidebar = useCallback(
    (agentId: string) => {
      const target = createSidebarShortcutTarget(SIDEBAR_SHORTCUT_PROVIDER_IDS.AGENT, agentId)
      setSidebarShortcutPinned(
        target,
        !sidebarAgentFavoriteIdSet.has(agentId),
        agents.find((agent) => agent.id === agentId)?.name
      )
    },
    [agents, setSidebarShortcutPinned, sidebarAgentFavoriteIdSet]
  )
  const restoreAgent = useCallback((agentId: string) => ipcApi.request('ai.agent.restore', { agentId }), [])

  const refreshAgentResources = useCallback(async () => {
    const outcomes = await Promise.allSettled([refetchAgents(), reload()])
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        logger.warn('Failed to refresh Agent resources from session group', { err: outcome.reason })
      }
    }
  }, [refetchAgents, reload])

  const handleDeleteAgent = useCallback(
    async (agentId: string, mode: 'archive' | 'archive-sessions' | 'permanent' = 'archive') => {
      const permanent = mode === 'permanent'
      const deleteSessionsOnly = mode === 'archive-sessions'
      if (deletingAgentId) return
      if (permanent && agentPermanentDeleteLockRef.current) return

      const agent = agentById.get(agentId)
      if (
        permanent &&
        (!agent ||
          isProtectedBuiltinAgentRole(agent.configuration?.builtin_role) ||
          agentId === SESSION_UNKNOWN_AGENT_GROUP_ID)
      ) {
        return
      }

      const performDelete = async (deleteSessions: boolean) => {
        if (permanent) {
          const liveAgent = agentByIdRef.current.get(agentId)
          if (!liveAgent || isProtectedBuiltinAgentRole(liveAgent.configuration?.builtin_role)) {
            await refreshAgentResources()
            throw new Error(t('recycle_bin.delete.stale'))
          }
          if (
            deleteSessions &&
            sessionItemsRef.current.some((session) => session.agentId === agentId && isAgentSessionBusy(session.id))
          ) {
            throw new Error(t('recycle_bin.delete.busy'))
          }
        }

        const activeSessionIdAtStart = activeSessionIdRef.current
        setDeletingAgentId(agentId)
        let deletionCommitted = false
        try {
          let deletedSessionIds: string[] = []
          let deletionChangedState = false
          try {
            if (deleteSessionsOnly) {
              const result = await ipcApi.request('ai.agent.sessions.delete', { agentId })
              deletedSessionIds = result.deletedIds
              deletionChangedState = deletedSessionIds.length > 0
            } else if (permanent) {
              const result = await ipcApi.request('ai.agent.delete_permanently', {
                agentId,
                deleteSessions
              })
              deletionChangedState = result.deleted
              deletedSessionIds = result.deletedSessionIds ?? []
            } else {
              const result = await ipcApi.request('ai.agent.delete', {
                agentId,
                deleteSessions
              })
              deletionChangedState = result.deleted
              deletedSessionIds = result.deletedSessionIds ?? []
            }
          } catch (err) {
            if (!permanent) throw err
            await refreshAgentResources()
            throw permanentAgentDeleteError(err, t)
          }
          if (permanent && deletionChangedState) deletionCommitted = true
          if (deletedSessionIds.length > 0) closeConversationTabs('agents', deletedSessionIds)

          const invalidateOutcomes = await Promise.allSettled(
            ['/agents', '/agent-sessions', '/agent-workspaces', '/pins', '/agent-channels'].map((key) =>
              invalidate(key)
            )
          )
          if (invalidateOutcomes.some((outcome) => outcome.status === 'rejected')) {
            logger.warn('Failed to refresh after deleting Agent from session group', { agentId })
          }

          const reloadResources = async () => {
            try {
              await Promise.all([...(deleteSessionsOnly ? [] : [refetchAgents()]), reload(), refetchWorkspaces()])
            } catch (err) {
              logger.warn('Failed to reload resources after deleting Agent from session group', { agentId, err })
            }
          }
          if (!deletionChangedState) {
            await reloadResources()
            if (permanent) throw new Error(t('recycle_bin.delete.stale'))
            toast.info(t('recycle_bin.already_moved'))
            return
          }

          const latestActiveSessionId = activeSessionIdRef.current
          const deletedSetHas = (sessionId: string | null) => !!sessionId && deletedSessionIds.includes(sessionId)
          const userSwitchedAway =
            latestActiveSessionId !== null &&
            latestActiveSessionId !== activeSessionIdAtStart &&
            !deletedSetHas(latestActiveSessionId)
          const stillOnDeleted =
            !userSwitchedAway &&
            (deletedSetHas(latestActiveSessionId) ||
              (latestActiveSessionId === null && deletedSetHas(activeSessionIdAtStart)))
          if (stillOnDeleted) {
            try {
              if (onActiveAgentDeleted) {
                await onActiveAgentDeleted(agentId)
              } else {
                const deletedSessionIdSet = new Set(deletedSessionIds)
                const remaining = findLatestActive(
                  sessionItemsRef.current.filter((session) => !deletedSessionIdSet.has(session.id))
                )
                setActiveSessionId(remaining?.id ?? null)
              }
            } catch (err) {
              logger.warn('Failed to reconcile active Agent after deletion from session group', { agentId, err })
            }
          }

          await reloadResources()
          if (permanent) return
          if (deleteSessionsOnly) {
            if (deletedSessionIds.length > 0) {
              const restoredIds = [...deletedSessionIds]
              showRecycleBinBatchUndo({
                itemCount: restoredIds.length,
                onUndo: () =>
                  restoreRecycleBinItems({
                    ids: restoredIds,
                    restore: restoreSession,
                    getActive: (sessionId) => dataApiService.get(`/agent-sessions/${sessionId}`),
                    isNotFound: isAgentSessionNotFoundError,
                    refresh: reload
                  })
              })
            }
          } else {
            showRecycleBinUndo({
              itemName: agent?.name || t('common.unnamed'),
              title: t('common.archived', { name: agent?.name || t('common.unnamed') }),
              description: t('agent.archive.related_resources'),
              onUndo: () =>
                restoreRecycleBinUndoGroup({
                  primary: {
                    id: agentId,
                    restore: (id) => restoreAgent(id),
                    isNotFound: isAgentNotFoundError,
                    getActive: (id) => dataApiService.get(`/agents/${id}`)
                  },
                  related: {
                    ids: deletedSessionIds,
                    restore: restoreSession,
                    getActive: (id) => dataApiService.get(`/agent-sessions/${id}`),
                    isNotFound: isAgentSessionNotFoundError
                  },
                  refresh: refreshAgentResources
                })
            })
          }
        } catch (err) {
          if (deletionCommitted) {
            logger.warn('Agent deletion succeeded but a follow-up failed from session group', { agentId, err })
            return
          }
          logger.error('Failed to delete agent from session group', { agentId, err })
          throw err
        } finally {
          setDeletingAgentId(null)
        }
      }

      if (deleteSessionsOnly) {
        await archiveAgentSessionsPopup.show({
          agentName: agent?.name || t('common.unnamed'),
          sessionCount: isFullyLoaded
            ? sessionItemsRef.current.filter((session) => session.agentId === agentId).length
            : undefined,
          t,
          action: () => performDelete(true)
        })
        return
      }

      if (permanent) {
        agentPermanentDeleteLockRef.current = true
        try {
          await permanentDeletePopup.show({
            kind: 'owner',
            type: 'agent',
            name: agent?.name || t('common.unnamed'),
            action: performDelete
          })
        } finally {
          agentPermanentDeleteLockRef.current = false
        }
        return
      }

      await deleteConversationOwnerPopup.show({ type: 'agent', action: performDelete })
    },
    [
      agentById,
      closeConversationTabs,
      deletingAgentId,
      invalidate,
      isFullyLoaded,
      onActiveAgentDeleted,
      refetchAgents,
      refetchWorkspaces,
      refreshAgentResources,
      reload,
      restoreAgent,
      restoreSession,
      setActiveSessionId,
      t
    ]
  )

  const handleArchiveSessions = useCallback(
    (agentId: string) => handleDeleteAgent(agentId, 'archive-sessions'),
    [handleDeleteAgent]
  )

  const handlePermanentDeleteAgent = useCallback(
    (agentId: string) => handleDeleteAgent(agentId, 'permanent'),
    [handleDeleteAgent]
  )

  const isAgentGroupPermanentDeleteEligible = useCallback(
    (agentId: string | undefined) => {
      if (!agentId || deletingAgentId !== null || agentPermanentDeleteLockRef.current) return false
      const agent = agentById.get(agentId)
      if (!agent || isProtectedBuiltinAgentRole(agent.configuration?.builtin_role)) return false
      return true
    },
    [agentById, deletingAgentId]
  )

  const handleToggleAgentPin = useCallback(
    async (agentId: string) => {
      if (isAgentPinActionDisabled) return

      try {
        await toggleAgentPin(agentId)
      } catch (err) {
        logger.error('Failed to toggle agent pin from session group', { agentId, err })
        toast.error(t('common.error'))
        return
      }

      try {
        await refetchAgents()
      } catch (err) {
        logger.warn('Failed to refresh agents after toggling pin from session group', { agentId, err })
      }
    },
    [isAgentPinActionDisabled, refetchAgents, t, toggleAgentPin]
  )
  const { trigger: reorderWorkspace } = useMutation('PATCH', '/agent-workspaces/:id/order')
  const { trigger: reorderAgent } = useMutation('PATCH', '/agents/:id/order', { refresh: ['/agents'] })
  // Pinned order lives in `pin.orderKey`, not on the session row, so a pinned move
  // goes through `/pins` — and the server's two-section cursor means it also
  // reshuffles `/agent-sessions` pages.
  const { trigger: reorderPin } = useMutation('PATCH', '/pins/:id/order', {
    refresh: ['/pins', '/agent-sessions']
  })

  // Pinned rows now drag: a pinned task's position is the one thing a user could
  // not choose before. They stay inside the pinned set — crossing the pinned
  // boundary would silently pin or unpin, which only the star button should do.
  const canDragSessionItem = useCallback(() => itemDragReady, [itemDragReady])

  const canDropSessionItem = useCallback(
    ({
      activeItem,
      overItem,
      sourceGroupId,
      targetGroupId
    }: {
      activeItem: SessionListItem
      overItem?: SessionListItem
      sourceGroupId: string
      targetGroupId: string
    }) =>
      itemDragReady &&
      // A drop onto a group header has no `overItem`; the same-group check below
      // is what keeps that drop inside the item's own group.
      (overItem ? activeItem.pinned === overItem.pinned : true) &&
      canDropSessionItemInDisplayGroup({ mode: displayMode, sourceGroupId, targetGroupId }),
    [displayMode, itemDragReady]
  )

  const canDragSessionGroup = useCallback(
    (group: ResourceListGroup) => {
      if (displayMode === 'agent') {
        const agentId = getAgentIdFromSessionGroupId(group.id)
        return agentDragReady && !!agentId && agentById.has(agentId)
      }

      return workdirDragReady && workdirDisplay.workspaceIdByGroupId.has(group.id)
    },
    [agentById, agentDragReady, displayMode, workdirDragReady, workdirDisplay]
  )

  const canDropSessionGroup = useCallback(
    ({ activeGroupId, overGroupId }: { activeGroupId: string; overGroupId: string }) => {
      if (displayMode === 'agent') {
        const activeAgentId = getAgentIdFromSessionGroupId(activeGroupId)
        const overAgentId = getAgentIdFromSessionGroupId(overGroupId)

        return (
          agentDragReady &&
          !!activeAgentId &&
          !!overAgentId &&
          activeAgentId !== overAgentId &&
          agentById.has(activeAgentId) &&
          agentById.has(overAgentId)
        )
      }

      const activeWorkspaceId = workdirDisplay.workspaceIdByGroupId.get(activeGroupId)
      const overWorkspaceId = workdirDisplay.workspaceIdByGroupId.get(overGroupId)

      return workdirDragReady && !!activeWorkspaceId && !!overWorkspaceId && activeWorkspaceId !== overWorkspaceId
    },
    [agentById, agentDragReady, displayMode, workdirDragReady, workdirDisplay]
  )

  // Pinned order is stored on the pin row, and `applyScopedMoves` resolves both
  // the moved row and the before/after anchor by `pin.id` — so both session ids
  // have to be translated before the move is sent.
  const reorderPinnedSession = useCallback(
    async (payload: ResourceListItemReorderPayload) => {
      const activePinId = pinIdBySessionId.get(payload.activeId)
      if (!activePinId) return

      const overPinId = pinIdBySessionId.get(payload.overId)
      const anchor: OrderRequest =
        payload.overType === 'item' && overPinId
          ? payload.position === 'before'
            ? { before: overPinId }
            : { after: overPinId }
          : { position: 'last' }

      try {
        await reorderPin({ params: { id: activePinId }, body: anchor })
      } catch (err) {
        setOptimisticMove(null)
        logger.error('Failed to reorder pinned session', { activePinId, err })
        toast.error(formatErrorMessageWithPrefix(err, t('agent.session.reorder.error.failed')))
      }
    },
    [pinIdBySessionId, reorderPin, t]
  )

  const handleSessionReorder = useCallback(
    async (payload: ResourceListReorderPayload) => {
      if (payload.type === 'group') {
        if (displayMode === 'agent') {
          if (!agentDragReady) return

          const activeAgentId = getAgentIdFromSessionGroupId(payload.activeGroupId)
          const overAgentId = getAgentIdFromSessionGroupId(payload.overGroupId)

          if (
            !activeAgentId ||
            !overAgentId ||
            activeAgentId === overAgentId ||
            !agentById.has(activeAgentId) ||
            !agentById.has(overAgentId)
          ) {
            return
          }

          const agentIds = agentsForDisplay.map((agent) => agent.id)
          const nextAgentIds = moveSessionAgentGroupAfterDrop(agentIds, activeAgentId, overAgentId, payload)
          const anchor = buildSessionAgentGroupDropAnchor(payload, overAgentId)

          setOptimisticAgentOrderIds(nextAgentIds)

          try {
            await reorderAgent({ params: { id: activeAgentId }, body: anchor })
            await refetchAgents()
            setOptimisticAgentOrderIds(null)
          } catch (err) {
            setOptimisticAgentOrderIds(null)
            logger.error('Failed to reorder agent session group', { activeAgentId, err, overAgentId })
            toast.error(formatErrorMessageWithPrefix(err, t('agent.session.reorder.error.failed')))

            try {
              await refetchAgents()
            } catch (refreshErr) {
              logger.error('Failed to refresh agents after group reorder failure', {
                activeAgentId,
                refreshErr
              })
            }
          }

          return
        }

        if (!workdirDragReady) return

        const activeWorkspaceId = workdirDisplay.workspaceIdByGroupId.get(payload.activeGroupId)
        const overWorkspaceId = workdirDisplay.workspaceIdByGroupId.get(payload.overGroupId)

        if (!activeWorkspaceId || !overWorkspaceId || activeWorkspaceId === overWorkspaceId) return

        const nextWorkspaceRows = moveSessionWorkdirGroupAfterDrop(
          workspaceRowsForDisplay,
          activeWorkspaceId,
          overWorkspaceId,
          payload
        )
        const anchor = buildSessionWorkdirGroupDropAnchor(payload, overWorkspaceId)

        setOptimisticWorkspaceOrderIds(nextWorkspaceRows.map((workspace) => workspace.id))

        try {
          await reorderWorkspace({ params: { id: activeWorkspaceId }, body: anchor })
          await refetchWorkspaces()
          setOptimisticWorkspaceOrderIds(null)
        } catch (err) {
          setOptimisticWorkspaceOrderIds(null)
          logger.error('Failed to reorder workspace group', {
            activeWorkspaceId,
            err,
            overWorkspaceId
          })
          toast.error(formatErrorMessageWithPrefix(err, t('agent.session.reorder.error.failed')))

          try {
            await refetchWorkspaces()
          } catch (refreshErr) {
            logger.error('Failed to refresh workspaces after group reorder failure', {
              activeWorkspaceId,
              refreshErr
            })
          }
        }

        return
      }

      if (!itemDragReady) return
      if (
        !canDropSessionItemInDisplayGroup({
          mode: displayMode,
          sourceGroupId: payload.sourceGroupId,
          targetGroupId: payload.targetGroupId
        })
      ) {
        return
      }

      const session = sessionItems.find((candidate) => candidate.id === payload.activeId)
      if (!session) return

      const normalizedPayload = normalizeSessionDropPayload(payload)
      setOptimisticMove(normalizedPayload)

      if (session.pinned) {
        await reorderPinnedSession(normalizedPayload)
        return
      }

      const anchor = buildSessionDropAnchor(normalizedPayload)
      const reordered = await reorderSession(payload.activeId, anchor)
      if (!reordered) {
        setOptimisticMove(null)
      }
    },
    [
      agentById,
      agentDragReady,
      agentsForDisplay,
      displayMode,
      itemDragReady,
      refetchAgents,
      refetchWorkspaces,
      reorderAgent,
      reorderPinnedSession,
      reorderSession,
      reorderWorkspace,
      sessionItems,
      t,
      workdirDisplay,
      workdirDragReady,
      workspaceRowsForDisplay
    ]
  )

  const handleHeaderCreateSession = useCallback(() => {
    requestCreateSessionFromSeed(headerCreateSessionSeed)
  }, [headerCreateSessionSeed, requestCreateSessionFromSeed])

  const handleRetry = useCallback(async () => {
    await reload()
    if (displayMode === 'workdir') {
      await refetchWorkspaces()
    }
  }, [displayMode, refetchWorkspaces, reload])

  const openAgentEditor = useCallback((agentId: string) => {
    setEditDialogTarget({ kind: 'agent', id: agentId })
  }, [])
  const openSessionInNewTab = useCallback(
    (session: AgentSessionEntity) => {
      conversationNav.openConversationTab(session.id, session.name || t('common.unnamed'), { forceNew: true })
    },
    [conversationNav, t]
  )
  const openSessionInNewWindow = useCallback(
    (session: AgentSessionEntity) => {
      conversationNav.openConversationWindow(session.id, session.name || t('common.unnamed'))
    },
    [conversationNav, t]
  )

  const handleSelectSession = useCallback(
    (id: string | null) => {
      setActiveSessionId(id)
    },
    [setActiveSessionId]
  )
  const getGroupHeaderClickBehavior = useCallback(
    (group: ResourceListGroup) =>
      displayMode === 'agent' && group.id !== SESSION_PINNED_GROUP_ID ? 'select-first-then-toggle' : 'toggle',
    [displayMode]
  )
  const [defaultModelId] = usePreference('chat.default_model_id')
  const getGroupHeaderAction = useCallback(
    (group: ResourceListGroup) => {
      if (group.id === SESSION_PINNED_GROUP_ID) return null
      if (displayMode === 'time') return null

      const agentGroupId = displayMode === 'agent' ? getAgentIdFromSessionGroupId(group.id) : undefined
      const workspaceId = displayMode === 'workdir' ? workdirDisplay.workspaceIdByGroupId.get(group.id) : undefined
      const workdirPath =
        displayMode === 'workdir'
          ? (workdirDisplay.pathByGroupId.get(group.id) ?? getWorkdirPathFromSessionGroupId(group.id))
          : undefined
      const createSessionSeed =
        createSessionSeedIndex.byGroupId.get(group.id) ??
        (agentGroupId
          ? { agentId: agentGroupId, workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM } }
          : workspaceId
            ? {
                agentId: agentsForDisplay[0]?.id ?? null,
                workspace: { type: AGENT_WORKSPACE_TYPE.USER, workspaceId }
              }
            : null)
      const canCreateSession =
        group.id !== SESSION_UNKNOWN_AGENT_GROUP_ID &&
        createSessionSeed !== null &&
        !!(onCreateSession || onShowMissingAgentSelection)
      const canManageAgentGroup = !!agentGroupId && agentById.has(agentGroupId)

      if (!canCreateSession && !workdirPath && !canManageAgentGroup) return null

      return (
        <>
          {canManageAgentGroup && agentGroupId && (
            <Tooltip title={t('common.more')} delay={500}>
              <AgentGroupMoreMenu
                agentId={agentGroupId}
                isLocalAgent={!!agentById.get(agentGroupId)?.configuration?.localRuntime}
                assistantIconType={assistantIconType}
                deleteAgentDisabled={deletingAgentId !== null}
                deleteSessionsOnly={isProtectedBuiltinAgentRole(
                  agentById.get(agentGroupId)?.configuration?.builtin_role
                )}
                pinDisabled={isAgentPinActionDisabled}
                pinned={agentPinnedIdSet.has(agentGroupId)}
                onArchiveSessions={handleArchiveSessions}
                onDeleteAgent={handleDeleteAgent}
                onPermanentDeleteAgent={
                  isAgentGroupPermanentDeleteEligible(agentGroupId) ? handlePermanentDeleteAgent : undefined
                }
                permanentDeleteShortcut={permanentDeleteShortcut}
                onEdit={openAgentEditor}
                onSetAgentIconType={setAssistantIconType}
                onTogglePin={handleToggleAgentPin}
                onToggleSidebar={handleToggleAgentSidebar}
                sidebarPinned={sidebarAgentFavoriteIdSet.has(agentGroupId)}
              />
            </Tooltip>
          )}
          {workdirPath && (
            <Tooltip title={t('common.more')} delay={500}>
              <WorkdirGroupMoreMenu
                canDelete={!!workspaceId}
                canRename={!!workspaceId}
                deleteDisabled={!!deletingWorkspaceGroupId}
                group={group}
                renameDisabled={isUpdatingWorkspace}
                workdirPath={workdirPath}
                onDelete={handleDeleteWorkdirGroup}
                onOpen={handleOpenWorkdirGroup}
                onRename={handleStartRenameWorkdirGroup}
              />
            </Tooltip>
          )}
          {canCreateSession && (
            <Tooltip title={t('agent.session.new')} delay={500}>
              <ResourceList.GroupHeaderActionButton
                type="button"
                aria-label={t('agent.session.new')}
                disabled={creatingSession}
                onClick={(event) => {
                  event.stopPropagation()
                  requestCreateSessionFromSeed(createSessionSeed)
                }}>
                <NewConversationIcon className="block" />
              </ResourceList.GroupHeaderActionButton>
            </Tooltip>
          )}
        </>
      )
    },
    [
      agentById,
      agentPinnedIdSet,
      agentsForDisplay,
      assistantIconType,
      creatingSession,
      deletingAgentId,
      deletingWorkspaceGroupId,
      displayMode,
      createSessionSeedIndex,
      handleArchiveSessions,
      handleDeleteAgent,
      handlePermanentDeleteAgent,
      isAgentGroupPermanentDeleteEligible,
      handleToggleAgentPin,
      handleToggleAgentSidebar,
      handleDeleteWorkdirGroup,
      handleOpenWorkdirGroup,
      handleStartRenameWorkdirGroup,
      isAgentPinActionDisabled,
      isUpdatingWorkspace,
      openAgentEditor,
      onCreateSession,
      onShowMissingAgentSelection,
      permanentDeleteShortcut,
      requestCreateSessionFromSeed,
      setAssistantIconType,
      sidebarAgentFavoriteIdSet,
      t,
      workdirDisplay
    ]
  )

  const getSectionHeaderAction = useCallback(
    (section: ResourceListSection) => {
      if (section.id !== SESSION_NO_PROJECT_SECTION_ID) return null

      const createSessionSeed = createSessionSeedIndex.byGroupId.get(SESSION_NO_PROJECT_GROUP_ID) ?? null
      const canCreateSession = !!createSessionSeed?.agentId && agentById.has(createSessionSeed.agentId)
      if (!canCreateSession) return null

      return (
        <Tooltip title={t('agent.session.new')} delay={500}>
          <ResourceList.GroupHeaderActionButton
            type="button"
            aria-label={t('agent.session.new')}
            disabled={creatingSession}
            onClick={(event) => {
              event.stopPropagation()
              requestCreateSessionFromSeed(createSessionSeed)
            }}>
            <NewConversationIcon className="block" />
          </ResourceList.GroupHeaderActionButton>
        </Tooltip>
      )
    },
    [agentById, createSessionSeedIndex, creatingSession, requestCreateSessionFromSeed, t]
  )

  const getGroupHeaderLabelSuffix = useCallback(
    (group: ResourceListGroup) => {
      if (displayMode !== 'agent') return null
      const agentId = getAgentIdFromSessionGroupId(group.id)
      if (!agentId || agentById.get(agentId)?.type !== 'local') return null
      return (
        <Monitor
          size={12}
          className="shrink-0 text-foreground-tertiary"
          role="img"
          aria-label={t('local_agents.badge')}
        />
      )
    },
    [agentById, displayMode, t]
  )

  const getGroupHeaderIcon = useCallback(
    (group: ResourceListGroup, context: { collapsed: boolean }) => {
      if (group.id === SESSION_PINNED_GROUP_ID) return undefined

      if (displayMode === 'workdir') {
        if (group.id === SESSION_NO_WORKDIR_GROUP_ID || group.id === SESSION_NO_PROJECT_GROUP_ID) return null
        // Open vs closed is the group's state, not a hover affordance — swapping it under the pointer
        // said "expanded" about a collapsed folder. The chevron is what answers "can I open this".
        return context.collapsed ? <Folder size={13} /> : <FolderOpen size={13} />
      }

      if (displayMode !== 'agent') return undefined
      if (group.id === SESSION_UNKNOWN_AGENT_GROUP_ID) return null

      const agentId = getAgentIdFromSessionGroupId(group.id)
      const agent = agentId ? agentById.get(agentId) : undefined
      return renderAgentEntityIcon(assistantIconType, agent, defaultModelId)
    },
    [agentById, assistantIconType, defaultModelId, displayMode]
  )
  // Which headers name a task's owner (an agent, a folder) and which merely gather rows. Declared by
  // id rather than inferred from "does this header happen to have buttons": a group that is still
  // loading, or one that legitimately has no actions, is not thereby a bucket.
  // Pinned, time, missing-owner and no-workspace groups all use the recessed bucket voice while
  // staying on the shared row rhythm.
  const getGroupHeaderKind = useCallback((group: ResourceListGroup): ResourceListGroupHeaderKind => {
    return group.id === SESSION_UNKNOWN_AGENT_GROUP_ID ||
      group.id === SESSION_PINNED_GROUP_ID ||
      group.id === SESSION_NO_PROJECT_GROUP_ID ||
      group.id === SESSION_NO_WORKDIR_GROUP_ID ||
      group.id.startsWith('session:time:')
      ? 'bucket'
      : 'entity'
  }, [])

  const isGroupHeaderIconVisible = useCallback(
    (group: ResourceListGroup) => {
      if (group.id === SESSION_PINNED_GROUP_ID) return false

      if (displayMode === 'workdir') {
        return group.id !== SESSION_NO_WORKDIR_GROUP_ID && group.id !== SESSION_NO_PROJECT_GROUP_ID
      }

      return displayMode === 'agent' && group.id !== SESSION_UNKNOWN_AGENT_GROUP_ID && assistantIconType !== 'none'
    },
    [assistantIconType, displayMode]
  )

  // Only the pseudo-group gets a tooltip: it needs explaining. Real agent rows don't — a hint about
  // dragging fired on every hover, covering the row next to it to say something you find by trying.
  const getGroupHeaderTooltip = useCallback(
    (group: ResourceListGroup) => {
      if (displayMode !== 'agent') return undefined
      return group.id === SESSION_UNKNOWN_AGENT_GROUP_ID ? t('agent.session.group.unknown_agent_tip') : undefined
    },
    [displayMode, t]
  )

  const getGroupHeaderContextMenu = useCallback(
    (group: ResourceListGroup) => {
      if (group.id === SESSION_PINNED_GROUP_ID) return null

      if (displayMode === 'agent') {
        const agentId = getAgentIdFromSessionGroupId(group.id)
        if (!agentId || !agentById.has(agentId)) return null

        const actionContext: AgentGroupActionContext = {
          agentId,
          isLocalAgent: !!agentById.get(agentId)?.configuration?.localRuntime,
          assistantIconType,
          deleteAgentDisabled: deletingAgentId !== null,
          deleteSessionsOnly: isProtectedBuiltinAgentRole(agentById.get(agentId)?.configuration?.builtin_role),
          onArchiveSessions: handleArchiveSessions,
          onDeleteAgent: handleDeleteAgent,
          onPermanentDeleteAgent: isAgentGroupPermanentDeleteEligible(agentId) ? handlePermanentDeleteAgent : undefined,
          permanentDeleteShortcut,
          onEdit: openAgentEditor,
          onSetAgentIconType: setAssistantIconType,
          onTogglePin: handleToggleAgentPin,
          onToggleSidebar: handleToggleAgentSidebar,
          pinDisabled: isAgentPinActionDisabled,
          pinned: agentPinnedIdSet.has(agentId),
          sidebarPinned: sidebarAgentFavoriteIdSet.has(agentId),
          t
        }
        const actions = resolveAgentGroupActions(actionContext)

        return actionsToCommandMenuExtraItems(actions, (action) => {
          void executeAgentGroupAction(action, actionContext)
        })
      }

      if (displayMode !== 'workdir') return null

      const workspaceId = workdirDisplay.workspaceIdByGroupId.get(group.id)
      const workdirPath = workdirDisplay.pathByGroupId.get(group.id) ?? getWorkdirPathFromSessionGroupId(group.id)
      if (!workdirPath) return null
      const actionContext: WorkdirGroupActionContext = {
        canDelete: !!workspaceId,
        canRename: !!workspaceId,
        deleteDisabled: !!deletingWorkspaceGroupId,
        group,
        onDelete: handleDeleteWorkdirGroup,
        onOpen: handleOpenWorkdirGroup,
        onRename: handleStartRenameWorkdirGroup,
        renameDisabled: isUpdatingWorkspace,
        t,
        workdirPath
      }
      const actions = resolveWorkdirGroupActions(actionContext)

      return actionsToCommandMenuExtraItems(actions, (action) => {
        void executeWorkdirGroupAction(action, actionContext)
      })
    },
    [
      agentById,
      agentPinnedIdSet,
      assistantIconType,
      deletingAgentId,
      deletingWorkspaceGroupId,
      displayMode,
      handleArchiveSessions,
      handleDeleteAgent,
      handlePermanentDeleteAgent,
      isAgentGroupPermanentDeleteEligible,
      permanentDeleteShortcut,
      handleDeleteWorkdirGroup,
      handleOpenWorkdirGroup,
      handleStartRenameWorkdirGroup,
      handleToggleAgentPin,
      handleToggleAgentSidebar,
      isAgentPinActionDisabled,
      isUpdatingWorkspace,
      openAgentEditor,
      setAssistantIconType,
      sidebarAgentFavoriteIdSet,
      t,
      workdirDisplay
    ]
  )

  const listError =
    error ?? (displayMode === 'agent' ? agentsError : displayMode === 'workdir' ? workspacesError : undefined)
  const historyLoading = isLoadingAll || !isFullyLoaded
  const metadataLoading =
    isSessionPinsLoading || isWorkdirMetadataLoading || (displayMode === 'agent' && isAgentsLoading)
  const listLoading = historyLoading || metadataLoading
  const listValidating = isValidating || isWorkdirMetadataRefreshing
  const visibleGroupedSessions = useMemo(
    () => (metadataLoading ? [] : filteredGroupedSessions),
    [filteredGroupedSessions, metadataLoading]
  )
  const listStatus = listError
    ? 'error'
    : listLoading && visibleGroupedSessions.length === 0
      ? 'loading'
      : visibleGroupedSessions.length === 0
        ? 'empty'
        : 'idle'
  const hasActiveCenterSurface = manageAgentsActive || historyRecordsActive
  const headerCreateLabel = displayMode === 'agent' ? t('agent.add.title') : t('agent.session.new')
  const headerCreateDisabled =
    displayMode === 'agent' ? !onAddAgent : creatingSession || (!onCreateSession && !onShowMissingAgentSelection)
  const handleHeaderCreate = displayMode === 'agent' ? () => void onAddAgent?.() : handleHeaderCreateSession
  const canSetPanePosition = displayMode === 'agent' || isRightPanel

  return (
    <SessionResourceList<SessionListItem>
      active={dataEnabled}
      key={isRightPanel ? `session-resource-panel:${agentIdFilter ?? 'blank'}` : 'session-resource-left-panel'}
      presentation={presentation}
      items={visibleGroupedSessions}
      status={listStatus}
      selectedId={hasActiveCenterSurface ? null : activeSessionId}
      groupBy={sessionGroupByForDisplay}
      groupSeeds={sessionGroupSeeds}
      sectionBy={sessionSectionBy}
      collapsedState={collapsedSessionState}
      revealRequest={revealRequest}
      defaultGroupVisibleCount={defaultGroupVisibleCount}
      groupLoadStep={Number.POSITIVE_INFINITY}
      getSectionHeaderAction={getSectionHeaderAction}
      getGroupHeaderAction={getGroupHeaderAction}
      getGroupHeaderContextMenu={getGroupHeaderContextMenu}
      getGroupHeaderLabelSuffix={getGroupHeaderLabelSuffix}
      getGroupHeaderIcon={getGroupHeaderIcon}
      isGroupHeaderIconVisible={isGroupHeaderIconVisible}
      getGroupHeaderTooltip={getGroupHeaderTooltip}
      getGroupHeaderKind={getGroupHeaderKind}
      groupHeaderClickBehavior={getGroupHeaderClickBehavior}
      dragCapabilities={{
        groups: displayMode === 'agent' ? agentDragReady : workdirDragReady,
        items: itemDragReady,
        itemSameGroup: itemDragReady,
        itemCrossGroup: false
      }}
      canDragGroup={canDragSessionGroup}
      canDropGroup={canDropSessionGroup}
      canDragItem={canDragSessionItem}
      canDropItem={canDropSessionItem}
      groupEmptyLabel={t('agent.session.empty.title')}
      groupShowMoreLabel={t('agent.session.group.show_more')}
      groupCollapseLabel={t('agent.session.group.collapse')}
      onRenameItem={handleRenameSession}
      onGroupHeaderSelectItem={handleSelectSession}
      onReorder={handleSessionReorder}
      onCollapsedStateChange={handleSessionCollapsedStateChange}
      onDeletePermanently={(item) => openPermanentDelete(item.id)}
      isPermanentDeleteEligible={(item) =>
        !item.pinned && item.id !== deletingSessionId && !isAgentSessionBusy(item.id)
      }
      onGroupHeaderDeletePermanently={(group) => {
        const agentId = getAgentIdFromSessionGroupId(group.id)
        if (!agentId || !isAgentGroupPermanentDeleteEligible(agentId)) return
        return handlePermanentDeleteAgent(agentId)
      }}
      isGroupHeaderPermanentDeleteEligible={(group) =>
        isAgentGroupPermanentDeleteEligible(getAgentIdFromSessionGroupId(group.id))
      }>
      <ResourceList.Header>
        {isRightPanel ? (
          <ResourceList.Search
            aria-label={t('agent.session.search.title')}
            placeholder={t('agent.session.search.placeholder')}
          />
        ) : (
          <>
            <ResourceList.HeaderItem
              type="button"
              command={displayMode === 'agent' ? undefined : 'topic.create'}
              aria-label={headerCreateLabel}
              disabled={headerCreateDisabled}
              icon={displayMode === 'agent' ? <Plus /> : <NewConversationIcon />}
              label={headerCreateLabel}
              onClick={handleHeaderCreate}
              actions={
                <SessionListOptionsMenu
                  historyRecordsActive={historyRecordsActive}
                  manageAgentsActive={manageAgentsActive}
                  mode={displayMode}
                  onChange={(nextMode) => void setSessionDisplayMode(nextMode)}
                  onManageAgents={onManageAgents}
                  onOpenHistoryRecords={onOpenHistoryRecords}
                  sectionIds={
                    displayMode === 'agent'
                      ? [SESSION_AGENT_SECTION_ID]
                      : displayMode === 'workdir'
                        ? [SESSION_WORKDIR_SECTION_ID]
                        : undefined
                  }
                />
              }
            />
          </>
        )}
      </ResourceList.Header>
      {refreshError && <ResourceRefreshErrorBanner onRetry={handleRetry} retrying={listValidating} />}
      <SessionHoverPreviewGroup enabled={dataEnabled}>
        <SessionListBody
          activeSessionId={activeSessionId}
          channelTypeMap={channelTypeMap}
          displayMode={displayMode}
          error={listError}
          isDraggable={isDraggableMode && !isRightPanel}
          isValidating={listValidating}
          listRef={listRef}
          onDeleteSession={handleDeleteSession}
          onDeletePermanently={openPermanentDelete}
          permanentDeleteShortcut={permanentDeleteShortcut}
          deletingSessionId={deletingSessionId}
          onOpenInNewTab={isWindowFrame ? undefined : openSessionInNewTab}
          onOpenInNewWindow={openSessionInNewWindow}
          onOpenRenameDialog={handleOpenRenameSessionDialog}
          onRetry={handleRetry}
          onSetPanePosition={canSetPanePosition ? setResolvedPanePosition : undefined}
          onTogglePin={handleToggleSessionPin}
          onToggleSidebar={handleToggleSessionSidebar}
          panePosition={canSetPanePosition ? resolvedPanePosition : undefined}
          sidebarSessionFavoriteIdSet={sidebarSessionFavoriteIdSet}
          sessionMenuActions={sessionMenuActions}
          setActiveSessionId={handleSelectSession}
        />
      </SessionHoverPreviewGroup>
      {(historyLoading || isLoadingMore || hasMore) && visibleGroupedSessions.length > 0 && (
        <div className="text-foreground-tertiary shrink-0 px-3 py-2 text-center text-[11px]">{t('common.loading')}</div>
      )}
      <EditNameDialog
        open={!!renamingSession}
        title={t('agent.session.edit.title')}
        initialName={renamingSession?.name ?? ''}
        onSubmit={handleRenameSessionFromDialog}
        onOpenChange={(open) => {
          if (!open) setRenamingSessionId(null)
        }}
      />
      <EditNameDialog
        open={!!renamingWorkspaceGroup}
        title={t('agent.session.workdir.rename.title')}
        initialName={renamingWorkspaceGroup?.name ?? ''}
        onSubmit={handleRenameWorkdirGroup}
        onOpenChange={(open) => {
          if (!open) setRenamingWorkspaceGroup(null)
        }}
      />
      <ResourceEditDialogHost
        target={editDialogTarget}
        onOpenChange={(open) => {
          if (!open) setEditDialogTarget(null)
        }}
      />
      <Suspense>
        {imageCaptureTargets.map(({ requestId, target: session }) => {
          const activeAgent = session.agentId ? agentById.get(session.agentId) : undefined
          return (
            <AgentSessionImageCaptureHost
              key={requestId}
              activeAgent={activeAgent}
              modelFallback={getAgentModelFallbackSnapshot(activeAgent)}
              session={session}
            />
          )
        })}
      </Suspense>
    </SessionResourceList>
  )
}

export default memo(Sessions)
