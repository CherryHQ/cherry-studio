import { Button, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { actionsToCommandMenuExtraItems } from '@renderer/components/chat/actions/actionMenuItems'
import {
  type ConversationResourceMenuItem,
  remapResourceListCollapsedGroupIds,
  renderAgentEntityIcon,
  resolveDefaultCollapsedGroupIds,
  RESOURCE_LIST_RIGHT_PANEL_SEARCH_INPUT_CLASS,
  ResourceList,
  type ResourceListGroup,
  type ResourceListItemReorderPayload,
  type ResourceListReorderPayload,
  type ResourceListRevealRequest,
  type ResourceListSection,
  SESSION_DISPLAY_LABEL_KEYS,
  SessionListOptionsMenu
} from '@renderer/components/chat/resourceList/base'
import { SessionResourceList } from '@renderer/components/chat/resourceList/SessionResourceList'
import { CommandPopupMenu } from '@renderer/components/command'
import EditNameDialog from '@renderer/components/EditNameDialog'
import {
  ResourceEditDialogHost,
  type ResourceEditDialogTarget
} from '@renderer/components/resourceCatalog/dialogs/edit'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useMutation, useQuery } from '@renderer/data/hooks/useDataApi'
import { useMultiplePreferences, usePreference } from '@renderer/data/hooks/usePreference'
import { useAgents } from '@renderer/hooks/agent/useAgent'
import { useUpdateSession } from '@renderer/hooks/agent/useSession'
import type { AgentSessionsSource } from '@renderer/hooks/resourceViewSources'
import { useCloseConversationTabs } from '@renderer/hooks/tab'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { useImageCaptureTargets } from '@renderer/hooks/useImageCaptureTargets'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { usePins } from '@renderer/hooks/usePins'
import { finishTopicRenaming, startTopicRenaming } from '@renderer/hooks/useTopic'
import { useWindowFrame } from '@renderer/hooks/useWindowFrame'
import { ipcApi } from '@renderer/ipc'
import type { AgentSessionExportOptions } from '@renderer/services/agentSessionExport'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { getAgentModelFallbackSnapshot } from '@renderer/utils/agent'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { fetchMessagesSummary } from '@renderer/utils/aiGeneration'
import {
  type AgentSessionDisplayMode,
  applyOptimisticSessionDisplayMove,
  buildSessionAgentGroupDropAnchor,
  buildSessionDropAnchor,
  buildSessionWorkdirGroupDropAnchor,
  canDropSessionItemInDisplayGroup,
  createSessionDisplayGroupResolver,
  createSessionWorkdirDisplayMaps,
  getAgentIdFromSessionGroupId,
  getWorkdirPathFromSessionGroupId,
  isSystemWorkspaceSession,
  moveSessionAgentGroupAfterDrop,
  moveSessionWorkdirGroupAfterDrop,
  normalizeSessionDropPayload,
  SESSION_AGENT_SECTION_ID,
  SESSION_NO_PROJECT_GROUP_ID,
  SESSION_NO_PROJECT_SECTION_ID,
  SESSION_NO_WORKDIR_GROUP_ID,
  SESSION_PINNED_GROUP_ID,
  SESSION_PINNED_SECTION_ID,
  SESSION_UNKNOWN_AGENT_GROUP_ID,
  SESSION_WORKDIR_SECTION_ID,
  type SessionListItem,
  sortSessionsForDisplayGroups
} from '@renderer/utils/chat/sessionListHelpers'
import { formatErrorMessage, formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { removeSpecialCharactersForFileName } from '@renderer/utils/file'
import { pickNeighbourAfterRemoval } from '@renderer/utils/resourceEntity'
import { cn } from '@renderer/utils/style'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import {
  AGENT_WORKSPACE_TYPE,
  type AgentSessionWorkspaceSource,
  type AgentWorkspaceEntity
} from '@shared/data/api/schemas/agentWorkspaces'
import type { AssistantIconType, TopicTabPosition } from '@shared/data/preference/preferenceTypes'
import { Folder, FolderOpen, MoreHorizontal, Plus, SquarePen } from 'lucide-react'
import { memo, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type AgentSessionImageActionRequest,
  type AgentSessionImageActionType,
  rejectPendingAgentSessionImageActions,
  requestAgentSessionImageAction
} from '../messages/agentSessionImageActionBus'
import AgentSessionImageCaptureHost from '../messages/AgentSessionImageCaptureHost'
import type { CreateAgentSessionDefaults } from '../types'
import { type AgentGroupActionContext, executeAgentGroupAction, resolveAgentGroupActions } from './agentGroupActions'
import SessionItem, { type SessionItemMenuActions } from './SessionItem'
import {
  executeWorkdirGroupAction,
  resolveWorkdirGroupActions,
  type WorkdirGroupActionContext
} from './workdirGroupActions'

type SessionsBaseProps = {
  agentSessionsSource: AgentSessionsSource
  agentIdFilter?: string | null
  historyRecordsActive?: boolean
  onActiveAgentDeleted?: (agentId: string) => void | Promise<void>
  onAddAgent?: () => void | Promise<void>
  onOpenHistoryRecords?: () => void
  onSetPanePosition?: (position: TopicTabPosition) => void | Promise<void>
  onCreateSession?: (
    defaults: CreateAgentSessionDefaults
  ) => AgentSessionEntity | null | void | Promise<AgentSessionEntity | null | void>
  onShowMissingAgentSelection?: () => void | Promise<void>
  panePosition?: TopicTabPosition
  presentation?: 'sidebar' | 'right-panel'
  revealRequest?: ResourceListRevealRequest
  resourceMenuItems?: readonly ConversationResourceMenuItem[]
}

type ControlledSessionsProps = SessionsBaseProps & {
  activeSessionId: string | null
  setActiveSessionId: (id: string | null, session?: AgentSessionEntity | null) => void
}

type SessionsProps = ControlledSessionsProps

const logger = loggerService.withContext('AgentSessions')

const EMPTY_WORKSPACE_ROWS: AgentWorkspaceEntity[] = []
// Let the context menu close before mounting the heavier offscreen message list.
const IMAGE_CAPTURE_START_DELAY_MS = 160
const DEFAULT_SESSION_GROUP_VISIBLE_COUNT = 5
const LEFT_PANEL_TIME_SESSION_GROUP_VISIBLE_COUNT = 50

type CreateSessionSeed = {
  agentId: string
  workspace?: AgentSessionWorkspaceSource
  workspacePath?: string
}

function AgentGroupMoreMenu({
  agentId,
  assistantIconType,
  deleteAgentDisabled,
  pinDisabled,
  pinned,
  onDeleteAgent,
  onEdit,
  onSetAgentIconType,
  onTogglePin
}: {
  agentId: string
  assistantIconType: AssistantIconType
  deleteAgentDisabled?: boolean
  pinDisabled?: boolean
  pinned: boolean
  onDeleteAgent: (agentId: string) => void | Promise<void>
  onEdit: (agentId: string) => void
  onSetAgentIconType: (iconType: AssistantIconType) => void | Promise<void>
  onTogglePin: (agentId: string) => void | Promise<void>
}) {
  const { t } = useTranslation()
  const actionContext: AgentGroupActionContext = {
    agentId,
    assistantIconType,
    deleteAgentDisabled,
    onDeleteAgent,
    onEdit,
    onSetAgentIconType,
    onTogglePin,
    pinDisabled,
    pinned,
    t
  }
  const actions = resolveAgentGroupActions(actionContext)
  const extraItems = actionsToCommandMenuExtraItems(actions, (action) => {
    void executeAgentGroupAction(action, actionContext)
  })

  return (
    <CommandPopupMenu location="webcontents.context" extraItems={extraItems} align="end" side="bottom">
      <ResourceList.GroupHeaderActionButton
        type="button"
        aria-label={t('common.more')}
        onClick={(event) => event.stopPropagation()}>
        <MoreHorizontal className="block" />
      </ResourceList.GroupHeaderActionButton>
    </CommandPopupMenu>
  )
}

function WorkdirGroupMoreMenu({
  canDelete,
  canRename,
  deleteDisabled,
  group,
  onDelete,
  onOpen,
  onRename,
  renameDisabled,
  workdirPath
}: {
  canDelete: boolean
  canRename: boolean
  deleteDisabled?: boolean
  group: ResourceListGroup
  onDelete: (group: ResourceListGroup) => void | Promise<void>
  onOpen: (workdirPath: string) => void | Promise<void>
  onRename: (group: ResourceListGroup) => void | Promise<void>
  renameDisabled?: boolean
  workdirPath: string
}) {
  const { t } = useTranslation()
  const actionContext: WorkdirGroupActionContext = {
    canDelete,
    canRename,
    deleteDisabled,
    group,
    onDelete,
    onOpen,
    onRename,
    renameDisabled,
    t,
    workdirPath
  }
  const actions = resolveWorkdirGroupActions(actionContext)
  const extraItems = actionsToCommandMenuExtraItems(actions, (action) => {
    void executeWorkdirGroupAction(action, actionContext)
  })

  return (
    <CommandPopupMenu location="webcontents.context" extraItems={extraItems} align="end" side="bottom">
      <ResourceList.GroupHeaderActionButton
        type="button"
        aria-label={t('common.more')}
        onClick={(event) => event.stopPropagation()}>
        <MoreHorizontal className="block" />
      </ResourceList.GroupHeaderActionButton>
    </CommandPopupMenu>
  )
}

export function buildCreateSessionSeed(
  session: Pick<AgentSessionEntity, 'agentId' | 'workspaceId' | 'workspace'> | null | undefined
): CreateSessionSeed | null {
  if (!session?.agentId) return null

  if (session.workspace?.type === 'system') {
    return { agentId: session.agentId, workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM } }
  }

  if (session.workspaceId) {
    return {
      agentId: session.agentId,
      workspace: { type: AGENT_WORKSPACE_TYPE.USER, workspaceId: session.workspaceId }
    }
  }

  if (session.workspace?.path) {
    return { agentId: session.agentId, workspacePath: session.workspace.path }
  }

  return { agentId: session.agentId, workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM } }
}

export function findLatestCreateSessionSeed(
  sessions: readonly SessionListItem[],
  predicate: (session: SessionListItem) => boolean = () => true
): CreateSessionSeed | null {
  let latestSession: SessionListItem | null = null
  let latestUpdatedAtMs = Number.NEGATIVE_INFINITY

  for (const session of sessions) {
    if (session.pinned || !predicate(session)) continue

    const parsedUpdatedAtMs = Date.parse(session.updatedAt)
    const updatedAtMs = Number.isFinite(parsedUpdatedAtMs) ? parsedUpdatedAtMs : Number.NEGATIVE_INFINITY
    if (!latestSession || updatedAtMs > latestUpdatedAtMs) {
      latestSession = session
      latestUpdatedAtMs = updatedAtMs
    }
  }

  return buildCreateSessionSeed(latestSession)
}

const Sessions = ({
  agentSessionsSource,
  activeSessionId,
  agentIdFilter,
  historyRecordsActive,
  onActiveAgentDeleted,
  onAddAgent,
  onOpenHistoryRecords,
  onSetPanePosition,
  onCreateSession,
  onShowMissingAgentSelection,
  panePosition,
  presentation = 'sidebar',
  revealRequest,
  resourceMenuItems,
  setActiveSessionId: setControlledActiveSessionId
}: SessionsProps) => {
  const { t } = useTranslation()
  const closeConversationTabs = useCloseConversationTabs()
  const isRightPanel = presentation === 'right-panel'
  const conversationNav = useConversationNavigation('agents')
  const isWindowFrame = useWindowFrame().mode === 'window'
  const [groupNow] = useState(() => new Date())
  const { notesPath } = useNotesSettings()
  const [exportMenuOptions] = useMultiplePreferences({
    docx: 'data.export.menus.docx',
    image: 'data.export.menus.image',
    joplin: 'data.export.menus.joplin',
    markdown: 'data.export.menus.markdown',
    markdown_reason: 'data.export.menus.markdown_reason',
    notes: 'data.export.menus.notes',
    notion: 'data.export.menus.notion',
    obsidian: 'data.export.menus.obsidian',
    plain_text: 'data.export.menus.plain_text',
    siyuan: 'data.export.menus.siyuan',
    yuque: 'data.export.menus.yuque'
  })
  const [sessionDisplayMode, setSessionDisplayMode] = usePreference('agent.session.display_mode')
  const [storedPanePosition, setStoredPanePosition] = usePreference('agent.session.position')
  // Agent session icon style is stored under its own key so it no longer mutates the assistant's.
  const [assistantIconType, setAssistantIconType] = usePreference('agent.icon_type')
  const [defaultModelId] = usePreference('chat.default_model_id')
  const resolvedPanePosition = panePosition ?? storedPanePosition
  const setResolvedPanePosition =
    panePosition === undefined ? (onSetPanePosition ?? setStoredPanePosition) : onSetPanePosition
  const [sessionExpansionTime, setSessionExpansionTime] = usePersistCache('ui.agent.session.expansion.time')
  const [sessionExpansionAgent, setSessionExpansionAgent] = usePersistCache('ui.agent.session.expansion.agent')
  const [sessionExpansionWorkdir, setSessionExpansionWorkdir] = usePersistCache('ui.agent.session.expansion.workdir')
  const {
    sessions,
    pinIdBySessionId,
    isLoading,
    isLoadingAll,
    isFullyLoaded,
    isPinsLoading: isSessionPinsLoading,
    error,
    deleteSession,
    hasMore,
    isLoadingMore,
    isValidating,
    reload,
    reorderSession,
    togglePin
  } = agentSessionsSource
  const { agents, error: agentsError, isLoading: isAgentsLoading, refetch: refetchAgents } = useAgents()
  const listRef = useRef<HTMLDivElement>(null)
  const [optimisticMove, setOptimisticMove] = useState<ResourceListItemReorderPayload | null>(null)
  const [optimisticAgentOrderIds, setOptimisticAgentOrderIds] = useState<string[] | null>(null)
  const [optimisticWorkspaceOrderIds, setOptimisticWorkspaceOrderIds] = useState<string[] | null>(null)
  const [creatingSession, setCreatingSession] = useState(false)
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null)
  const [deletingWorkspaceGroupId, setDeletingWorkspaceGroupId] = useState<string | null>(null)
  const [renamingWorkspaceGroup, setRenamingWorkspaceGroup] = useState<{
    name: string
    workspaceId: string
  } | null>(null)
  const [editDialogTarget, setEditDialogTarget] = useState<ResourceEditDialogTarget | null>(null)
  const { queueTarget: queueImageCaptureTarget, targets: imageCaptureTargets } =
    useImageCaptureTargets<AgentSessionEntity>({
      cancelMessage: 'Agent session image export was cancelled',
      delayMs: IMAGE_CAPTURE_START_DELAY_MS,
      rejectPendingActions: rejectPendingAgentSessionImageActions
    })

  const { data: channels } = useQuery('/agent-channels')
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
  const [rightPanelSessionExpansion, setRightPanelSessionExpansion] = useState<string[]>([])
  const sessionExpansion = isRightPanel
    ? rightPanelSessionExpansion
    : displayMode === 'agent'
      ? sessionExpansionAgent
      : displayMode === 'workdir'
        ? sessionExpansionWorkdir
        : sessionExpansionTime

  useEffect(() => {
    if (isRightPanel) setRightPanelSessionExpansion([])
  }, [agentIdFilter, isRightPanel])

  const dragReady = isDraggableMode && isFullyLoaded && !isLoadingAll && !isLoadingMore && !isValidating && !isLoading
  const {
    isLoading: isAgentPinsLoading,
    isRefreshing: isAgentPinsRefreshing,
    isMutating: isAgentPinsMutating,
    pinnedIds: agentPinnedIds,
    togglePin: toggleAgentPin
  } = usePins('agent', { enabled: displayMode === 'agent' })
  const isAgentPinActionDisabled = isAgentPinsLoading || isAgentPinsRefreshing || isAgentPinsMutating

  const sessionItems = useMemo<SessionListItem[]>(
    () => sessions.map((session) => ({ ...session, pinned: pinIdBySessionId.has(session.id) })),
    [pinIdBySessionId, sessions]
  )
  const sessionItemsRef = useRef(sessionItems)
  const activeSessionIdRef = useRef(activeSessionId)

  useEffect(() => {
    sessionItemsRef.current = sessionItems
  }, [sessionItems])

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  const setActiveSessionId = useCallback(
    (id: string | null) => {
      const session = id ? (sessionItemsRef.current.find((candidate) => candidate.id === id) ?? null) : null
      setControlledActiveSessionId(id, session)
    },
    [setControlledActiveSessionId]
  )

  const { updateSession } = useUpdateSession()

  const agentPinnedIdSet = useMemo(() => new Set(agentPinnedIds), [agentPinnedIds])
  const agentsForDisplay = useMemo(() => {
    if (!optimisticAgentOrderIds) return agents

    const agentById = new Map(agents.map((agent) => [agent.id, agent]))
    const orderedAgents = optimisticAgentOrderIds.flatMap((agentId) => {
      const agent = agentById.get(agentId)
      return agent ? [agent] : []
    })
    const optimisticIds = new Set(optimisticAgentOrderIds)

    for (const agent of agents) {
      if (!optimisticIds.has(agent.id)) {
        orderedAgents.push(agent)
      }
    }

    return orderedAgents
  }, [agents, optimisticAgentOrderIds])
  const agentById = useMemo(() => new Map(agentsForDisplay.map((agent) => [agent.id, agent])), [agentsForDisplay])
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
  const workspaceRows = workspaces ?? EMPTY_WORKSPACE_ROWS
  const isWorkdirMetadataLoading = displayMode === 'workdir' && isWorkspacesLoading
  const isWorkdirMetadataRefreshing = displayMode === 'workdir' && isWorkspacesRefreshing
  const workdirDragReady =
    displayMode === 'workdir' && dragReady && !isWorkdirMetadataLoading && !isWorkdirMetadataRefreshing
  const agentDragReady = displayMode === 'agent' && dragReady && !isAgentsLoading
  const itemDragReady = displayMode === 'workdir' ? workdirDragReady : agentDragReady
  const workspaceRowsForDisplay = useMemo(() => {
    if (!optimisticWorkspaceOrderIds) return workspaceRows

    const workspaceById = new Map(workspaceRows.map((workspace) => [workspace.id, workspace]))
    const orderedWorkspaces: typeof workspaceRows = []
    for (const workspaceId of optimisticWorkspaceOrderIds) {
      const workspace = workspaceById.get(workspaceId)
      if (workspace) {
        orderedWorkspaces.push(workspace)
      }
    }
    const orderedIds = new Set(orderedWorkspaces.map((workspace) => workspace.id))
    const remainingWorkspaces = workspaceRows.filter((workspace) => !orderedIds.has(workspace.id))

    return [...orderedWorkspaces, ...remainingWorkspaces]
  }, [optimisticWorkspaceOrderIds, workspaceRows])
  const workdirDisplay = useMemo(
    () => createSessionWorkdirDisplayMaps(sessionItems, workspaceRowsForDisplay),
    [sessionItems, workspaceRowsForDisplay]
  )
  const workspaceOrderSignature = useMemo(
    () => workspaceRows.map((workspace) => `${workspace.id}:${workspace.orderKey}`).join('|'),
    [workspaceRows]
  )
  const agentOrderSignature = useMemo(
    () => agents.map((agent) => `${agent.id}:${agent.orderKey ?? ''}`).join('|'),
    [agents]
  )

  const baseGroupedSessions = useMemo(
    () =>
      sortSessionsForDisplayGroups(sessionItems, {
        agentRankById,
        mode: displayMode,
        now: groupNow,
        workdirDisplay
      }),
    [agentRankById, displayMode, groupNow, sessionItems, workdirDisplay]
  )

  const groupedSessions = useMemo(
    () =>
      optimisticMove ? applyOptimisticSessionDisplayMove(baseGroupedSessions, optimisticMove) : baseGroupedSessions,
    [baseGroupedSessions, optimisticMove]
  )
  const filteredGroupedSessions = useMemo(() => {
    if (!isRightPanel) return groupedSessions
    if (!agentIdFilter) return []
    return groupedSessions.filter((session) => session.agentId === agentIdFilter)
  }, [agentIdFilter, groupedSessions, isRightPanel])
  const headerCreateSessionSeed = useMemo(
    () =>
      isRightPanel
        ? agentIdFilter
          ? { agentId: agentIdFilter, workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM } }
          : null
        : findLatestCreateSessionSeed(filteredGroupedSessions),
    [agentIdFilter, filteredGroupedSessions, isRightPanel]
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

  const sessionGroupBy = useMemo(
    () =>
      createSessionDisplayGroupResolver({
        agentById,
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
        pinnedAsSection: displayMode !== 'time',
        workdirDisplay
      }),
    [agentById, displayMode, groupNow, t, workdirDisplay]
  )

  const sessionSectionBy = useMemo(() => {
    if (displayMode === 'time') return undefined

    return (session: SessionListItem): ResourceListSection => {
      if (session.pinned) {
        return { id: SESSION_PINNED_SECTION_ID, label: t('selector.common.pinned_title') }
      }

      if (displayMode === 'workdir' && isSystemWorkspaceSession(session)) {
        return { id: SESSION_NO_PROJECT_SECTION_ID, label: t('agent.session.group.no_workdir') }
      }

      return {
        id: displayMode === 'agent' ? SESSION_AGENT_SECTION_ID : SESSION_WORKDIR_SECTION_ID,
        label: t(SESSION_DISPLAY_LABEL_KEYS[displayMode])
      }
    }
  }, [displayMode, t])

  const collapsedSessionState = useMemo(() => {
    const resolvedSessionExpansion = resolveDefaultCollapsedGroupIds({
      collapsedIds: sessionExpansion,
      groupBy: sessionGroupBy,
      items: filteredGroupedSessions
    })

    if (displayMode !== 'workdir') {
      return resolvedSessionExpansion
    }

    return remapResourceListCollapsedGroupIds(resolvedSessionExpansion, (groupId) => {
      const path = getWorkdirPathFromSessionGroupId(groupId)
      return path ? (workdirDisplay.groupIdByPath.get(path) ?? groupId) : groupId
    })
  }, [displayMode, filteredGroupedSessions, sessionExpansion, sessionGroupBy, workdirDisplay])

  const handleSessionCollapsedStateChange = useCallback(
    (nextCollapsedIds: string[]) => {
      if (isRightPanel) {
        setRightPanelSessionExpansion(nextCollapsedIds)
        return
      }

      if (displayMode === 'agent') setSessionExpansionAgent(nextCollapsedIds)
      else if (displayMode === 'workdir') setSessionExpansionWorkdir(nextCollapsedIds)
      else setSessionExpansionTime(nextCollapsedIds)
    },
    [displayMode, isRightPanel, setSessionExpansionAgent, setSessionExpansionTime, setSessionExpansionWorkdir]
  )
  const getCreateSessionSeedForGroup = useCallback(
    (groupId: string) =>
      findLatestCreateSessionSeed(filteredGroupedSessions, (session) => sessionGroupBy(session)?.id === groupId),
    [filteredGroupedSessions, sessionGroupBy]
  )
  const handleDeleteSession = useCallback(
    async (id: string) => {
      // Capture the deleted session before removal so selection can be scoped to its agent even
      // after the list refetches.
      const deletedSession =
        filteredGroupedSessions.find((session) => session.id === id) ??
        sessionItemsRef.current.find((session) => session.id === id)

      const success = await deleteSession(id)
      if (!success || activeSessionId !== id) return

      // Deleting the active session selects a neighbour within the *same agent* (both layouts), so we
      // never jump to an unrelated agent's session. When that agent has no other session left, open a
      // fresh empty one for it instead of stranding the view.
      const agentScopedSessions = deletedSession
        ? filteredGroupedSessions.filter((session) => session.agentId === deletedSession.agentId)
        : filteredGroupedSessions
      const next = pickNeighbourAfterRemoval(agentScopedSessions, id)
      if (next) {
        setActiveSessionId(next.id)
        return
      }

      const seed = deletedSession
        ? buildCreateSessionSeed({
            agentId: agentIdFilter ?? deletedSession.agentId,
            workspace: deletedSession.workspace,
            workspaceId: deletedSession.workspaceId
          })
        : agentIdFilter
          ? { agentId: agentIdFilter, workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM } }
          : null
      // Mirror the sibling create paths (createSessionFromSeed / handleRenameSession): if the
      // session create rejects (e.g. the user-workspace refetch fails) surface a toast and still
      // clear the active id in `finally`, so we never strand the view on the just-deleted session.
      let createdSession: AgentSessionEntity | null | void = null
      try {
        if (seed?.agentId && onCreateSession) {
          createdSession = await onCreateSession({
            agentId: seed.agentId,
            workspace: seed.workspace ?? { type: AGENT_WORKSPACE_TYPE.SYSTEM },
            // Never let the fresh replacement reuse the session we just deleted (stale candidate list).
            excludeReuseSessionId: id
          })
        }
      } catch (err) {
        logger.error('Failed to create session after deleting last session', { err, sessionId: id })
        toast.error(formatErrorMessageWithPrefix(err, t('agent.session.create.error.failed')))
      } finally {
        if (!createdSession) setActiveSessionId(null)
      }
    },
    [activeSessionId, agentIdFilter, deleteSession, filteredGroupedSessions, onCreateSession, setActiveSessionId, t]
  )

  const handleRenameSession = useCallback(
    async (id: string, name: string) => {
      const session = sessionItems.find((candidate) => candidate.id === id)
      const trimmedName = name.trim()
      if (!session || !trimmedName || trimmedName === session.name) return

      try {
        const updatedSession = await updateSession(
          { id, name: trimmedName, isNameManuallyEdited: true },
          { showSuccessToast: false }
        )
        if (updatedSession) {
          toast.success(t('common.saved'))
        }
      } catch (err) {
        logger.error('Failed to rename session', { err, sessionId: id })
        toast.error(t('agent.session.update.error.failed'))
      }
    },
    [sessionItems, t, updateSession]
  )

  const handleAutoRenameSession = useCallback(
    async (session: AgentSessionEntity) => {
      const { getAgentSessionMessagesForExport } = await import('@renderer/services/agentSessionExport')
      const messages = await getAgentSessionMessagesForExport(session)
      if (messages.length < 2) return

      const topicId = buildAgentSessionTopicId(session.id)
      startTopicRenaming(topicId)
      try {
        const { text: summaryText, error: summaryError } = await fetchMessagesSummary({ messages })
        if (summaryText) {
          await updateSession(
            { id: session.id, name: summaryText, isNameManuallyEdited: false },
            { showSuccessToast: false }
          )
        } else if (summaryError) {
          toast.error(`${t('message.error.fetchTopicName')}: ${summaryError}`)
        }
      } finally {
        finishTopicRenaming(topicId)
      }
    },
    [t, updateSession]
  )

  const showSessionImageExportToast = useCallback(
    (request: AgentSessionImageActionRequest) => {
      const key = `agent-session-image-export:${request.id}`
      const loadingPromise = request.promise.finally(() => toast.closeToast(key)).catch(() => undefined)

      toast.loading({
        key,
        title: t('chat.topics.export.image_exporting_keep_page'),
        promise: loadingPromise,
        onError: () => {}
      })

      void request.promise.then(
        () => toast.success(t('chat.topics.export.image_saved')),
        () => toast.error(t('chat.topics.export.failed'))
      )
    },
    [t]
  )

  const handleSessionImageAction = useCallback(
    (type: AgentSessionImageActionType, session: AgentSessionEntity) => {
      const request = requestAgentSessionImageAction(type, session)
      if (type === 'export') {
        showSessionImageExportToast(request)
      } else {
        void request.promise.catch(() => toast.error(t('common.copy_failed')))
      }

      queueImageCaptureTarget(request, session)
    },
    [queueImageCaptureTarget, showSessionImageExportToast, t]
  )

  const handleSaveSessionToNotes = useCallback(
    async (session: AgentSessionEntity) => {
      const [{ agentSessionToMarkdown, getAgentSessionExportTitle }, { exportContentToNotes }] = await Promise.all([
        import('@renderer/services/agentSessionExport'),
        import('@renderer/services/ExportService')
      ])
      const title = getAgentSessionExportTitle(session)
      const markdown = await agentSessionToMarkdown(session, undefined, undefined, getSessionExportOptions(session))
      await exportContentToNotes(title, markdown, notesPath)
    },
    [getSessionExportOptions, notesPath]
  )

  const handleSaveSessionToKnowledge = useCallback(
    async (session: AgentSessionEntity) => {
      try {
        const [{ getAgentSessionExportTitle, getAgentSessionMessagesForExport }, { default: SaveToKnowledgePopup }] =
          await Promise.all([
            import('@renderer/services/agentSessionExport'),
            import('@renderer/components/SaveToKnowledgePopup')
          ])
        const title = getAgentSessionExportTitle(session)
        const messages = await getAgentSessionMessagesForExport(session, getSessionExportOptions(session))
        const result = await SaveToKnowledgePopup.showForMessages(messages, title)
        if (result?.success) {
          toast.success(t('chat.save.topic.knowledge.success', { count: result.savedCount }))
        }
      } catch (err) {
        logger.error('Failed to save agent session to knowledge base', { err, sessionId: session.id })
        toast.error(t('chat.save.topic.knowledge.error.save_failed'))
      }
    },
    [getSessionExportOptions, t]
  )

  const handleCopySessionMarkdown = useCallback(
    async (session: AgentSessionEntity) => {
      const { copyAgentSessionAsMarkdown } = await import('@renderer/services/agentSessionExport')
      return copyAgentSessionAsMarkdown(session, getSessionExportOptions(session))
    },
    [getSessionExportOptions]
  )

  const handleCopySessionPlainText = useCallback(
    async (session: AgentSessionEntity) => {
      const { copyAgentSessionAsPlainText } = await import('@renderer/services/agentSessionExport')
      return copyAgentSessionAsPlainText(session, getSessionExportOptions(session))
    },
    [getSessionExportOptions]
  )

  const handleExportSessionMarkdown = useCallback(
    async (session: AgentSessionEntity) => {
      const { exportAgentSessionAsMarkdown } = await import('@renderer/services/agentSessionExport')
      return exportAgentSessionAsMarkdown(session, undefined, undefined, getSessionExportOptions(session))
    },
    [getSessionExportOptions]
  )

  const handleExportSessionMarkdownReason = useCallback(
    async (session: AgentSessionEntity) => {
      const { exportAgentSessionAsMarkdown } = await import('@renderer/services/agentSessionExport')
      return exportAgentSessionAsMarkdown(session, true, undefined, getSessionExportOptions(session))
    },
    [getSessionExportOptions]
  )

  const handleExportSessionWord = useCallback(
    async (session: AgentSessionEntity) => {
      const { agentSessionToMarkdown, getAgentSessionExportTitle } = await import(
        '@renderer/services/agentSessionExport'
      )
      const title = getAgentSessionExportTitle(session)
      const markdown = await agentSessionToMarkdown(session, undefined, undefined, getSessionExportOptions(session))
      await ipcApi.request('export.word.from_markdown', {
        markdown,
        fileName: removeSpecialCharactersForFileName(title)
      })
    },
    [getSessionExportOptions]
  )

  const handleExportSessionNotion = useCallback(
    async (session: AgentSessionEntity) => {
      const [{ getAgentSessionExportTitle, getAgentSessionMessagesForExport }, { exportMessagesToNotion }] =
        await Promise.all([import('@renderer/services/agentSessionExport'), import('@renderer/services/ExportService')])
      const title = getAgentSessionExportTitle(session)
      const messages = await getAgentSessionMessagesForExport(session, getSessionExportOptions(session))
      await exportMessagesToNotion(title, messages)
    },
    [getSessionExportOptions]
  )

  const handleExportSessionYuque = useCallback(
    async (session: AgentSessionEntity) => {
      const [{ agentSessionToMarkdown, getAgentSessionExportTitle }, { exportMarkdownToYuque }] = await Promise.all([
        import('@renderer/services/agentSessionExport'),
        import('@renderer/services/ExportService')
      ])
      const title = getAgentSessionExportTitle(session)
      const markdown = await agentSessionToMarkdown(session, undefined, undefined, getSessionExportOptions(session))
      await exportMarkdownToYuque(title, markdown)
    },
    [getSessionExportOptions]
  )

  const handleExportSessionObsidian = useCallback(
    async (session: AgentSessionEntity) => {
      const [{ getAgentSessionExportTitle, getAgentSessionMessagesForExport }, { default: ObsidianExportPopup }] =
        await Promise.all([
          import('@renderer/services/agentSessionExport'),
          import('@renderer/components/ObsidianExportPopup')
        ])
      const title = getAgentSessionExportTitle(session)
      const messages = await getAgentSessionMessagesForExport(session, getSessionExportOptions(session))
      await ObsidianExportPopup.show({ title: title.replace(/\\/g, '_'), messages, processingMethod: '3' })
    },
    [getSessionExportOptions]
  )

  const handleExportSessionJoplin = useCallback(
    async (session: AgentSessionEntity) => {
      const [{ getAgentSessionExportTitle, getAgentSessionMessagesForExport }, { exportMarkdownToJoplin }] =
        await Promise.all([import('@renderer/services/agentSessionExport'), import('@renderer/services/ExportService')])
      const title = getAgentSessionExportTitle(session)
      const messages = await getAgentSessionMessagesForExport(session, getSessionExportOptions(session))
      await exportMarkdownToJoplin(title, messages)
    },
    [getSessionExportOptions]
  )

  const handleExportSessionSiyuan = useCallback(
    async (session: AgentSessionEntity) => {
      const [{ agentSessionToMarkdown, getAgentSessionExportTitle }, { exportMarkdownToSiyuan }] = await Promise.all([
        import('@renderer/services/agentSessionExport'),
        import('@renderer/services/ExportService')
      ])
      const title = getAgentSessionExportTitle(session)
      const markdown = await agentSessionToMarkdown(session, undefined, undefined, getSessionExportOptions(session))
      await exportMarkdownToSiyuan(title, markdown)
    },
    [getSessionExportOptions]
  )

  const handleCopySessionImage = useCallback(
    (session: AgentSessionEntity) => {
      handleSessionImageAction('copy', session)
    },
    [handleSessionImageAction]
  )

  const handleExportSessionImage = useCallback(
    (session: AgentSessionEntity) => {
      handleSessionImageAction('export', session)
    },
    [handleSessionImageAction]
  )

  const { trigger: findOrCreateWorkspace } = useMutation('POST', '/agent-workspaces', {
    refresh: ['/agent-workspaces']
  })
  const { trigger: updateWorkspace, isLoading: isUpdatingWorkspace } = useMutation(
    'PATCH',
    '/agent-workspaces/:workspaceId',
    {
      refresh: ['/agent-workspaces', '/agent-sessions']
    }
  )
  const { trigger: deleteWorkspace } = useMutation('DELETE', '/agent-workspaces/:workspaceId', {
    refresh: ['/agent-sessions', '/agent-workspaces', '/pins', '/agent-channels']
  })
  const { trigger: deleteAgent } = useMutation('DELETE', '/agents/:agentId', {
    refresh: ['/agents', '/agent-sessions', '/agent-workspaces', '/pins', '/agent-channels']
  })
  const { trigger: reorderWorkspace } = useMutation('PATCH', '/agent-workspaces/:id/order')
  const { trigger: reorderAgent } = useMutation('PATCH', '/agents/:id/order', { refresh: ['/agents'] })

  const createSessionFromSeed = useCallback(
    async (seed: CreateSessionSeed | null | undefined) => {
      if (creatingSession) return null
      if (!seed?.agentId) {
        const defaultAgent = agentsForDisplay[0]
        if (defaultAgent) {
          const createdSession = await onCreateSession?.({
            agentId: defaultAgent.id,
            workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM }
          })
          if (!createdSession) setActiveSessionId(null)
          return createdSession ?? null
        }

        await onShowMissingAgentSelection?.()
        return null
      }

      const agent = agentById.get(seed.agentId)
      if (!agent) return null

      setCreatingSession(true)
      try {
        const workspace =
          seed.workspace ??
          (seed.workspacePath
            ? ({
                type: AGENT_WORKSPACE_TYPE.USER,
                workspaceId: (await findOrCreateWorkspace({ body: { path: seed.workspacePath } })).id
              } satisfies AgentSessionWorkspaceSource)
            : ({ type: AGENT_WORKSPACE_TYPE.SYSTEM } satisfies AgentSessionWorkspaceSource))

        const createdSession = await onCreateSession?.({
          agentId: seed.agentId,
          workspace
        })

        if (!createdSession) setActiveSessionId(null)
        return createdSession ?? null
      } catch (err) {
        logger.error('Failed to create session from session list', { err, agentId: seed.agentId })
        toast.error(formatErrorMessageWithPrefix(err, t('agent.session.create.error.failed')))
        return null
      } finally {
        setCreatingSession(false)
      }
    },
    [
      agentById,
      agentsForDisplay,
      creatingSession,
      findOrCreateWorkspace,
      onShowMissingAgentSelection,
      onCreateSession,
      setActiveSessionId,
      t
    ]
  )

  const handleHeaderCreateSession = useCallback(() => {
    void createSessionFromSeed(headerCreateSessionSeed)
  }, [createSessionFromSeed, headerCreateSessionSeed])

  const handleRetry = useCallback(async () => {
    await reload()
    if (displayMode === 'workdir') {
      await refetchWorkspaces()
    }
  }, [displayMode, refetchWorkspaces, reload])

  const handleDeleteAgent = useCallback(
    async (agentId: string) => {
      if (deletingAgentId) return

      const currentActiveSessionId = activeSessionIdRef.current
      const currentActiveSession = currentActiveSessionId
        ? sessionItemsRef.current.find((session) => session.id === currentActiveSessionId)
        : undefined

      setDeletingAgentId(agentId)
      try {
        const confirmed = await popup.confirm({
          title: t('agent.delete.title'),
          content: t('agent.delete.content'),
          okText: t('common.delete'),
          cancelText: t('common.cancel'),
          centered: true,
          okButtonProps: {
            danger: true
          }
        })
        if (!confirmed) return

        const result = await deleteAgent({ params: { agentId }, query: { deleteSessions: true } })
        closeConversationTabs('agents', result.deletedSessionIds ?? [])
        if (currentActiveSession?.agentId === agentId) {
          if (onActiveAgentDeleted) {
            await onActiveAgentDeleted(agentId)
          } else {
            const remaining = sessionItemsRef.current.find((session) => session.agentId !== agentId)
            setActiveSessionId(remaining?.id ?? null)
          }
        }

        await refetchAgents()
        await reload()
        await refetchWorkspaces()
        toast.success(t('common.delete_success'))
      } catch (err) {
        logger.error('Failed to delete agent from session group', { agentId, err })
        toast.error(formatErrorMessageWithPrefix(err, t('agent.delete.error.failed')))
      } finally {
        setDeletingAgentId(null)
      }
    },
    [
      closeConversationTabs,
      deleteAgent,
      deletingAgentId,
      onActiveAgentDeleted,
      refetchAgents,
      refetchWorkspaces,
      reload,
      setActiveSessionId,
      t
    ]
  )

  const handleDeleteWorkdirGroup = useCallback(
    async (group: ResourceListGroup) => {
      const workspaceId = workdirDisplay.workspaceIdByGroupId.get(group.id)
      if (!workspaceId || deletingWorkspaceGroupId) return

      const sessionIds = sessionItems
        .filter((session) => session.workspaceId === workspaceId)
        .map((session) => session.id)
      if (sessionIds.length === 0) return

      const confirmed = await popup.confirm({
        title: t('agent.session.workdir.delete.title'),
        content: t('agent.session.workdir.delete.content'),
        okText: t('common.delete'),
        cancelText: t('common.cancel'),
        centered: true,
        okButtonProps: {
          danger: true
        }
      })
      if (!confirmed) return

      setDeletingWorkspaceGroupId(group.id)

      try {
        const result = await deleteWorkspace({ params: { workspaceId } })
        closeConversationTabs('agents', result.deletedIds)
        const affectedSessionIds = new Set(result.deletedIds)

        if (activeSessionId && affectedSessionIds.has(activeSessionId)) {
          const remaining = sessionItems.find((session) => !affectedSessionIds.has(session.id))
          setActiveSessionId(remaining?.id ?? null)
        }

        await reload()
        await refetchWorkspaces()
        toast.success(t('common.delete_success'))
      } catch (err) {
        logger.error('Failed to delete workspace group', { err, sessionIds, workspaceId })
        toast.error(formatErrorMessageWithPrefix(err, t('agent.session.workdir.delete.error.failed')))
      } finally {
        setDeletingWorkspaceGroupId(null)
      }
    },
    [
      activeSessionId,
      closeConversationTabs,
      deleteWorkspace,
      deletingWorkspaceGroupId,
      refetchWorkspaces,
      reload,
      sessionItems,
      setActiveSessionId,
      t,
      workdirDisplay
    ]
  )

  const handleStartRenameWorkdirGroup = useCallback(
    (group: ResourceListGroup) => {
      const workspaceId = workdirDisplay.workspaceIdByGroupId.get(group.id)
      if (!workspaceId) return

      setRenamingWorkspaceGroup({
        name: group.label,
        workspaceId
      })
    },
    [workdirDisplay]
  )

  const handleRenameWorkdirGroup = useCallback(
    async (name: string) => {
      const target = renamingWorkspaceGroup
      const trimmedName = name.trim()
      if (!target || !trimmedName || trimmedName === target.name.trim()) return

      try {
        await updateWorkspace({
          body: { name: trimmedName },
          params: { workspaceId: target.workspaceId }
        })
        toast.success(t('common.saved'))
      } catch (err) {
        logger.error('Failed to rename workspace group', { err, workspaceId: target.workspaceId })
        toast.error(formatErrorMessageWithPrefix(err, t('agent.session.workdir.rename.error.failed')))
      }
    },
    [renamingWorkspaceGroup, t, updateWorkspace]
  )

  const handleOpenWorkdirGroup = useCallback(
    async (workdirPath: string) => {
      try {
        await window.api.file.openPath(workdirPath)
      } catch (err) {
        toast.error(formatErrorMessageWithPrefix(err, t('files.error.open_path', { path: workdirPath })))
      }
    },
    [t]
  )

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

  const handleToggleAgentPin = useCallback(
    async (agentId: string) => {
      if (isAgentPinActionDisabled) return

      try {
        await toggleAgentPin(agentId)
        await refetchAgents()
      } catch (err) {
        logger.error('Failed to toggle agent pin from session group', { agentId, err })
        toast.error(t('common.error'))
      }
    },
    [isAgentPinActionDisabled, refetchAgents, t, toggleAgentPin]
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
  const canDragSessionItem = useCallback(
    ({ item }: { item: SessionListItem }) => itemDragReady && !item.pinned,
    [itemDragReady]
  )

  const canDropSessionItem = useCallback(
    ({ sourceGroupId, targetGroupId }: { sourceGroupId: string; targetGroupId: string }) =>
      itemDragReady && canDropSessionItemInDisplayGroup({ mode: displayMode, sourceGroupId, targetGroupId }),
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
      if (!session || session.pinned) return

      const normalizedPayload = normalizeSessionDropPayload(payload)
      const anchor = buildSessionDropAnchor(normalizedPayload)
      setOptimisticMove(normalizedPayload)

      const reordered = await reorderSession(payload.activeId, anchor)
      if (!reordered) {
        setOptimisticMove(null)
      }
    },
    [
      displayMode,
      agentById,
      agentDragReady,
      agentsForDisplay,
      itemDragReady,
      refetchAgents,
      refetchWorkspaces,
      reorderAgent,
      reorderSession,
      reorderWorkspace,
      sessionItems,
      t,
      workdirDragReady,
      workdirDisplay,
      workspaceRowsForDisplay
    ]
  )

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
      const createSessionSeed = getCreateSessionSeedForGroup(group.id)
      const canCreateSession = createSessionSeed !== null && agentById.has(createSessionSeed.agentId)
      const canManageAgentGroup = !!agentGroupId && agentById.has(agentGroupId)

      if (!canCreateSession && !workdirPath && !canManageAgentGroup) return null

      return (
        <>
          {canManageAgentGroup && agentGroupId && (
            <Tooltip title={t('common.more')} delay={500}>
              <AgentGroupMoreMenu
                agentId={agentGroupId}
                assistantIconType={assistantIconType}
                deleteAgentDisabled={deletingAgentId !== null}
                pinDisabled={isAgentPinActionDisabled}
                pinned={agentPinnedIdSet.has(agentGroupId)}
                onDeleteAgent={handleDeleteAgent}
                onEdit={openAgentEditor}
                onSetAgentIconType={setAssistantIconType}
                onTogglePin={handleToggleAgentPin}
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
                  void createSessionFromSeed(createSessionSeed)
                }}>
                <SquarePen className="block" />
              </ResourceList.GroupHeaderActionButton>
            </Tooltip>
          )}
        </>
      )
    },
    [
      agentById,
      agentPinnedIdSet,
      assistantIconType,
      createSessionFromSeed,
      creatingSession,
      deletingAgentId,
      deletingWorkspaceGroupId,
      displayMode,
      getCreateSessionSeedForGroup,
      handleDeleteAgent,
      handleToggleAgentPin,
      handleDeleteWorkdirGroup,
      handleOpenWorkdirGroup,
      handleStartRenameWorkdirGroup,
      isAgentPinActionDisabled,
      isUpdatingWorkspace,
      openAgentEditor,
      setAssistantIconType,
      t,
      workdirDisplay
    ]
  )

  const getSectionHeaderAction = useCallback(
    (section: ResourceListSection) => {
      if (section.id !== SESSION_NO_PROJECT_SECTION_ID) return null

      const createSessionSeed = findLatestCreateSessionSeed(filteredGroupedSessions, isSystemWorkspaceSession)
      const canCreateSession = createSessionSeed !== null && agentById.has(createSessionSeed.agentId)
      if (!canCreateSession) return null

      return (
        <Tooltip title={t('agent.session.new')} delay={500}>
          <ResourceList.GroupHeaderActionButton
            type="button"
            aria-label={t('agent.session.new')}
            disabled={creatingSession}
            onClick={(event) => {
              event.stopPropagation()
              void createSessionFromSeed(createSessionSeed)
            }}>
            <SquarePen className="block" />
          </ResourceList.GroupHeaderActionButton>
        </Tooltip>
      )
    },
    [agentById, createSessionFromSeed, creatingSession, filteredGroupedSessions, t]
  )

  const getGroupHeaderIcon = useCallback(
    (group: ResourceListGroup, context: { collapsed: boolean }) => {
      if (group.id === SESSION_PINNED_GROUP_ID) return undefined

      if (displayMode === 'workdir') {
        if (group.id === SESSION_NO_WORKDIR_GROUP_ID || group.id === SESSION_NO_PROJECT_GROUP_ID) return null
        if (!context.collapsed) return <FolderOpen size={13} />

        return (
          <span className="flex size-4 items-center justify-center text-foreground/70 group-focus-within/resource-list-group:text-foreground group-hover/resource-list-group:text-foreground">
            <Folder size={13} className="block group-hover/resource-list-group:hidden" />
            <FolderOpen size={13} className="hidden group-hover/resource-list-group:block" />
          </span>
        )
      }

      if (displayMode !== 'agent') return undefined
      if (group.id === SESSION_UNKNOWN_AGENT_GROUP_ID) return null

      const agentId = getAgentIdFromSessionGroupId(group.id)
      const agent = agentId ? agentById.get(agentId) : undefined
      return renderAgentEntityIcon(assistantIconType, agent, defaultModelId)
    },
    [agentById, assistantIconType, defaultModelId, displayMode]
  )

  const getGroupHeaderClassName = useCallback(
    (group: ResourceListGroup) => {
      if (displayMode !== 'agent' || group.id === SESSION_PINNED_GROUP_ID) return undefined

      const agentId = getAgentIdFromSessionGroupId(group.id)
      if (!agentId || !agentById.has(agentId)) return undefined

      return 'rounded-lg border border-transparent'
    },
    [agentById, displayMode]
  )

  const getGroupHeaderTooltip = useCallback(
    (group: ResourceListGroup) => {
      if (displayMode !== 'agent' || group.id === SESSION_PINNED_GROUP_ID) return undefined

      const agentId = getAgentIdFromSessionGroupId(group.id)
      if (!agentId || !agentById.has(agentId)) return undefined

      return t('agent.session.group.drag_hint')
    },
    [agentById, displayMode, t]
  )

  const getGroupHeaderContextMenu = useCallback(
    (group: ResourceListGroup) => {
      if (group.id === SESSION_PINNED_GROUP_ID) return null

      if (displayMode === 'agent') {
        const agentId = getAgentIdFromSessionGroupId(group.id)
        if (!agentId || !agentById.has(agentId)) return null

        const actionContext: AgentGroupActionContext = {
          agentId,
          assistantIconType,
          deleteAgentDisabled: deletingAgentId !== null,
          onDeleteAgent: handleDeleteAgent,
          onEdit: openAgentEditor,
          onSetAgentIconType: setAssistantIconType,
          onTogglePin: handleToggleAgentPin,
          pinDisabled: isAgentPinActionDisabled,
          pinned: agentPinnedIdSet.has(agentId),
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
      handleDeleteAgent,
      handleDeleteWorkdirGroup,
      handleOpenWorkdirGroup,
      handleStartRenameWorkdirGroup,
      handleToggleAgentPin,
      isAgentPinActionDisabled,
      isUpdatingWorkspace,
      openAgentEditor,
      setAssistantIconType,
      t,
      workdirDisplay
    ]
  )

  const sessionMenuActions = useMemo<SessionItemMenuActions>(
    () => ({
      exportMenuOptions: exportMenuOptions as SessionItemMenuActions['exportMenuOptions'],
      onAutoRename: handleAutoRenameSession,
      onCopyImage: handleCopySessionImage,
      onCopyMarkdown: handleCopySessionMarkdown,
      onCopyPlainText: handleCopySessionPlainText,
      onExportImage: handleExportSessionImage,
      onExportJoplin: handleExportSessionJoplin,
      onExportMarkdown: handleExportSessionMarkdown,
      onExportMarkdownReason: handleExportSessionMarkdownReason,
      onExportNotion: handleExportSessionNotion,
      onExportObsidian: handleExportSessionObsidian,
      onExportSiyuan: handleExportSessionSiyuan,
      onExportWord: handleExportSessionWord,
      onExportYuque: handleExportSessionYuque,
      onSaveToKnowledge: handleSaveSessionToKnowledge,
      onSaveToNotes: handleSaveSessionToNotes
    }),
    [
      exportMenuOptions,
      handleAutoRenameSession,
      handleCopySessionMarkdown,
      handleCopySessionPlainText,
      handleCopySessionImage,
      handleExportSessionImage,
      handleExportSessionJoplin,
      handleExportSessionMarkdown,
      handleExportSessionMarkdownReason,
      handleExportSessionNotion,
      handleExportSessionObsidian,
      handleExportSessionSiyuan,
      handleExportSessionWord,
      handleExportSessionYuque,
      handleSaveSessionToKnowledge,
      handleSaveSessionToNotes
    ]
  )

  const listError =
    error ?? (displayMode === 'agent' ? agentsError : displayMode === 'workdir' ? workspacesError : undefined)
  const listLoading =
    isLoadingAll ||
    !isFullyLoaded ||
    isSessionPinsLoading ||
    isWorkdirMetadataLoading ||
    (displayMode === 'agent' && isAgentsLoading)
  const listValidating = isValidating || isWorkdirMetadataRefreshing
  const visibleGroupedSessions = useMemo(
    () => (listLoading ? [] : filteredGroupedSessions),
    [filteredGroupedSessions, listLoading]
  )
  const listStatus = listError
    ? 'error'
    : listLoading
      ? 'loading'
      : filteredGroupedSessions.length === 0
        ? 'empty'
        : 'idle'
  const hasActiveResourceMenuItem = resourceMenuItems?.some((item) => item.active) ?? false
  const hasActiveCenterSurface = hasActiveResourceMenuItem || historyRecordsActive
  const manageAgentsMenuItem = resourceMenuItems?.find((item) => item.id === 'agent-resource-view')
  const headerCreateLabel = displayMode === 'agent' ? t('agent.add.title') : t('agent.session.new')
  const headerCreateDisabled =
    displayMode === 'agent'
      ? !onAddAgent
      : creatingSession || (!headerCreateSessionSeed && !onShowMissingAgentSelection)
  const handleHeaderCreate = displayMode === 'agent' ? () => void onAddAgent?.() : handleHeaderCreateSession
  const canSetPanePosition = displayMode === 'agent' || isRightPanel

  return (
    <SessionResourceList<SessionListItem>
      key={isRightPanel ? `session-resource-panel:${agentIdFilter ?? 'blank'}` : 'session-resource-sidebar'}
      className={cn(isRightPanel && 'h-full min-h-0 border-r-0')}
      items={visibleGroupedSessions}
      status={listStatus}
      selectedId={hasActiveCenterSurface ? null : activeSessionId}
      groupBy={sessionGroupBy}
      sectionBy={sessionSectionBy}
      collapsedState={collapsedSessionState}
      revealRequest={revealRequest}
      defaultGroupVisibleCount={defaultGroupVisibleCount}
      groupLoadStep={DEFAULT_SESSION_GROUP_VISIBLE_COUNT}
      getSectionHeaderAction={getSectionHeaderAction}
      getGroupHeaderAction={getGroupHeaderAction}
      getGroupHeaderClassName={getGroupHeaderClassName}
      getGroupHeaderContextMenu={getGroupHeaderContextMenu}
      getGroupHeaderIcon={getGroupHeaderIcon}
      getGroupHeaderTooltip={getGroupHeaderTooltip}
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
      groupShowMoreLabel={t('agent.session.group.show_more')}
      groupCollapseLabel={t('agent.session.group.collapse')}
      onRenameItem={handleRenameSession}
      onGroupHeaderSelectItem={handleSelectSession}
      onReorder={handleSessionReorder}
      onCollapsedStateChange={handleSessionCollapsedStateChange}>
      <ResourceList.Header className={cn('gap-1', isRightPanel && 'pb-1')}>
        {isRightPanel ? (
          <ResourceList.Search
            aria-label={t('agent.session.search.title')}
            className={RESOURCE_LIST_RIGHT_PANEL_SEARCH_INPUT_CLASS}
            placeholder={t('agent.session.search.placeholder')}
            wrapperClassName="pt-1"
          />
        ) : (
          <>
            <ResourceList.HeaderItem
              type="button"
              command={displayMode === 'agent' ? undefined : 'topic.create'}
              aria-label={headerCreateLabel}
              disabled={headerCreateDisabled}
              icon={displayMode === 'agent' ? <Plus /> : <SquarePen />}
              label={headerCreateLabel}
              onClick={handleHeaderCreate}
              actions={
                <SessionListOptionsMenu
                  historyRecordsActive={historyRecordsActive}
                  manageAgentsActive={manageAgentsMenuItem?.active}
                  mode={displayMode}
                  onChange={(nextMode) => void setSessionDisplayMode(nextMode)}
                  onManageAgents={manageAgentsMenuItem?.onSelect}
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
      <SessionListBody
        activeSessionId={activeSessionId}
        channelTypeMap={channelTypeMap}
        displayMode={displayMode}
        error={listError}
        isDraggable={itemDragReady && !isRightPanel}
        isRightPanel={isRightPanel}
        isValidating={listValidating}
        listRef={listRef}
        onDeleteSession={handleDeleteSession}
        onOpenInNewTab={isWindowFrame ? undefined : openSessionInNewTab}
        onOpenInNewWindow={openSessionInNewWindow}
        onRetry={handleRetry}
        onSetPanePosition={canSetPanePosition ? setResolvedPanePosition : undefined}
        onTogglePin={togglePin}
        panePosition={canSetPanePosition ? resolvedPanePosition : undefined}
        sessionMenuActions={sessionMenuActions}
        setActiveSessionId={handleSelectSession}
      />
      {!listLoading && (isLoadingMore || hasMore) && (
        <div className="shrink-0 px-3 py-2 text-center text-[11px] text-muted-foreground/55">{t('common.loading')}</div>
      )}
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
        onSaved={refetchAgents}
      />
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
    </SessionResourceList>
  )
}

interface SessionListBodyProps {
  activeSessionId: string | null
  channelTypeMap: Record<string, string>
  displayMode: AgentSessionDisplayMode
  error?: unknown
  isDraggable: boolean
  isRightPanel: boolean
  isValidating: boolean
  listRef: RefObject<HTMLDivElement | null>
  onDeleteSession: (id: string) => Promise<void>
  onOpenInNewTab?: (session: AgentSessionEntity) => void
  onOpenInNewWindow?: (session: AgentSessionEntity) => void
  onRetry: () => Promise<unknown>
  onSetPanePosition?: (position: TopicTabPosition) => void | Promise<void>
  onTogglePin: (id: string) => void | Promise<unknown>
  panePosition?: TopicTabPosition
  sessionMenuActions: SessionItemMenuActions
  setActiveSessionId: (id: string | null) => void
}

function SessionListBody({
  activeSessionId,
  channelTypeMap,
  displayMode,
  error,
  isDraggable,
  isRightPanel,
  isValidating,
  listRef,
  onDeleteSession,
  onOpenInNewTab,
  onOpenInNewWindow,
  onRetry,
  onSetPanePosition,
  onTogglePin,
  panePosition,
  sessionMenuActions,
  setActiveSessionId
}: SessionListBodyProps) {
  const { t } = useTranslation()

  const renderItem = useCallback(
    (session: SessionListItem) => (
      <SessionItem
        key={session.id}
        session={session}
        active={session.id === activeSessionId}
        channelType={channelTypeMap[session.id]}
        pinned={session.pinned}
        reserveLeadingIconSlot={
          displayMode !== 'time' && !(displayMode === 'workdir' && isSystemWorkspaceSession(session))
        }
        onTogglePin={onTogglePin}
        onDelete={onDeleteSession}
        onOpenInNewTab={onOpenInNewTab}
        onOpenInNewWindow={onOpenInNewWindow}
        onSetPanePosition={onSetPanePosition}
        panePosition={panePosition}
        onPress={setActiveSessionId}
        sessionMenuActions={sessionMenuActions}
      />
    ),
    [
      activeSessionId,
      channelTypeMap,
      displayMode,
      onDeleteSession,
      onOpenInNewTab,
      onOpenInNewWindow,
      onSetPanePosition,
      onTogglePin,
      panePosition,
      sessionMenuActions,
      setActiveSessionId
    ]
  )

  return (
    <ResourceList.Body<SessionListItem>
      listRef={listRef}
      draggable={isDraggable}
      virtualClassName={cn('pt-0', isRightPanel ? 'pb-8' : 'pb-3')}
      errorFallback={
        <ResourceList.ErrorState>
          <div className="flex flex-col gap-2">
            <div className="font-medium text-destructive">{t('agent.session.get.error.failed')}</div>
            <div className="text-muted-foreground">{formatErrorMessage(error)}</div>
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              onClick={() => void onRetry()}
              disabled={isValidating}>
              {t('common.retry')}
            </Button>
          </div>
        </ResourceList.ErrorState>
      }
      emptyFallback={
        <div className="mx-auto flex h-full w-full max-w-sm items-center justify-center break-words px-5 py-10 text-center text-muted-foreground text-xs">
          {t('agent.session.empty.title')}
        </div>
      }
      renderItem={renderItem}
    />
  )
}

export default memo(Sessions)
